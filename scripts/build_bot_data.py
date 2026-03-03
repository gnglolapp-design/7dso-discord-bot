from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def lower(s: Any) -> str:
    return str(s or "").strip().lower()


def group_resources(resources: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    buckets = {
        "familiers": [],
        "peche": [],
        "objet": [],
        "nourriture": [],
    }
    for item in resources:
        kind = lower(item.get("subtype") or item.get("name") or item.get("category"))
        source_type = lower(item.get("type"))
        if "pet" in kind or "fam" in kind or "pet" in source_type:
            buckets["familiers"].append(item)
        elif "fish" in kind or "pêch" in kind or "pech" in kind or "fishing" in source_type:
            buckets["peche"].append(item)
        elif "food" in kind or "plat" in kind or "nour" in kind:
            buckets["nourriture"].append(item)
        else:
            buckets["objet"].append(item)
    return buckets


def build_characters(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for row in records:
        if row.get("entity_type") != "character":
            continue
        attrs = row.get("attributes", {})
        profiles = attrs.get("weapon_profiles", [])
        out.append({
            "id": row.get("canonical_id") or row.get("id"),
            "name": attrs.get("name") or row.get("title") or row.get("canonical_name"),
            "description": attrs.get("description"),
            "image": attrs.get("image"),
            "element": attrs.get("element"),
            "element_icon": attrs.get("element_icon"),
            "weapon_types": attrs.get("weapon_types", []),
            "base_stats": attrs.get("base_stats", {}),
            "aliases": attrs.get("aliases", []),
            "sources": row.get("sources", []),
            "weapon_profiles": profiles,
        })
    return sorted(out, key=lambda x: lower(x.get("name")))


def build_simple(records: list[dict[str, Any]], entity_type: str, output_name: str) -> list[dict[str, Any]]:
    out = []
    for row in records:
        if row.get("entity_type") != entity_type:
            continue
        attrs = row.get("attributes", {})
        payload = {
            "id": row.get("canonical_id") or row.get("id"),
            "name": attrs.get("name") or row.get("title") or row.get("canonical_name"),
            "description": attrs.get("description"),
            "image": attrs.get("image"),
            "sources": row.get("sources", []),
        }
        payload.update(attrs)
        out.append(payload)
    return sorted(out, key=lambda x: lower(x.get("name")))


def main() -> int:
    canonical_dir = Path("scrape-data/canonical")
    docs_data = Path("docs/data")

    all_records = read_jsonl(canonical_dir / "all.jsonl")
    resources = build_simple(all_records, "resource_collection", "resources")
    resource_buckets = group_resources(resources)

    write_json(docs_data / "characters.json", build_characters(all_records))
    write_json(docs_data / "weapons.json", build_simple(all_records, "weapon", "weapons"))
    write_json(docs_data / "banners.json", build_simple(all_records, "banner", "banners"))
    write_json(docs_data / "bosses.json", build_simple(all_records, "boss", "bosses"))
    write_json(docs_data / "guides.json", build_simple(all_records, "guide", "guides"))
    write_json(docs_data / "team_comps.json", build_simple(all_records, "team_comp", "team_comps"))
    write_json(docs_data / "resources.json", resources)
    write_json(docs_data / "familiers.json", resource_buckets["familiers"])
    write_json(docs_data / "peche.json", resource_buckets["peche"])
    write_json(docs_data / "objets.json", resource_buckets["objet"])
    write_json(docs_data / "nourriture.json", resource_buckets["nourriture"])

    coverage_src = canonical_dir / "coverage_report.json"
    if coverage_src.exists():
        write_json(docs_data / "coverage_report.json", json.loads(coverage_src.read_text(encoding="utf-8")))
    else:
        write_json(docs_data / "coverage_report.json", {"warning": "coverage_report.json absent"})

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
