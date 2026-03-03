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


def first_source(row: dict[str, Any]) -> dict[str, Any]:
    sources = row.get("sources") or []
    return sources[0] if sources else {}

def slug_from_url(url: Any) -> str | None:
    s = str(url or "").strip()
    if not s:
        return None
    s = s.split("?", 1)[0].split("#", 1)[0].rstrip("/")
    if "/" in s:
        return s.rsplit("/", 1)[-1] or None
    return s or None

def pick(attrs: dict[str, Any], *keys: str) -> Any:
    for k in keys:
        if k in attrs and attrs.get(k) not in (None, "", [], {}):
            return attrs.get(k)
    return None


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
    out: list[dict[str, Any]] = []
    for row in records:
        if row.get("entity_type") != "character":
            continue
        attrs = row.get("attributes", {}) or {}
        src0 = first_source(row)
        profiles = attrs.get("weapon_profiles", []) or []

        name = (
            pick(attrs, "name", "character_name", "display_name")
            or row.get("title")
            or row.get("canonical_name")
            or src0.get("name")
        )
        _id = row.get("canonical_id") or row.get("id") or slug_from_url(src0.get("source_url")) or name

        image = pick(attrs, "image", "image_url", "portrait", "icon", "thumbnail", "cover")
        description = pick(attrs, "description", "summary", "lore")
        element = pick(attrs, "element", "attribute", "type")
        element_icon = pick(attrs, "element_icon", "elementIcon", "element_image", "element_image_url", "element_url")
        weapon_types = pick(attrs, "weapon_types", "weaponTypes", "weapons") or []
        base_stats = pick(attrs, "base_stats", "baseStats", "stats", "base") or {}
        aliases = pick(attrs, "aliases", "alias") or []

        out.append({
            "id": _id,
            "name": name,
            "description": description,
            "image": image,
            "element": element,
            "element_icon": element_icon,
            "weapon_types": weapon_types,
            "base_stats": base_stats,
            "aliases": aliases,
            "sources": row.get("sources", []),
            "weapon_profiles": profiles,
        })
    return sorted(out, key=lambda x: lower(x.get("name")))


def safe_id(value: Any) -> str:
    s = str(value or "").strip()
    if not s:
        return "unknown"
    return "".join(ch for ch in s if ch.isalnum() or ch in "-_ ").strip().replace(" ", "-")


def split_entities(
    *,
    out_dir: Path,
    entity_name: str,
    items: list[dict[str, Any]],
    index_fields: list[str],
) -> None:
    """Write index + per-id json to reduce bot CPU."""

    by_id_dir = out_dir / entity_name / "by-id"
    index_path = out_dir / entity_name / "index.json"

    index_rows: list[dict[str, Any]] = []
    for it in items:
        _id = safe_id(it.get("id") or it.get("name"))
        it = dict(it)
        it["id"] = _id

        write_json(by_id_dir / f"{_id}.json", it)

        row = {"id": _id}
        for f in index_fields:
            row[f] = it.get(f)
        index_rows.append(row)

    write_json(index_path, sorted(index_rows, key=lambda x: lower(x.get("name"))))


def build_simple(records: list[dict[str, Any]], entity_type: str, output_name: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in records:
        if row.get("entity_type") != entity_type:
            continue
        attrs = row.get("attributes", {}) or {}
        src0 = first_source(row)

        name = (
            pick(attrs, "name", "display_name", "title")
            or row.get("title")
            or row.get("canonical_name")
            or src0.get("name")
        )
        _id = row.get("canonical_id") or row.get("id") or slug_from_url(src0.get("source_url")) or name

        payload: dict[str, Any] = {
            "id": _id,
            "name": name,
            "description": pick(attrs, "description", "summary", "text"),
            "image": pick(attrs, "image", "image_url", "icon", "thumbnail", "cover"),
            "sources": row.get("sources", []),
        }
        # keep all attrs for forward-compat (stats, type, rarity, etc.)
        payload.update(attrs)

        # ensure minimal fields exist even if attrs overwrote with None
        if not payload.get("id"):
            payload["id"] = _id
        if not payload.get("name"):
            payload["name"] = name
        if payload.get("description") in ("", []):
            payload["description"] = None
        if payload.get("image") in ("", []):
            payload["image"] = None

        out.append(payload)

    return sorted(out, key=lambda x: lower(x.get("name")))


def main() -> int:
    canonical_dir = Path("scrape-data/canonical")
    docs_data = Path("docs/data")

    all_records = read_jsonl(canonical_dir / "all.jsonl")
    resources = build_simple(all_records, "resource_collection", "resources")
    resource_buckets = group_resources(resources)

    characters = build_characters(all_records)
    weapons = build_simple(all_records, "weapon", "weapons")

    write_json(docs_data / "characters.json", characters)
    write_json(docs_data / "weapons.json", weapons)
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

    # Split large datasets into index + per-id files for the Discord bot.
    split_entities(
        out_dir=docs_data,
        entity_name="characters",
        items=characters,
        index_fields=["name", "element", "image", "weapon_types"],
    )
    split_entities(
        out_dir=docs_data,
        entity_name="weapons",
        items=weapons,
        index_fields=["name", "type", "rarity", "image"],
    )

    return 0




if __name__ == "__main__":
    raise SystemExit(main())
