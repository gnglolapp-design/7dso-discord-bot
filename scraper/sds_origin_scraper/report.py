from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable

from sds_origin_scraper.models import CanonicalRecord, EntityRecord, PageRecord
from sds_origin_scraper.utils import write_json, write_jsonl


def build_coverage_report(pages: Iterable[PageRecord], raw_entities: Iterable[EntityRecord], canonical_records: Iterable[CanonicalRecord]) -> dict:
    pages = list(pages)
    raw_entities = list(raw_entities)
    canonical_records = list(canonical_records)

    by_site_pages = Counter(page.site for page in pages)
    by_site_entities = Counter(entity.site for entity in raw_entities)
    by_type_raw = Counter(entity.entity_type for entity in raw_entities)
    by_type_canonical = Counter(record.entity_type for record in canonical_records)

    character_profiles = [record for record in canonical_records if record.entity_type == "character_weapon_profile"]
    profile_status = {
        "profiles_total": len(character_profiles),
        "profiles_with_skills": sum(1 for record in character_profiles if record.data.get("skills")),
        "profiles_with_potentials": sum(1 for record in character_profiles if record.data.get("potentials")),
        "profiles_with_weapon_type_icon": sum(1 for record in character_profiles if record.data.get("weapon_type_icon")),
    }

    characters = [record for record in canonical_records if record.entity_type == "character"]
    character_status = {
        "characters_total": len(characters),
        "characters_with_image": sum(1 for record in characters if record.data.get("character_image")),
        "characters_with_element_icon": sum(1 for record in characters if record.data.get("element_icon")),
        "characters_with_base_stats": sum(1 for record in characters if record.data.get("base_stats")),
    }

    coverage_flags = defaultdict(int)
    for record in canonical_records:
        if record.entity_type == "resource_collection":
            coverage_flags[f"resource_collection:{record.slug}"] += 1
        if record.entity_type == "boss" and record.data.get("has_data_coming_soon"):
            coverage_flags["bosses_with_placeholder_data"] += 1

    report = {
        "pages_by_site": dict(by_site_pages),
        "raw_entities_by_site": dict(by_site_entities),
        "raw_entities_by_type": dict(by_type_raw),
        "canonical_entities_by_type": dict(by_type_canonical),
        "character_status": character_status,
        "profile_status": profile_status,
        "coverage_flags": dict(coverage_flags),
    }
    return report


def export_report(out_dir: str | Path, report: dict) -> None:
    out_dir = Path(out_dir)
    write_json(out_dir / "canonical" / "coverage_report.json", report)
    rows = [{"metric": key, "value": value} for key, value in flatten_report(report).items()]
    write_jsonl(out_dir / "canonical" / "coverage_report_flat.jsonl", rows, mode="w")


def flatten_report(report: dict, prefix: str = "") -> dict[str, object]:
    out: dict[str, object] = {}
    for key, value in report.items():
        full_key = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            out.update(flatten_report(value, full_key))
        else:
            out[full_key] = value
    return out
