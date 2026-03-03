from __future__ import annotations

from urllib.parse import urlparse

from bs4 import BeautifulSoup

from sds_origin_scraper.models import EntityRecord, PageRecord
from sds_origin_scraper.parsers.base import SiteAdapter
from sds_origin_scraper.parsers.helpers import (
    character_entities_from_structured,
    hideout_base_stats,
    hideout_weapon_pairs,
    page_images,
)
from sds_origin_scraper.utils import normalize_name_key, normalize_space, pick_first_image_by_alt, unique_preserve


class HideoutGachaAdapter(SiteAdapter):
    name = "hideoutgacha.com"
    allowed_domains = {"www.hideoutgacha.com", "hideoutgacha.com"}
    seed_urls = [
        "https://www.hideoutgacha.com/games/seven-deadly-sins-origin",
        "https://www.hideoutgacha.com/games/seven-deadly-sins-origin/general-info",
        "https://www.hideoutgacha.com/games/seven-deadly-sins-origin/map-information",
        "https://www.hideoutgacha.com/games/seven-deadly-sins-origin/progression-guide",
        "https://www.hideoutgacha.com/games/seven-deadly-sins-origin/tier-list",
        "https://www.hideoutgacha.com/games/seven-deadly-sins-origin/boss-guide",
        "https://www.hideoutgacha.com/games/seven-deadly-sins-origin/characters",
        "https://www.hideoutgacha.com/games/seven-deadly-sins-origin/team-compositions",
        "https://www.hideoutgacha.com/games/seven-deadly-sins-origin/combat-guide",
    ]

    def page_type(self, url: str, soup: BeautifulSoup) -> str:
        path = urlparse(url).path.rstrip("/")
        parts = [p for p in path.split("/") if p]
        if parts == ["games", "seven-deadly-sins-origin"]:
            return "hub"
        if len(parts) >= 3 and parts[:2] == ["games", "seven-deadly-sins-origin"]:
            section = parts[2]
            if section == "characters" and len(parts) == 4:
                return "character_guide"
            if section == "characters":
                return "character_index"
            return f"{section}_guide"
        return "page"

    def metadata(self, url: str, soup: BeautifulSoup) -> dict:
        text = soup.get_text(" ", strip=True)
        return {
            "slug": normalize_name_key(urlparse(url).path.split("/")[-1] or "home"),
            "path": urlparse(url).path,
            "coming_soon": "Coming Soon" in text,
        }

    def extract_entities(self, page: PageRecord) -> list[EntityRecord]:
        if page.page_type == "character_guide":
            return self._character_entities(page)
        if page.page_type == "character_index":
            return self._character_index_entities(page)
        if page.page_type.endswith("_guide"):
            return self._guide_entities(page)
        return []

    def _character_entities(self, page: PageRecord) -> list[EntityRecord]:
        images = page_images(page)
        name = normalize_space(page.h1)
        lines = [normalize_space(x) for x in page.metadata.get("dom_lines", []) if normalize_space(x)]
        description = ""
        if "Overview" in lines:
            idx = lines.index("Overview") + 1
            if idx < len(lines):
                description = lines[idx]
        base_stats = hideout_base_stats(page)
        pairs = hideout_weapon_pairs(page)
        weapon_types = [p["weapon_type"] for p in pairs]
        element = pairs[0]["element"] if pairs else ""
        profiles = {p["weapon_type"]: {"weapon_type": p["weapon_type"], "element": p["element"], "skills": [], "potentials": []} for p in pairs}
        return character_entities_from_structured(
            page,
            name=name,
            description=description or page.summary,
            element=element,
            weapon_types=weapon_types,
            character_image=pick_first_image_by_alt(images, name),
            rarity="",
            base_stats=base_stats,
            source_priority=50,
            profile_details=profiles,
        )

    def _character_index_entities(self, page: PageRecord) -> list[EntityRecord]:
        lines = [normalize_space(x) for x in page.metadata.get("dom_lines", []) if normalize_space(x)]
        count_text = next((line for line in lines if "heroes" in line and "guides" in line), "")
        roster: list[str] = []
        capture = False
        for line in lines:
            if line == "Character Roster":
                capture = True
                continue
            if not capture:
                continue
            if line in {"HIDEOUT GUIDES", "Games", "Privacy Policy", "Terms of Service"}:
                break
            if line == "Soon":
                continue
            if line and line[0].isupper() and len(line.split()) <= 3 and "heroes" not in line.lower() and "guide" not in line.lower():
                roster.append(line)
        roster = unique_preserve(roster)
        return [
            EntityRecord(
                site=self.name,
                entity_type="collection",
                name="Hideout Character Roster",
                slug="hideout-character-roster",
                source_url=page.url,
                attributes={"collection_type": "character_roster", "count_text": count_text, "roster": roster},
                tags=["characters"],
            )
        ]

    def _guide_entities(self, page: PageRecord) -> list[EntityRecord]:
        guide_type = page.page_type.removesuffix("_guide")
        lines = [normalize_space(x) for x in page.metadata.get("dom_lines", []) if normalize_space(x)]
        data = {
            "guide_type": guide_type,
            "summary": page.summary,
            "sections": [section.heading for section in page.sections],
        }
        records = [
            EntityRecord(
                site=self.name,
                entity_type="guide",
                name=normalize_space(page.h1),
                slug=normalize_name_key(page.h1 or guide_type),
                source_url=page.url,
                attributes=data,
                tags=[guide_type],
            )
        ]
        if guide_type == "team-compositions":
            records.extend(self._team_entities(page))
        return records

    def _team_entities(self, page: PageRecord) -> list[EntityRecord]:
        lines = [normalize_space(x) for x in page.metadata.get("dom_lines", []) if normalize_space(x)]
        teams: list[EntityRecord] = []
        current_team: dict | None = None
        members: list[dict[str, str]] = []
        idx = 0
        while idx < len(lines):
            line = lines[idx]
            if line.startswith("Offense") or line.startswith("Defense") or line.startswith("Support"):
                idx += 1
                continue
            if line and idx + 1 < len(lines) and lines[idx + 1] in {"Main DPS", "Sub DPS", "Support", "Healer", "Debuffer", "Tank"}:
                if current_team is not None:
                    members.append({
                        "character": line,
                        "role": lines[idx + 1],
                        "weapon_type": lines[idx].split()[-1] if " " in lines[idx] else "",
                    })
                idx += 2
                continue
            if line and line[0].isupper() and len(line) > 2 and not line.endswith("team s"):
                if current_team is not None and members:
                    current_team["members"] = members
                    teams.append(
                        EntityRecord(
                            site=self.name,
                            entity_type="team_comp",
                            name=current_team["name"],
                            slug=normalize_name_key(current_team["name"]),
                            source_url=page.url,
                            attributes=current_team,
                            tags=["team"],
                        )
                    )
                    members = []
                current_team = {"name": line, "members": []}
            idx += 1
        if current_team is not None and members:
            current_team["members"] = members
            teams.append(
                EntityRecord(
                    site=self.name,
                    entity_type="team_comp",
                    name=current_team["name"],
                    slug=normalize_name_key(current_team["name"]),
                    source_url=page.url,
                    attributes=current_team,
                    tags=["team"],
                )
            )
        return teams
