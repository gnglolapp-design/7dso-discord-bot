from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import httpx

from sds_origin_scraper.utils import read_json, sha256_text, write_json


DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


@dataclass(slots=True)
class FetchResponse:
    url: str
    html: str
    status_code: int | None
    used_browser: bool
    etag: str = ""
    last_modified: str = ""
    checksum: str = ""
    not_modified: bool = False


class HtmlFetcher:
    def __init__(
        self,
        timeout: float = 20.0,
        delay_seconds: float = 0.4,
        headers: dict[str, str] | None = None,
        state_path: str | Path | None = None,
    ) -> None:
        self.timeout = timeout
        self.delay_seconds = delay_seconds
        merged_headers = DEFAULT_HEADERS | (headers or {})
        self.client = httpx.Client(
            headers=merged_headers,
            timeout=timeout,
            follow_redirects=True,
        )
        self.state_path = Path(state_path) if state_path else None
        self.state: dict[str, dict] = read_json(self.state_path, default={}) if self.state_path else {}

    def close(self) -> None:
        self.client.close()
        if self.state_path:
            write_json(self.state_path, self.state)

    def __enter__(self) -> "HtmlFetcher":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def fetch(
        self,
        url: str,
        *,
        use_browser: bool = False,
        wait_selector: str | None = None,
        extra_wait_ms: int = 0,
    ) -> FetchResponse:
        if use_browser:
            try:
                response = self._fetch_with_playwright(
                    url,
                    wait_selector=wait_selector,
                    extra_wait_ms=extra_wait_ms,
                )
                self._remember(response)
                return response
            except ModuleNotFoundError as exc:
                raise RuntimeError(
                    "Playwright n'est pas installé. Utilise `pip install 'sds-origin-scraper[browser]'` "
                    "puis `playwright install chromium`."
                ) from exc

        headers: dict[str, str] = {}
        cached = self.state.get(url, {}) if self.state else {}
        if cached.get("etag"):
            headers["If-None-Match"] = cached["etag"]
        if cached.get("last_modified"):
            headers["If-Modified-Since"] = cached["last_modified"]

        response = self.client.get(url, headers=headers)
        if self.delay_seconds:
            time.sleep(self.delay_seconds)

        if response.status_code == 304 and cached:
            return FetchResponse(
                url=str(response.url),
                html=cached.get("html", ""),
                status_code=response.status_code,
                used_browser=False,
                etag=cached.get("etag", ""),
                last_modified=cached.get("last_modified", ""),
                checksum=cached.get("checksum", ""),
                not_modified=True,
            )

        fetch_response = FetchResponse(
            url=str(response.url),
            html=response.text,
            status_code=response.status_code,
            used_browser=False,
            etag=response.headers.get("etag", ""),
            last_modified=response.headers.get("last-modified", ""),
            checksum=sha256_text(response.text),
            not_modified=False,
        )
        self._remember(fetch_response)
        return fetch_response

    def _fetch_with_playwright(
        self,
        url: str,
        *,
        wait_selector: str | None = None,
        extra_wait_ms: int = 0,
    ) -> FetchResponse:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=int(self.timeout * 1000))
            if wait_selector:
                page.wait_for_selector(wait_selector, timeout=int(self.timeout * 1000))
            else:
                try:
                    page.wait_for_load_state("load", timeout=int(self.timeout * 1000))
                except Exception:
                    pass
                page.wait_for_timeout(800)
            if extra_wait_ms > 0:
                page.wait_for_timeout(extra_wait_ms)
            html = page.content()
            final_url = page.url
            browser.close()

        if self.delay_seconds:
            time.sleep(self.delay_seconds)
        return FetchResponse(
            url=final_url,
            html=html,
            status_code=200,
            used_browser=True,
            checksum=sha256_text(html),
        )

    def _remember(self, response: FetchResponse) -> None:
        if self.state_path is None:
            return
        self.state[response.url] = {
            "etag": response.etag,
            "last_modified": response.last_modified,
            "checksum": response.checksum,
            "html": response.html,
        }


def should_skip_url(url: str, allowed_domains: Iterable[str]) -> bool:
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return True
    host = parsed.netloc.lower()
    allowed_set = {d.lower() for d in allowed_domains}
    if not (host in allowed_set or any(host.endswith(f".{d}") for d in allowed_set)):
        return True
    lower_path = parsed.path.lower()
    return lower_path.endswith(
        (
            ".jpg",
            ".jpeg",
            ".png",
            ".gif",
            ".webp",
            ".svg",
            ".ico",
            ".pdf",
            ".zip",
            ".mp4",
            ".webm",
            ".mp3",
        )
    )
