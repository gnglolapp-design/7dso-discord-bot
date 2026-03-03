from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Iterable

from sds_origin_scraper.models import CanonicalRecord, EntityRecord
from sds_origin_scraper.utils import merge_lists, normalize_name_key, normalize_space, write_jsonl


SOURCE_PRIORITY = {
    "7dsorigin.gg": 100,
    "genshin.gg": 90,
    "hideoutgacha.com": 50,
}


def _priority(entity: EntityRecord) -> int:
    return int(entity.attributes.get("source_priority") or SOURCE_PRIORITY.get(entity.site, 0))


def _best_text(entities: list[EntityRecord], field: str) -> str:
    candidates = sorted(entities, key=_priority, reverse=True)
    for entity in candidates:
        value = normalize_space(entity.attributes.get(field, ""))
        if value:
            return value
    return ""


def _best_nonempty(entities: list[EntityRecord], field: str):
    candidates = sorted(entities, key=_priority, reverse=True)
    for entity in candidates:
        value = entity.attributes.get(field)
        if value:
            return value
    return None


def _source_refs(entities: list[EntityRecord]) -> list[dict]:
    refs = []
    for entity in entities:
        refs.append(
            {
                "site": entity.site,
                "source_url": entity.source_url,
                "entity_type": entity.entity_type,
                "name": entity.name,
            }
        )
    return refs


def build_canonical_records(entities: Iterable[EntityRecord]) -> list[CanonicalRecord]:
    entities = list(entities)
    out: list[CanonicalRecord] = []
    out.extend(_merge_characters([e for e in entities if e.entity_type == "character"]))
    out.extend(_merge_character_weapon_profiles([e for e in entities if e.entity_type == "character_weapon_profile"]))
    out.extend(_merge_simple_named([e for e in entities if e.entity_type == "weapon"], "weapon"))
    out.extend(_merge_simple_named([e for e in entities if e.entity_type == "boss"], "boss"))
    out.extend(_merge_simple_named([e for e in entities if e.entity_type == "banner"], "banner"))
    out.extend(_merge_simple_named([e for e in entities if e.entity_type == "guide"], "guide"))
    out.extend(_merge_simple_named([e for e in entities if e.entity_type == "team_comp"], "team_comp"))
    out.extend(_merge_simple_named([e for e in entities if e.entity_type == "resource_collection"], "resource_collection"))
    out.extend(_merge_simple_named([e for e in entities if e.entity_type == "interactive_map"], "interactive_map"))
    out.extend(_merge_simple_named([e for e in entities if e.entity_type == "collection"], "collection"))
    out.extend(_merge_simple_named([e for e in entities if e.entity_type == "costume"], "costume"))
    return out


def export_canonical_jsonl(out_dir: str | Path, records: Iterable[CanonicalRecord]) -> None:
    out_dir = Path(out_dir)
    records = list(records)
    write_jsonl(out_dir / "canonical" / "all.jsonl", [record.to_dict() for record in records], mode="w")
    for entity_type in sorted({record.entity_type for record in records}):
        rows = [record.to_dict() for record in records if record.entity_type == entity_type]
        write_jsonl(out_dir / "canonical" / f"{entity_type}.jsonl", rows, mode="w")


def _merge_characters(entities: list[EntityRecord]) -> list[CanonicalRecord]:
    groups: dict[str, list[EntityRecord]] = defaultdict(list)
    for entity in entities:
        groups[normalize_name_key(entity.name)].append(entity)
    out: list[CanonicalRecord] = []
    for key, group in sorted(groups.items()):
        ordered = sorted(group, key=_priority, reverse=True)
        name = ordered[0].name
        weapon_types = merge_lists(*(entity.attributes.get("weapon_types", []) for entity in ordered))
        base_stats = _best_nonempty(ordered, "base_stats") or {}
        data = {
            "description": _best_text(ordered, "description"),
            "element": _best_text(ordered, "element"),
            "weapon_types": weapon_types,
            "rarity": _best_text(ordered, "rarity"),
            "base_stats": base_stats,
            "character_image": _best_text(ordered, "character_image"),
            "element_icon": _best_text(ordered, "element_icon"),
            "source_count": len(group),
        }
        out.append(
            CanonicalRecord(
                entity_type="character",
                entity_id=f"character:{key}",
                name=name,
                slug=key,
                data=data,
                sources=_source_refs(group),
                aliases=merge_lists(*(entity.aliases for entity in ordered)),
                tags=merge_lists(*(entity.tags for entity in ordered)),
            )
        )
    return out


def _merge_character_weapon_profiles(entities: list[EntityRecord]) -> list[CanonicalRecord]:
    groups: dict[str, list[EntityRecord]] = defaultdict(list)
    for entity in entities:
        char_slug = normalize_name_key(entity.attributes.get("character_slug") or entity.attributes.get("character") or entity.name)
        weapon_type = normalize_name_key(entity.attributes.get("weapon_type", ""))
        groups[f"{char_slug}::{weapon_type}"].append(entity)
    out: list[CanonicalRecord] = []
    for key, group in sorted(groups.items()):
        ordered = sorted(group, key=_priority, reverse=True)
        best = ordered[0]
        all_skills = []
        seen_skill = set()
        all_potentials = []
        seen_tier = set()
        for entity in ordered:
            for skill in entity.attributes.get("skills", []):
                skill_key = normalize_name_key(skill.get("name", ""))
                if skill_key and skill_key not in seen_skill:
                    seen_skill.add(skill_key)
                    all_skills.append(skill)
            for potential in entity.attributes.get("potentials", []):
                tier = potential.get("tier")
                if tier not in seen_tier:
                    seen_tier.add(tier)
                    all_potentials.append(potential)
        data = dict(best.attributes)
        data["skills"] = sorted(all_skills, key=lambda x: normalize_name_key(x.get("name", "")))
        data["potentials"] = sorted(all_potentials, key=lambda x: int(x.get("tier", 999)))
        out.append(
            CanonicalRecord(
                entity_type="character_weapon_profile",
                entity_id=f"character_weapon_profile:{key}",
                name=best.name,
                slug=normalize_name_key(best.slug),
                data=data,
                sources=_source_refs(group),
                aliases=merge_lists(*(entity.aliases for entity in ordered)),
                tags=merge_lists(*(entity.tags for entity in ordered)),
            )
        )
    return out


def _merge_simple_named(entities: list[EntityRecord], entity_type: str) -> list[CanonicalRecord]:
    groups: dict[str, list[EntityRecord]] = defaultdict(list)
    for entity in entities:
        groups[normalize_name_key(entity.name)].append(entity)
    out: list[CanonicalRecord] = []
    for key, group in sorted(groups.items()):
        ordered = sorted(group, key=_priority, reverse=True)
        data = dict(ordered[0].attributes)
        for entity in ordered[1:]:
            for field, value in entity.attributes.items():
                if field not in data or not data[field]:
                    data[field] = value
        out.append(
            CanonicalRecord(
                entity_type=entity_type,
                entity_id=f"{entity_type}:{key}",
                name=ordered[0].name,
                slug=key,
                data=data,
                sources=_source_refs(group),
                aliases=merge_lists(*(entity.aliases for entity in ordered)),
                tags=merge_lists(*(entity.tags for entity in ordered)),
            )
        )
    return out
