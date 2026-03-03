from __future__ import annotations

import re
from typing import Any

from sds_origin_scraper.models import EntityRecord, ImageRecord, PageRecord
from sds_origin_scraper.utils import (
    canonical_element,
    canonical_weapon_type,
    extract_repeated_token,
    is_element_name,
    is_weapon_type,
    maybe_skill_kind,
    merge_lists,
    normalize_name_key,
    normalize_space,
    parse_labeled_stats,
    pick_first_image_by_alt,
    unique_preserve,
)


def page_images(page: PageRecord) -> list[tuple[str, str]]:
    return [(img.url, img.alt) for img in page.images]


def _strip_title_suffix(title: str) -> str:
    title = normalize_space(title)
    title = re.sub(r"\s+Build\s*[|\-].*$", "", title)
    title = re.sub(r"\s*[|\-]\s*Seven Deadly Sins: Origin.*$", "", title)
    title = re.sub(r"\s*[|\-]\s*7DS Origin.*$", "", title)
    return normalize_space(title)


def extract_character_profile_common(page: PageRecord) -> dict[str, Any]:
    lines = [normalize_space(x) for x in page.metadata.get("dom_lines", []) if normalize_space(x)]
    images = page_images(page)
    name = _strip_title_suffix(page.h1 or page.title)
    weapon_types: list[str] = []
    if "Type" in lines:
        start = lines.index("Type") + 1
        for value in lines[start:]:
            if value.startswith("Skills of") or value.startswith("Costumes") or value.startswith("Weapons"):
                break
            if is_weapon_type(value):
                weapon_types.append(canonical_weapon_type(value))
    weapon_types = unique_preserve(weapon_types)
    repeated_element = extract_repeated_token([x.lower() for x in lines[:40]], {"fire", "ice", "cold", "earth", "wind", "thunder", "dark", "darkness", "holy", "light"})
    element = canonical_element(repeated_element.title() if repeated_element else "")
    if not element:
        for src, alt in images[:20]:
            if is_element_name(alt):
                element = canonical_element(alt)
                break
    description = ""
    for section in page.sections:
        if normalize_name_key(section.heading) == "description" and section.body:
            description = normalize_space(" ".join(section.body))
            break
    if not description:
        description = page.summary
    return {
        "name": name,
        "description": description,
        "weapon_types": weapon_types,
        "element": element,
        "character_image": pick_first_image_by_alt(images, name),
        "element_icon": pick_first_image_by_alt(images, element),
    }


def extract_skill_chunks(page: PageRecord, weapon_types: list[str]) -> list[dict[str, Any]]:
    sections = page.sections
    images = page_images(page)
    start_idx = None
    for idx, section in enumerate(sections):
        if section.heading.startswith("Skills of"):
            start_idx = idx + 1
            break
    if start_idx is None or not weapon_types:
        return []
    skill_sections: list[dict[str, Any]] = []
    for section in sections[start_idx:]:
        if section.heading.startswith("Potentials of") or section.heading.startswith("All Skins"):
            break
        if re.fullmatch(r"Tier\s+\d+", section.heading):
            break
        if normalize_space(section.heading) in weapon_types:
            continue
        if section.level != 4:
            continue
        body_lines = [normalize_space(x) for x in section.body if normalize_space(x)]
        kind = maybe_skill_kind(body_lines[0]) if body_lines else None
        description = normalize_space(" ".join(body_lines[1:] if kind else body_lines))
        skill_sections.append(
            {
                "name": normalize_space(section.heading),
                "kind": kind or "unknown",
                "description": description,
                "icon": pick_first_image_by_alt(images, section.heading),
            }
        )
    if not skill_sections:
        return []
    skills_per_weapon = len(skill_sections) // len(weapon_types)
    if skills_per_weapon <= 0:
        return []
    profiles: list[dict[str, Any]] = []
    for index, weapon_type in enumerate(weapon_types):
        chunk = skill_sections[index * skills_per_weapon : (index + 1) * skills_per_weapon]
        profiles.append({"weapon_type": weapon_type, "skills": chunk})
    return profiles


def extract_potential_chunks(page: PageRecord, weapon_types: list[str]) -> list[dict[str, Any]]:
    sections = page.sections
    images = page_images(page)
    start_idx = None
    for idx, section in enumerate(sections):
        if section.heading.startswith("Potentials of"):
            start_idx = idx + 1
            break
    if start_idx is None or not weapon_types:
        return []
    potential_sections: list[dict[str, Any]] = []
    for section in sections[start_idx:]:
        if section.heading.startswith("All Skins") or section.heading.startswith("Similar"):
            break
        if section.level != 4:
            continue
        match = re.fullmatch(r"Tier\s+(\d+)", section.heading)
        if not match:
            continue
        tier = int(match.group(1))
        body = normalize_space(" ".join(section.body))
        potential_sections.append({"tier": tier, "bonus": body, "icon": pick_first_image_by_alt(images, section.heading)})
    if not potential_sections:
        return []
    tiers_per_weapon = len(potential_sections) // len(weapon_types)
    if tiers_per_weapon <= 0:
        return []
    profiles: list[dict[str, Any]] = []
    for index, weapon_type in enumerate(weapon_types):
        chunk = potential_sections[index * tiers_per_weapon : (index + 1) * tiers_per_weapon]
        profiles.append({"weapon_type": weapon_type, "potentials": chunk})
    return profiles


def character_entities_from_structured(
    page: PageRecord,
    *,
    name: str,
    description: str,
    element: str,
    weapon_types: list[str],
    character_image: str = "",
    element_icon: str = "",
    rarity: str = "",
    base_stats: dict[str, Any] | None = None,
    source_priority: int = 0,
    profile_details: dict[str, dict[str, Any]] | None = None,
) -> list[EntityRecord]:
    profile_details = profile_details or {}
    records: list[EntityRecord] = []
    slug = normalize_name_key(name)
    records.append(
        EntityRecord(
            site=page.site,
            entity_type="character",
            name=name,
            slug=slug,
            source_url=page.url,
            attributes={
                "description": description,
                "element": element,
                "weapon_types": weapon_types,
                "character_image": character_image,
                "element_icon": element_icon,
                "rarity": rarity,
                "base_stats": base_stats or {},
                "source_priority": source_priority,
            },
            tags=merge_lists([element], weapon_types),
        )
    )
    for weapon_type in weapon_types:
        details = profile_details.get(weapon_type, {})
        records.append(
            EntityRecord(
                site=page.site,
                entity_type="character_weapon_profile",
                name=f"{name} - {weapon_type}",
                slug=f"{slug}--{normalize_name_key(weapon_type)}",
                source_url=page.url,
                attributes={
                    "character": name,
                    "character_slug": slug,
                    "weapon_type": weapon_type,
                    "weapon_type_icon": pick_first_image_by_alt(page_images(page), weapon_type),
                    "element": details.get("element") or element,
                    "skills": details.get("skills", []),
                    "potentials": details.get("potentials", []),
                    "character_image": character_image,
                },
                tags=merge_lists([weapon_type], [element]),
            )
        )
        for skill in details.get("skills", []):
            skill_name = normalize_space(skill.get("name", ""))
            records.append(
                EntityRecord(
                    site=page.site,
                    entity_type="skill",
                    name=f"{name} / {weapon_type} / {skill_name}",
                    slug=f"{slug}--{normalize_name_key(weapon_type)}--{normalize_name_key(skill_name)}",
                    source_url=page.url,
                    attributes={
                        "character": name,
                        "character_slug": slug,
                        "weapon_type": weapon_type,
                        **skill,
                    },
                    tags=merge_lists([weapon_type], [skill.get("kind", "")]),
                )
            )
        for potential in details.get("potentials", []):
            tier = potential.get("tier")
            records.append(
                EntityRecord(
                    site=page.site,
                    entity_type="potential",
                    name=f"{name} / {weapon_type} / Tier {tier}",
                    slug=f"{slug}--{normalize_name_key(weapon_type)}--tier-{tier}",
                    source_url=page.url,
                    attributes={
                        "character": name,
                        "character_slug": slug,
                        "weapon_type": weapon_type,
                        **potential,
                    },
                    tags=[weapon_type],
                )
            )
    return records


def hideout_base_stats(page: PageRecord) -> dict[str, str]:
    lines = [normalize_space(x) for x in page.metadata.get("dom_lines", []) if normalize_space(x)]
    try:
        start = lines.index("Base Stats") + 1
    except ValueError:
        return {}
    out_lines: list[str] = []
    for value in lines[start:]:
        if value == "Weapons" or value == "Armor" or value == "Potentials":
            break
        out_lines.append(value)
    return parse_labeled_stats(out_lines)


def hideout_weapon_pairs(page: PageRecord) -> list[dict[str, str]]:
    lines = [normalize_space(x) for x in page.metadata.get("dom_lines", []) if normalize_space(x)]
    try:
        start = lines.index("Weapons") + 1
    except ValueError:
        return []
    values: list[str] = []
    for value in lines[start:]:
        if value in {"Armor", "Potentials", "HIDEOUT GUIDES", "Games"}:
            break
        values.append(value)
    cleaned = [v for v in values if is_weapon_type(v) or is_element_name(v)]
    pairs: list[dict[str, str]] = []
    for index in range(0, len(cleaned), 2):
        weapon = cleaned[index] if index < len(cleaned) else ""
        element = cleaned[index + 1] if index + 1 < len(cleaned) else ""
        if weapon and is_weapon_type(weapon):
            pairs.append({
                "weapon_type": canonical_weapon_type(weapon),
                "element": canonical_element(element),
            })
    return pairs
