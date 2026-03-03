from __future__ import annotations

import re
from abc import ABC
from dataclasses import dataclass
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from sds_origin_scraper.models import EntityRecord, ImageRecord, LinkRecord, PageRecord, SectionRecord
from sds_origin_scraper.utils import (
    collect_images,
    collect_links,
    find_best_h1,
    first_nonempty,
    normalize_space,
    slug_from_url,
    text_after_heading,
    title_text,
    token_texts,
    traverse_dom_tokens,
    visible_text_blocks,
)


@dataclass(slots=True)
class BrowserHint:
    use_browser: bool = False
    wait_selector: str | None = None
    extra_wait_ms: int = 0


class SiteAdapter(ABC):
    name: str
    allowed_domains: set[str]
    seed_urls: list[str]

    def browser_hint(self, url: str) -> BrowserHint:
        return BrowserHint(use_browser=False)

    def page_type(self, url: str, soup: BeautifulSoup) -> str:
        path = urlparse(url).path.rstrip("/")
        if not path:
            return "home"
        return path.split("/")[-1] or "page"

    def parse(self, url: str, html: str, status_code: int | None, used_browser: bool) -> PageRecord:
        soup = BeautifulSoup(html, "lxml")
        title = title_text(soup)
        h1 = find_best_h1(soup)
        headings = [normalize_space(h.get_text(" ", strip=True)) for h in soup.select("h1, h2, h3, h4")]
        text_blocks = visible_text_blocks(soup)
        summary = self.summary(url, soup, text_blocks)
        sections: list[SectionRecord] = []
        for tag in soup.select("h2, h3, h4"):
            name = normalize_space(tag.get_text(" ", strip=True))
            if not name:
                continue
            level = int(tag.name[1])
            sections.append(SectionRecord(heading=name, level=level, body=text_after_heading(tag)))
        dom_tokens = traverse_dom_tokens(soup.body or soup)
        metadata = self.metadata(url, soup)
        metadata.setdefault("dom_tokens", dom_tokens)
        metadata.setdefault("dom_lines", token_texts(dom_tokens))
        return PageRecord(
            site=self.name,
            url=url,
            canonical_url=self.canonical_url(url, soup),
            page_type=self.page_type(url, soup),
            title=title,
            h1=h1,
            summary=summary,
            text="\n".join(text_blocks),
            headings=headings,
            sections=sections,
            links=[LinkRecord(url=href, text=text) for href, text in collect_links(soup, url)],
            images=[ImageRecord(url=src, alt=alt) for src, alt in collect_images(soup, url)],
            metadata=metadata,
            status_code=status_code,
            used_browser=used_browser,
        )

    def summary(self, url: str, soup: BeautifulSoup, text_blocks: list[str]) -> str:
        if len(text_blocks) >= 2:
            return first_nonempty(text_blocks[1:4])
        return first_nonempty(text_blocks)

    def metadata(self, url: str, soup: BeautifulSoup) -> dict:
        return {"slug": slug_from_url(url)}

    def canonical_url(self, url: str, soup: BeautifulSoup) -> str:
        link = soup.select_one('link[rel="canonical"]')
        if link and link.get("href"):
            return str(link["href"])
        return url

    def extract_entities(self, page: PageRecord) -> list[EntityRecord]:
        return []

    @staticmethod
    def stats_from_text(text: str) -> dict[str, str]:
        pairs: dict[str, str] = {}
        current_key: str | None = None
        for line in [normalize_space(x) for x in text.splitlines() if normalize_space(x)]:
            if re.fullmatch(r"[A-Za-z][A-Za-z0-9 %/+-]{1,50}", line):
                current_key = line
            elif current_key and re.search(r"\d", line):
                pairs[current_key] = line
                current_key = None
        return pairs
