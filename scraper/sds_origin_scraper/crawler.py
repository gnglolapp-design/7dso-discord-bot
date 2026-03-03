from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse
import xml.etree.ElementTree as ET

import httpx

from sds_origin_scraper.fetch import HtmlFetcher, should_skip_url
from sds_origin_scraper.models import EntityRecord, PageRecord
from sds_origin_scraper.parsers.base import SiteAdapter
from sds_origin_scraper.utils import is_same_domain, normalize_url, write_jsonl


@dataclass(slots=True)
class CrawlResult:
    pages: list[PageRecord]
    entities: list[EntityRecord]


class SiteCrawler:
    def __init__(
        self,
        adapter: SiteAdapter,
        out_dir: str | Path,
        max_pages: int = 500,
        same_domain_only: bool = True,
        force_browser: bool = False,
        discover_sitemaps: bool = True,
    ) -> None:
        self.adapter = adapter
        self.out_dir = Path(out_dir)
        self.max_pages = max_pages
        self.same_domain_only = same_domain_only
        self.force_browser = force_browser
        self.discover_sitemaps = discover_sitemaps

    def crawl(self) -> CrawlResult:
        pages: list[PageRecord] = []
        entities: list[EntityRecord] = []
        queue = deque(self.adapter.seed_urls)
        visited: set[str] = set()
        state_path = self.out_dir / self.adapter.name.replace(".", "_") / "_fetch_state.json"

        if self.discover_sitemaps:
            for url in self._discover_seed_urls_from_sitemaps():
                queue.append(url)

        with HtmlFetcher(state_path=state_path) as fetcher:
            while queue and len(pages) < self.max_pages:
                url = queue.popleft()
                if url in visited:
                    continue
                visited.add(url)
                if should_skip_url(url, self.adapter.allowed_domains):
                    continue

                hint = self.adapter.browser_hint(url)
                use_browser = self.force_browser or hint.use_browser
                response = fetcher.fetch(
                    url,
                    use_browser=use_browser,
                    wait_selector=hint.wait_selector,
                    extra_wait_ms=hint.extra_wait_ms,
                )
                if response.status_code and response.status_code >= 400:
                    continue
                if not response.html:
                    continue

                page = self.adapter.parse(
                    response.url,
                    response.html,
                    response.status_code,
                    response.used_browser,
                )
                page.metadata.setdefault("etag", response.etag)
                page.metadata.setdefault("last_modified", response.last_modified)
                page.metadata.setdefault("checksum", response.checksum)
                page.metadata.setdefault("not_modified", response.not_modified)
                pages.append(page)
                entities.extend(self.adapter.extract_entities(page))

                for link in page.links:
                    if self.same_domain_only and not is_same_domain(link.url, self.adapter.allowed_domains):
                        continue
                    if link.url not in visited:
                        queue.append(link.url)

        site_dir = self.out_dir / self.adapter.name.replace(".", "_")
        write_jsonl(site_dir / "pages.jsonl", [page.to_dict() for page in pages], mode="w")
        write_jsonl(site_dir / "entities.jsonl", [entity.to_dict() for entity in entities], mode="w")
        return CrawlResult(pages=pages, entities=entities)

    def _discover_seed_urls_from_sitemaps(self) -> list[str]:
        roots = []
        for seed in self.adapter.seed_urls:
            parsed = urlparse(seed)
            roots.append(f"{parsed.scheme}://{parsed.netloc}")
        urls: list[str] = []
        for root in dict.fromkeys(roots):
            urls.extend(self._parse_robots_sitemaps(root))
            urls.extend(self._parse_sitemap(root + "/sitemap.xml"))
        deduped = []
        seen = set(self.adapter.seed_urls)
        for url in urls:
            normalized = normalize_url(url, url)
            if normalized in seen:
                continue
            if should_skip_url(normalized, self.adapter.allowed_domains):
                continue
            seen.add(normalized)
            deduped.append(normalized)
        return deduped[: max(0, self.max_pages * 2)]

    def _parse_robots_sitemaps(self, root: str) -> list[str]:
        try:
            response = httpx.get(root + "/robots.txt", timeout=10.0, follow_redirects=True)
        except Exception:
            return []
        if response.status_code >= 400:
            return []
        sitemap_urls: list[str] = []
        for line in response.text.splitlines():
            if line.lower().startswith("sitemap:"):
                sitemap_urls.append(line.split(":", 1)[1].strip())
        urls: list[str] = []
        for sitemap_url in sitemap_urls:
            urls.extend(self._parse_sitemap(sitemap_url))
        return urls

    def _parse_sitemap(self, sitemap_url: str) -> list[str]:
        try:
            response = httpx.get(sitemap_url, timeout=12.0, follow_redirects=True)
        except Exception:
            return []
        if response.status_code >= 400 or not response.text.strip():
            return []
        try:
            root = ET.fromstring(response.text)
        except ET.ParseError:
            return []
        ns = ""
        if root.tag.startswith("{"):
            ns = root.tag.split("}", 1)[0] + "}"
        urls: list[str] = []
        if root.tag.endswith("sitemapindex"):
            for loc in root.findall(f".//{ns}loc"):
                child_url = (loc.text or "").strip()
                if child_url and child_url != sitemap_url:
                    urls.extend(self._parse_sitemap(child_url))
        else:
            for loc in root.findall(f".//{ns}loc"):
                url = (loc.text or "").strip()
                if url:
                    urls.append(url)
        return urls
