from __future__ import annotations

"""
Build Discord-bot friendly JSON in docs/data/ from the scraper canonical export.

Why:
- The scraper emits canonical entities in JSONL. Some canonical fields may be missing (name/id/image/etc.).
- Discord menus require stable unique option values; we generate a stable `id` and ensure `name` is filled.
- We fail HARD if canonical input is missing/empty so CI won't silently publish empty [].

Output files (docs/data):
- characters.json, weapons.json, banners.json, bosses.json, guides.json, team_comps.json
- resources.json, familiers.json, peche.json, objets.json, nourriture.json
- coverage_report.json (copied if present)
"""

import os
from pathlib import Path
from urllib.parse import urlparse
import json
import re
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "data"

# Candidate locations for canonical export.
CANON_DIR_CANDIDATES = [
    ROOT / "scrape-data" / "canonical",
    ROOT / "scraper" / "scrape-data" / "canonical",
    ROOT / ".cache" / "scrape-data" / "canonical",
]


def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not path.exists():
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows


def find_canon_dir() -> Path:
    # Optional override
    override = (os.environ.get("SCRAPE_CANON_DIR") or "").strip()
    if override:
        p = Path(override).expanduser().resolve()
        if p.exists():
            return p

    for cand in CANON_DIR_CANDIDATES:
        if (cand / "all.jsonl").exists():
            return cand
    # As a last resort, accept any existing canonical dir
    for cand in CANON_DIR_CANDIDATES:
        if cand.exists():
            return cand
    raise SystemExit(
        "Canonical export not found. Expected one of:\n"
        + "\n".join(str(c) for c in CANON_DIR_CANDIDATES)
        + "\nCI should run the scraper before build_bot_data.py."
    )


def write_json(path: Path, data: Any) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def lower(x: Any) -> str:
    return str(x or "").strip().lower()


def pick(d: dict[str, Any], *keys: str) -> Any:
    for k in keys:
        v = d.get(k)
        if v is not None and v != "" and v != [] and v != {}:
            return v
    return None


def first_source(row: dict[str, Any]) -> dict[str, Any]:
    sources = row.get("sources") or []
    return sources[0] if isinstance(sources, list) and sources else {}


def slug_from_url(url: Any) -> str | None:
    s = str(url or "").strip()
    if not s:
        return None
    try:
        p = urlparse(s)
        path = p.path.strip("/")
        if not path:
            return None
        return path.split("/")[-1]
    except Exception:
        return None


def entity_type(row: dict[str, Any]) -> str:
    return (
        str(row.get("entity_type") or row.get("type") or row.get("kind") or row.get("entityType") or "")
        .strip()
    )


def attrs_of(row: dict[str, Any]) -> dict[str, Any]:
    a = row.get("attributes")
    if isinstance(a, dict):
        return a
    a = row.get("attrs")
    if isinstance(a, dict):
        return a
    a = row.get("data")
    if isinstance(a, dict):
        return a
    return {}


def stable_name_id(row: dict[str, Any]) -> tuple[str, str]:
    attrs = attrs_of(row)
    src0 = first_source(row)

    name = (
        pick(attrs, "name", "title", "display_name", "displayName")
        or row.get("canonical_name")
        or row.get("name")
        or src0.get("name")
        or "Unknown"
    )
    name = str(name).strip() or "Unknown"

    _id = (
        row.get("canonical_id")
        or row.get("id")
        or pick(attrs, "id", "slug", "key")
        or slug_from_url(src0.get("source_url"))
        or re.sub(r"[^a-z0-9]+", "-", lower(name)).strip("-")
    )
    _id = str(_id).strip() or re.sub(r"[^a-z0-9]+", "-", lower(name)).strip("-") or "unknown"
    return name, _id


def build_simple(all_records: list[dict[str, Any]], typ: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in all_records:
        if entity_type(row) != typ:
            continue
        attrs = attrs_of(row)
        name, _id = stable_name_id(row)
        src0 = first_source(row)
        payload: dict[str, Any] = {
            "id": _id,
            "name": name,
            "description": pick(attrs, "description", "summary", "text", "content") or row.get("description"),
            "image": pick(attrs, "image", "image_url", "imageUrl", "portrait", "icon", "thumbnail", "cover"),
            "sources": row.get("sources", []),
        }
        # Keep everything we have for forward-compat (stats, type, rarity, etc.)
        if isinstance(attrs, dict):
            for k, v in attrs.items():
                if k not in payload:
                    payload[k] = v
        # Extra: store a usable "url" (non-mandatory)
        payload["url"] = pick(attrs, "url", "source_url") or src0.get("source_url")
        out.append(payload)
    return out


def extract_character_slug_from_sources(row: dict[str, Any]) -> str | None:
    for src in row.get("sources") or []:
        u = str(src.get("source_url") or "")
        m = re.search(r"/characters/([^/?#]+)", u)
        if m:
            return m.group(1)
    return None


def build_characters(all_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Index profiles and costumes by character slug/id
    profiles_by_char: dict[str, list[dict[str, Any]]] = {}
    costumes_by_char: dict[str, list[dict[str, Any]]] = {}

    for row in all_records:
        t = entity_type(row)
        if t == "character_weapon_profile":
            attrs = attrs_of(row)
            src0 = first_source(row)
            char_key = (
                row.get("character_id")
                or row.get("parent_id")
                or pick(attrs, "character_id", "characterId", "character", "character_slug", "characterSlug")
                or extract_character_slug_from_sources(row)
            )
            if not char_key:
                # Try parse from url like .../characters/<slug>...
                u = str(src0.get("source_url") or "")
                m = re.search(r"/characters/([^/?#]+)", u)
                char_key = m.group(1) if m else None
            if not char_key:
                continue
            name, _id = stable_name_id(row)
            payload = {
                "id": row.get("canonical_id") or row.get("id") or _id,
                "weapon_type": pick(attrs, "weapon_type", "weaponType", "weapon") or None,
                "weapon_type_icon": pick(attrs, "weapon_type_icon", "weaponTypeIcon", "weapon_icon", "weaponIcon"),
                "skills": attrs.get("skills") if isinstance(attrs.get("skills"), list) else [],
                "potentials": attrs.get("potentials") if isinstance(attrs.get("potentials"), list) else [],
                "sources": row.get("sources", []),
            }
            profiles_by_char.setdefault(str(char_key), []).append(payload)

        elif t == "costume":
            attrs = attrs_of(row)
            src0 = first_source(row)
            char_key = (
                row.get("character_id")
                or row.get("parent_id")
                or pick(attrs, "character_id", "characterId", "character", "character_slug", "characterSlug")
                or extract_character_slug_from_sources(row)
            )
            if not char_key:
                u = str(src0.get("source_url") or "")
                m = re.search(r"/characters/([^/?#]+)", u)
                char_key = m.group(1) if m else None
            if not char_key:
                continue
            name, _id = stable_name_id(row)
            payload = {
                "id": row.get("canonical_id") or row.get("id") or _id,
                "name": name,
                "image": pick(attrs, "image", "image_url", "imageUrl", "thumbnail", "icon"),
                "description": pick(attrs, "description", "summary"),
                "sources": row.get("sources", []),
            }
            costumes_by_char.setdefault(str(char_key), []).append(payload)

    # Build characters
    out: list[dict[str, Any]] = []
    for row in all_records:
        if entity_type(row) != "character":
            continue
        attrs = attrs_of(row)
        name, _id = stable_name_id(row)
        src0 = first_source(row)

        slug = (
            pick(attrs, "slug", "key")
            or extract_character_slug_from_sources(row)
            or slug_from_url(src0.get("source_url"))
            or _id
        )
        slug = str(slug)

        payload: dict[str, Any] = {
            "id": _id,
            "name": name,
            "description": pick(attrs, "description", "summary", "text"),
            "image": pick(attrs, "image", "image_url", "imageUrl", "portrait", "thumbnail"),
            "element": pick(attrs, "element", "element_type", "elementType"),
            "element_icon": pick(attrs, "element_icon", "elementIcon"),
            "weapon_types": attrs.get("weapon_types") if isinstance(attrs.get("weapon_types"), list) else [],
            "base_stats": attrs.get("base_stats") if isinstance(attrs.get("base_stats"), dict) else {},
            "aliases": attrs.get("aliases") if isinstance(attrs.get("aliases"), list) else [],
            "sources": row.get("sources", []),
            "weapon_profiles": profiles_by_char.get(slug, []) or profiles_by_char.get(_id, []),
            "costumes": costumes_by_char.get(slug, []) or costumes_by_char.get(_id, []),
        }

        # forward-compat
        if isinstance(attrs, dict):
            for k, v in attrs.items():
                if k not in payload:
                    payload[k] = v

        payload["url"] = pick(attrs, "url", "source_url") or src0.get("source_url")
        out.append(payload)

    return out


def group_resources(resources: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    buckets = {"familiers": [], "peche": [], "objets": [], "nourriture": []}
    for item in resources:
        # Try to normalize to those buckets
        kind = lower(item.get("subtype") or item.get("category") or item.get("name"))
        if "companion" in kind or "pet" in kind or "familier" in kind:
            buckets["familiers"].append(item)
        elif "fish" in kind or "fishing" in kind or "peche" in kind:
            buckets["peche"].append(item)
        elif "food" in kind or "nourrit" in kind:
            buckets["nourriture"].append(item)
        elif "item" in kind or "objet" in kind:
            buckets["objets"].append(item)
    return buckets


def main() -> None:
    ensure_dir(OUT_DIR)

    canon_dir = find_canon_dir()
    all_path = canon_dir / "all.jsonl"
    all_records = read_jsonl(all_path)

    if not all_records:
        raise SystemExit(f"Canonical input is empty: {all_path} (did the scraper run?)")

    # Build datasets
    resources = build_simple(all_records, "resource_collection")
    resource_buckets = group_resources(resources)

    characters = build_characters(all_records)
    weapons = build_simple(all_records, "weapon")
    banners = build_simple(all_records, "banner")
    bosses = build_simple(all_records, "boss")
    guides = build_simple(all_records, "guide")
    team_comps = build_simple(all_records, "team_comp")

    # Write outputs
    write_json(OUT_DIR / "characters.json", characters)
    write_json(OUT_DIR / "weapons.json", weapons)
    write_json(OUT_DIR / "banners.json", banners)
    write_json(OUT_DIR / "bosses.json", bosses)
    write_json(OUT_DIR / "guides.json", guides)
    write_json(OUT_DIR / "team_comps.json", team_comps)
    write_json(OUT_DIR / "resources.json", resources)
    write_json(OUT_DIR / "familiers.json", resource_buckets["familiers"])
    write_json(OUT_DIR / "peche.json", resource_buckets["peche"])
    write_json(OUT_DIR / "objets.json", resource_buckets["objets"])
    write_json(OUT_DIR / "nourriture.json", resource_buckets["nourriture"])

    coverage_src = canon_dir / "coverage_report.json"
    if coverage_src.exists():
        try:
            write_json(OUT_DIR / "coverage_report.json", json.loads(coverage_src.read_text(encoding="utf-8")))
        except Exception:
            # Don't fail build for coverage parse, but write a minimal marker
            write_json(OUT_DIR / "coverage_report.json", {"error": "failed to parse coverage_report.json"})

    # Minimal console summary (useful in Actions logs)
    print(f"[build_bot_data] canon_dir={canon_dir}")
    print(f"[build_bot_data] characters={len(characters)} weapons={len(weapons)} guides={len(guides)} team_comps={len(team_comps)} resources={len(resources)}")


if __name__ == "__main__":
    import os
    main()
