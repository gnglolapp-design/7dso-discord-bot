from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class LinkRecord:
    url: str
    text: str


@dataclass(slots=True)
class ImageRecord:
    url: str
    alt: str = ""


@dataclass(slots=True)
class SectionRecord:
    heading: str
    level: int
    body: list[str] = field(default_factory=list)


@dataclass(slots=True)
class PageRecord:
    site: str
    url: str
    canonical_url: str
    page_type: str
    title: str
    h1: str
    summary: str
    text: str
    headings: list[str] = field(default_factory=list)
    sections: list[SectionRecord] = field(default_factory=list)
    links: list[LinkRecord] = field(default_factory=list)
    images: list[ImageRecord] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    fetched_at: str = field(default_factory=utc_now_iso)
    status_code: int | None = None
    used_browser: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class EntityRecord:
    site: str
    entity_type: str
    name: str
    slug: str
    source_url: str
    attributes: dict[str, Any] = field(default_factory=dict)
    aliases: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    extracted_at: str = field(default_factory=utc_now_iso)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class CanonicalRecord:
    entity_type: str
    entity_id: str
    name: str
    slug: str
    data: dict[str, Any] = field(default_factory=dict)
    sources: list[dict[str, Any]] = field(default_factory=list)
    aliases: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    updated_at: str = field(default_factory=utc_now_iso)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
