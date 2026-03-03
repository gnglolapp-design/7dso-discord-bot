from __future__ import annotations

import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from sds_origin_scraper.models import EntityRecord, PageRecord
from sds_origin_scraper.parsers.base import BrowserHint, SiteAdapter
from sds_origin_scraper.parsers.helpers import (
    character_entities_from_structured,
    extract_character_profile_common,
    extract_potential_chunks,
    extract_skill_chunks,
    page_images,
)
from sds_origin_scraper.utils import (
    canonical_weapon_type,
    is_weapon_type,
    normalize_name_key,
    normalize_space,
    pick_first_image_by_alt,
    unique_preserve,
)


class GenshinGgAdapter(SiteAdapter):
    name = "genshin.gg"
    allowed_domains = {"genshin.gg", "www.genshin.gg"}
    seed_urls = [
        "https://genshin.gg/7dso/",
        "https://genshin.gg/7dso/weapons/",
        "https://genshin.gg/7dso/tier-list/",
        "https://genshin.gg/7dso/interactive-map/",
    ]

    def browser_hint(self, url: str) -> BrowserHint:
        return BrowserHint(use_browser=True, wait_selector="h1", extra_wait_ms=300)

    def page_type(self, url: str, soup: BeautifulSoup) -> str:
        path = urlparse(url).path.rstrip("/")
        parts = [p for p in path.split("/") if p]
        if parts == ["7dso"]:
            return "character_index"
        if parts[:2] == ["7dso", "characters"] and len(parts) == 3:
            return "character_detail"
        if parts == ["7dso", "tier-list"]:
            return "tier_list"
        if parts == ["7dso", "weapons"]:
            return "weapon_index"
        if parts == ["7dso", "interactive-map"]:
            return "interactive_map"
        return "page"

    def metadata(self, url: str, soup: BeautifulSoup) -> dict:
        text = soup.get_text(" ", strip=True)
        return {
            "slug": normalize_name_key(urlparse(url).path.split("/")[-1] or "home"),
            "path": urlparse(url).path,
            "js_shell_present": "You need to enable JavaScript to run this app." in text,
        }

    def extract_entities(self, page: PageRecord) -> list[EntityRecord]:
        if page.page_type == "character_detail":
            return self._character_entities(page)
        if page.page_type == "tier_list":
            return [
                EntityRecord(
                    site=self.name,
                    entity_type="tier_list",
                    name=normalize_space(page.h1),
                    slug="tier-list",
                    source_url=page.url,
                    attributes={"summary": page.summary, "js_shell_present": page.metadata.get("js_shell_present", False)},
                    tags=["tier-list"],
                )
            ]
        if page.page_type == "interactive_map":
            return self._map_entities(page)
        if page.page_type == "weapon_index":
            return self._weapon_entities(page)
        if page.page_type == "character_index":
            return self._character_index_entities(page)
        return []

    def _character_entities(self, page: PageRecord) -> list[EntityRecord]:
        common = extract_character_profile_common(page)
        images = page_images(page)
        profiles = {item["weapon_type"]: item for item in extract_skill_chunks(page, common["weapon_types"])}
        for item in extract_potential_chunks(page, common["weapon_types"]):
            profiles.setdefault(item["weapon_type"], {}).setdefault("weapon_type", item["weapon_type"])
            profiles[item["weapon_type"]]["potentials"] = item["potentials"]
        return character_entities_from_structured(
            page,
            name=common["name"],
            description=common["description"],
            element=common["element"],
            weapon_types=common["weapon_types"],
            character_image=common["character_image"],
            element_icon=common["element_icon"],
            rarity="",
            source_priority=90,
            profile_details=profiles,
        )

    def _weapon_entities(self, page: PageRecord) -> list[EntityRecord]:
        lines = [normalize_space(x) for x in page.metadata.get("dom_lines", []) if normalize_space(x)]
        images = page_images(page)
        results: list[EntityRecord] = []
        idx = 0
        while idx < len(lines) - 6:
            line = lines[idx]
            if line.startswith("Image:"):
                idx += 1
                continue
            if idx + 5 < len(lines) and is_weapon_type(lines[idx + 1]) and lines[idx + 2] and lines[idx + 3] == "Equipment Attack":
                name = line
                weapon_type = canonical_weapon_type(lines[idx + 1])
                description = lines[idx + 2]
                attack = lines[idx + 4] if idx + 4 < len(lines) else ""
                secondary_stat_name = lines[idx + 5] if idx + 5 < len(lines) else ""
                secondary_stat_value = lines[idx + 6] if idx + 6 < len(lines) else ""
                results.append(
                    EntityRecord(
                        site=self.name,
                        entity_type="weapon",
                        name=name,
                        slug=normalize_name_key(name),
                        source_url=page.url,
                        attributes={
                            "weapon_type": weapon_type,
                            "description": description,
                            "attack": attack,
                            "secondary_stat_name": secondary_stat_name,
                            "secondary_stat_value": secondary_stat_value,
                            "image": pick_first_image_by_alt(images, name),
                        },
                        tags=[weapon_type],
                    )
                )
                idx += 7
                continue
            idx += 1
        # de-duplicate by slug while preserving first occurrence
        deduped: dict[str, EntityRecord] = {}
        for record in results:
            deduped.setdefault(record.slug, record)
        return list(deduped.values())

    def _map_entities(self, page: PageRecord) -> list[EntityRecord]:
        lines = [normalize_space(x) for x in page.metadata.get("dom_lines", []) if normalize_space(x)]
        counts: dict[str, str] = {}
        for idx, line in enumerate(lines[:-1]):
            if line in {"Warp Points", "Viewpoints", "Chests", "Star Fragments"}:
                counts[normalize_name_key(line)] = lines[idx + 1]
        return [
            EntityRecord(
                site=self.name,
                entity_type="interactive_map",
                name=normalize_space(page.h1),
                slug="interactive-map",
                source_url=page.url,
                attributes={"summary": page.summary, "counts": counts},
                tags=["map"],
            )
        ]

    def _character_index_entities(self, page: PageRecord) -> list[EntityRecord]:
        names = []
        for link in page.links:
            if "/7dso/characters/" in link.url:
                name = normalize_space(link.text)
                if name:
                    names.append(name)
        names = unique_preserve(names)
        return [
            EntityRecord(
                site=self.name,
                entity_type="collection",
                name="Genshin.gg Character Index",
                slug="genshin-character-index",
                source_url=page.url,
                attributes={"collection_type": "character_index", "characters": names},
                tags=["characters"],
            )
        ]
