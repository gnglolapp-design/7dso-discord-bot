from __future__ import annotations

import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from sds_origin_scraper.models import EntityRecord, PageRecord
from sds_origin_scraper.parsers.base import SiteAdapter
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
    slug_from_url,
    unique_preserve,
)


RESOURCE_INDEXES = {"pets", "fishing", "items", "foods", "skins", "events", "news", "teams", "tier-list"}


class SevenDsOriginGgAdapter(SiteAdapter):
    name = "7dsorigin.gg"
    allowed_domains = {"7dsorigin.gg"}
    seed_urls = [
        "https://7dsorigin.gg/",
        "https://7dsorigin.gg/characters",
        "https://7dsorigin.gg/weapons",
        "https://7dsorigin.gg/banners",
        "https://7dsorigin.gg/boss",
        "https://7dsorigin.gg/events",
        "https://7dsorigin.gg/news",
        "https://7dsorigin.gg/pets",
        "https://7dsorigin.gg/fishing",
        "https://7dsorigin.gg/items",
        "https://7dsorigin.gg/foods",
        "https://7dsorigin.gg/skins",
    ]

    def page_type(self, url: str, soup: BeautifulSoup) -> str:
        path = urlparse(url).path.rstrip("/")
        if path in {"", "/"}:
            return "home"
        parts = [p for p in path.split("/") if p and p != "en"]
        if not parts:
            return "home"
        if parts[0] == "weapons" and len(parts) > 1:
            return "weapon_detail"
        if parts[0] == "boss" and len(parts) > 1:
            return "boss_detail"
        if parts[0] == "banners" and len(parts) > 1:
            return "banner_detail"
        if parts[0] == "news" and len(parts) > 1:
            return "news_detail"
        if parts[0] == "characters" and len(parts) > 1:
            if len(parts) > 2:
                return "costume_detail"
            return "character_detail"
        if parts[0] in RESOURCE_INDEXES or parts[0] in {"characters", "weapons", "banners", "boss"}:
            return f"{parts[0]}_index"
        return f"{parts[0]}_page"

    def metadata(self, url: str, soup: BeautifulSoup) -> dict:
        text = soup.get_text(" ", strip=True)
        return {
            "slug": slug_from_url(url),
            "path": urlparse(url).path,
            "has_data_coming_soon": "Data coming soon" in text,
            "has_no_skills": "No skills available" in text,
            "has_no_potentials": "No potentials available" in text,
            "has_no_weapons": "No weapons available" in text,
        }

    def extract_entities(self, page: PageRecord) -> list[EntityRecord]:
        if page.page_type == "character_detail":
            return self._character_entities(page)
        if page.page_type == "weapon_detail":
            return self._weapon_entities(page)
        if page.page_type == "banner_detail":
            return self._banner_entities(page)
        if page.page_type == "boss_detail":
            return self._boss_entities(page)
        if page.page_type == "costume_detail":
            return self._costume_entities(page)
        if page.page_type.endswith("_index"):
            return self._index_entities(page)
        return []

    def _character_entities(self, page: PageRecord) -> list[EntityRecord]:
        common = extract_character_profile_common(page)
        images = page_images(page)
        lines = [normalize_space(x) for x in page.metadata.get("dom_lines", []) if normalize_space(x)]
        rarity = ""
        for _, alt in images:
            m = re.fullmatch(r"Rarity\s+(\d+)", normalize_space(alt))
            if m:
                rarity = m.group(1)
                break
        profiles = {item["weapon_type"]: item for item in extract_skill_chunks(page, common["weapon_types"])}
        for item in extract_potential_chunks(page, common["weapon_types"]):
            profiles.setdefault(item["weapon_type"], {}).setdefault("weapon_type", item["weapon_type"])
            profiles[item["weapon_type"]]["potentials"] = item["potentials"]
        records = character_entities_from_structured(
            page,
            name=common["name"],
            description=common["description"],
            element=common["element"],
            weapon_types=common["weapon_types"],
            character_image=common["character_image"],
            element_icon=common["element_icon"],
            rarity=rarity,
            source_priority=100,
            profile_details=profiles,
        )
        if profiles:
            return records
        # still emit profiles if no skills/potentials are available yet
        if common["weapon_types"]:
            return records
        return records

    def _weapon_entities(self, page: PageRecord) -> list[EntityRecord]:
        lines = [normalize_space(x) for x in page.metadata.get("dom_lines", []) if normalize_space(x)]
        images = page_images(page)
        name = normalize_space(page.h1)
        weapon_type = ""
        rarity = ""
        attack = ""
        description = ""
        secondary_stat_name = ""
        secondary_stat_value = ""
        if "Description" in lines:
            idx = lines.index("Description") + 1
            if idx < len(lines):
                description = lines[idx]
        if "Quick Information" in lines:
            idx = lines.index("Quick Information") + 1
            quick = lines[idx : idx + 10]
            for i in range(len(quick) - 1):
                if quick[i] == "Type" and is_weapon_type(quick[i + 1]):
                    weapon_type = canonical_weapon_type(quick[i + 1])
                elif quick[i] == "Rarity":
                    rarity = quick[i + 1]
                elif quick[i] == "Attack":
                    attack = quick[i + 1]
        if "Weapon Statistics" in lines:
            idx = lines.index("Weapon Statistics") + 1
            stats = lines[idx : idx + 8]
            if len(stats) >= 4:
                attack = attack or stats[0]
                if stats[2] != "Attack":
                    secondary_stat_name = stats[2]
                    secondary_stat_value = stats[1] if len(stats) > 1 else ""
        if not weapon_type:
            for _, alt in images[:10]:
                if is_weapon_type(alt):
                    weapon_type = canonical_weapon_type(alt)
                    break
        return [
            EntityRecord(
                site=self.name,
                entity_type="weapon",
                name=name,
                slug=normalize_name_key(name),
                source_url=page.url,
                attributes={
                    "weapon_type": weapon_type,
                    "rarity": rarity,
                    "attack": attack,
                    "secondary_stat_name": secondary_stat_name,
                    "secondary_stat_value": secondary_stat_value,
                    "description": description,
                    "image": pick_first_image_by_alt(images, name),
                },
                tags=[weapon_type],
            )
        ]

    def _banner_entities(self, page: PageRecord) -> list[EntityRecord]:
        lines = [normalize_space(x) for x in page.metadata.get("dom_lines", []) if normalize_space(x)]
        images = page_images(page)
        name = normalize_space(page.h1)
        banner_type = ""
        status = ""
        date_range = ""
        featured: list[str] = []
        description = ""
        for line in lines[:20]:
            low = line.lower()
            if low in {"characters", "weapons"}:
                banner_type = low
            if low in {"inactive", "active", "upcoming"}:
                status = low
        for line in lines:
            if re.search(r"\d{1,2}\s+\w+\.\s+\d{4}\s+-\s+\d{1,2}\s+\w+\.\s+\d{4}", line.lower()):
                date_range = line
                break
        if "Description" in lines:
            idx = lines.index("Description") + 1
            if idx < len(lines):
                description = lines[idx]
        for idx, line in enumerate(lines):
            if line.startswith("⭐Featured"):
                featured = unique_preserve(lines[idx + 1 : idx + 12])
                break
        return [
            EntityRecord(
                site=self.name,
                entity_type="banner",
                name=name,
                slug=normalize_name_key(name),
                source_url=page.url,
                attributes={
                    "banner_type": banner_type,
                    "status": status,
                    "date_range": date_range,
                    "featured": featured,
                    "description": description,
                    "image": pick_first_image_by_alt(images, name),
                },
                tags=[banner_type, status],
            )
        ]

    def _boss_entities(self, page: PageRecord) -> list[EntityRecord]:
        images = page_images(page)
        lines = [normalize_space(x) for x in page.metadata.get("dom_lines", []) if normalize_space(x)]
        name = normalize_space(page.h1)
        unlock_requirements = ""
        if "Unlock Requirements" in lines:
            idx = lines.index("Unlock Requirements") + 1
            if idx < len(lines):
                unlock_requirements = lines[idx]
        return [
            EntityRecord(
                site=self.name,
                entity_type="boss",
                name=name,
                slug=normalize_name_key(name),
                source_url=page.url,
                attributes={
                    "description": page.summary,
                    "unlock_requirements": unlock_requirements,
                    "has_data_coming_soon": page.metadata.get("has_data_coming_soon", False),
                    "image": pick_first_image_by_alt(images, name),
                },
            )
        ]

    def _costume_entities(self, page: PageRecord) -> list[EntityRecord]:
        lines = [normalize_space(x) for x in page.metadata.get("dom_lines", []) if normalize_space(x)]
        name = normalize_space(page.h1)
        character = ""
        rarity = ""
        description = ""
        if "for" in lines:
            idx = lines.index("for") + 1
            if idx < len(lines):
                character = lines[idx]
        for line in lines:
            if line.endswith("Costume") or line.endswith("SSR Costume"):
                rarity = line
                break
        if "Description" in lines:
            idx = lines.index("Description") + 1
            if idx < len(lines):
                description = lines[idx]
        return [
            EntityRecord(
                site=self.name,
                entity_type="costume",
                name=name,
                slug=normalize_name_key(name),
                source_url=page.url,
                attributes={"character": character, "rarity": rarity, "description": description},
                tags=[character],
            )
        ]

    def _index_entities(self, page: PageRecord) -> list[EntityRecord]:
        base = page.page_type.removesuffix("_index")
        name = normalize_space(page.h1 or base.title())
        attributes = {
            "summary": page.summary,
            "has_data_coming_soon": page.metadata.get("has_data_coming_soon", False),
        }
        if base in {"pets", "fishing", "items", "foods"}:
            return [
                EntityRecord(
                    site=self.name,
                    entity_type="resource_collection",
                    name=name,
                    slug=base,
                    source_url=page.url,
                    attributes={"resource_type": base, **attributes},
                    tags=[base],
                )
            ]
        if base == "weapons":
            lines = [normalize_space(x) for x in page.metadata.get("dom_lines", []) if normalize_space(x)]
            filters = [canonical_weapon_type(x) for x in lines if is_weapon_type(x)]
            return [
                EntityRecord(
                    site=self.name,
                    entity_type="collection",
                    name=name,
                    slug=base,
                    source_url=page.url,
                    attributes={**attributes, "collection_type": base, "weapon_type_filters": unique_preserve(filters)},
                    tags=unique_preserve(filters),
                )
            ]
        return [
            EntityRecord(
                site=self.name,
                entity_type="collection",
                name=name,
                slug=base,
                source_url=page.url,
                attributes={**attributes, "collection_type": base},
            )
        ]
