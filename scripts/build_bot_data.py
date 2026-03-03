#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sqlite3
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SCRAPE_DIR = ROOT / "scrape-data"
CANONICAL_DIR = SCRAPE_DIR / "canonical"
DB_PATH = SCRAPE_DIR / "7dso_scrape.sqlite"
OUT_DIR = ROOT / "docs" / "data"
CHAR_INDEX_DIR = OUT_DIR / "characters"
WEAPON_INDEX_DIR = OUT_DIR / "weapons"

JSONLike = dict[str, Any]

OUTPUT_MAP: dict[str, str] = {
    "character": "characters",
    "weapon": "weapons",
    "guide": "guides",
    "boss": "bosses",
    "team_comp": "team_comps",
    "resource": "resources",
    "banner": "banners",
    "familiar": "familiers",
    "food": "nourriture",
    "item": "objets",
    "fishing": "peche",
}


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, data: Any) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


def as_dict(value: Any) -> JSONLike:
    return value if isinstance(value, dict) else {}


def as_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def load_jsonish(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8", errors="replace")
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return value
    return value


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def unique_by(items: list[JSONLike], key_fn) -> list[JSONLike]:
    out: list[JSONLike] = []
    seen: set[str] = set()
    for item in items:
        key = key_fn(item)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def flatten_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        return "\n".join(filter(None, (flatten_text(x) for x in value))).strip()
    if isinstance(value, dict):
        parts: list[str] = []
        for key in ["text", "description", "summary", "content", "body", "value"]:
            part = flatten_text(value.get(key))
            if part:
                parts.append(part)
        return "\n".join(parts).strip()
    return str(value).strip()


def first_url(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip().startswith(("http://", "https://")):
            return value.strip()
        if isinstance(value, dict):
            for key in ["url", "src", "image", "icon", "thumbnail", "full"]:
                got = first_url(value.get(key))
                if got:
                    return got
        if isinstance(value, list):
            for item in value:
                got = first_url(item)
                if got:
                    return got
    return None


def summarize_text(text: str, limit: int = 260) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    if len(text) <= limit:
        return text
    trimmed = text[: limit - 1].rsplit(" ", 1)[0].strip()
    return f"{trimmed}…" if trimmed else text[:limit]


def lines_of(text: str) -> list[str]:
    return [line.strip() for line in re.split(r"\r?\n", text or "") if line.strip()]


def sections_from_text(title: str, text: str) -> list[JSONLike]:
    lines = lines_of(text)
    if not lines:
        return []

    sections: list[JSONLike] = []
    current_title = "Overview"
    current_lines: list[str] = []

    def flush() -> None:
        nonlocal current_title, current_lines
        body = "\n".join(current_lines).strip()
        if body:
            sections.append({"title": current_title, "text": body})
        current_lines = []

    for line in lines:
        normalized = re.sub(r"\s+", " ", line)
        looks_like_heading = False
        if normalized.endswith(":") and len(normalized) <= 80:
            looks_like_heading = True
        elif 0 < len(normalized) <= 60 and normalized == normalized.title() and not normalized.endswith("."):
            looks_like_heading = True
        elif normalized.lower().startswith(("tier ", "phase ", "when ", "how to ", "core ", "fight ", "strategy", "summoning", "stats", "potentials", "costumes")):
            looks_like_heading = True

        if looks_like_heading and normalized.lower() != title.lower():
            flush()
            current_title = normalized.rstrip(":")
            continue
        current_lines.append(normalized)

    flush()
    return sections[:12]


def normalize_section(section: Any) -> JSONLike | None:
    obj = as_dict(load_jsonish(section))
    if not obj:
        return None

    items = [as_dict(x) for x in as_list(obj.get("items")) if isinstance(x, dict)]
    title = as_str(obj.get("title") or obj.get("name") or obj.get("heading"))
    text = flatten_text(obj.get("text") or obj.get("description") or obj.get("summary") or obj.get("content"))
    image = first_url(obj.get("image"), obj.get("icon"), obj.get("thumbnail"))

    normalized: JSONLike = {}
    if title:
        normalized["title"] = title
    if text:
        normalized["text"] = text
    if image:
        normalized["image"] = image
    if items:
        norm_items: list[JSONLike] = []
        for item in items:
            norm_item: JSONLike = {}
            for src_key, dst_key in [
                ("title", "title"),
                ("name", "name"),
                ("badge", "badge"),
                ("type", "type"),
                ("tier", "tier"),
                ("rarity", "rarity"),
            ]:
                value = as_str(item.get(src_key))
                if value:
                    norm_item[dst_key] = value
            desc = flatten_text(item.get("description") or item.get("text") or item.get("summary"))
            if desc:
                norm_item["description"] = desc
            icon = first_url(item.get("icon"), item.get("image"), item.get("thumbnail"))
            if icon:
                norm_item["icon"] = icon
            if norm_item:
                norm_items.append(norm_item)
        if norm_items:
            normalized["items"] = norm_items

    return normalized or None


def normalize_image(image: Any) -> JSONLike | None:
    obj = as_dict(load_jsonish(image))
    if not obj:
        return None
    url = first_url(obj.get("url"), obj.get("src"), obj.get("image"))
    if not url:
        return None
    out: JSONLike = {"url": url}
    for src_key, dst_key in [("label", "label"), ("alt", "alt"), ("caption", "caption"), ("title", "title")]:
        value = as_str(obj.get(src_key))
        if value:
            out[dst_key] = value
    return out


def page_payload(page: JSONLike | None) -> JSONLike:
    if not page:
        return {}

    sections = [x for x in (normalize_section(s) for s in as_list(page.get("sections"))) if x]
    images = [x for x in (normalize_image(i) for i in as_list(page.get("images"))) if x]
    page_text = flatten_text(page.get("page_text") or page.get("raw_text") or page.get("text"))

    if not sections and page_text:
        sections = sections_from_text(as_str(page.get("title")), page_text)

    summary = as_str(page.get("page_summary") or page.get("summary") or page.get("excerpt"))
    if not summary and page_text:
        summary = summarize_text(page_text)

    image = first_url(page.get("image"), page.get("thumbnail"), images)

    out: JSONLike = {
        "page_title": as_str(page.get("title")),
        "page_summary": summary,
        "page_text": page_text,
        "sections": sections,
        "images": images,
        "page_type": as_str(page.get("page_type") or page.get("kind") or page.get("type")),
        "site": as_str(page.get("site") or page.get("source_site")),
        "url": as_str(page.get("url")),
    }
    if image:
        out["image"] = image
    return {k: v for k, v in out.items() if v not in (None, "", [], {})}


def classify_page(page: JSONLike) -> str | None:
    page_type = as_str(page.get("page_type") or page.get("kind") or page.get("type")).lower()
    url = as_str(page.get("url")).lower()
    title = as_str(page.get("title")).lower()

    if page_type in {"boss", "boss_guide"}:
        if "general" in title and "boss" in title:
            return "guide"
        return "boss"
    if page_type == "guide":
        return "guide"

    if "/boss-guide" in url:
        if "general" in title:
            return "guide"
        return "boss"
    if "/guide" in url:
        return "guide"
    return None


def read_jsonl(path: Path) -> list[JSONLike]:
    rows: list[JSONLike] = []
    if not path.exists():
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw:
            continue
        try:
            row = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows


def load_canonical_entities() -> list[JSONLike]:
    rows: list[JSONLike] = []
    if CANONICAL_DIR.exists():
        for path in sorted(CANONICAL_DIR.glob("*.jsonl")):
            rows.extend(read_jsonl(path))
    if rows:
        return rows

    if DB_PATH.exists():
        try:
            con = sqlite3.connect(DB_PATH)
            con.row_factory = sqlite3.Row
            cur = con.cursor()
            cur.execute("SELECT * FROM canonical_entities")
            db_rows = [dict(r) for r in cur.fetchall()]
            con.close()
            rows = []
            for row in db_rows:
                rows.append(
                    {
                        "entity_type": row.get("entity_type"),
                        "entity_id": row.get("entity_id"),
                        "slug": row.get("slug"),
                        "name": row.get("name"),
                        "data": load_jsonish(row.get("data_json")) or {},
                        "sources": load_jsonish(row.get("sources_json")) or [],
                        "aliases": load_jsonish(row.get("aliases_json")) or [],
                        "tags": load_jsonish(row.get("tags_json")) or [],
                    }
                )
        except Exception:
            rows = []
    return rows


def load_pages() -> list[JSONLike]:
    if not DB_PATH.exists():
        return []
    try:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        cur = con.cursor()
        cur.execute("SELECT * FROM pages")
        raw_rows = [dict(r) for r in cur.fetchall()]
        con.close()
    except Exception:
        return []

    rows: list[JSONLike] = []
    for row in raw_rows:
        rows.append(
            {
                "site": row.get("site"),
                "page_type": row.get("page_type"),
                "slug": row.get("slug"),
                "title": row.get("title"),
                "url": row.get("url"),
                "summary": row.get("summary"),
                "sections": load_jsonish(row.get("sections_json")) or [],
                "images": load_jsonish(row.get("images_json")) or [],
                "metadata": load_jsonish(row.get("metadata_json")) or {},
                "page_text": row.get("raw_text") or "",
            }
        )
    return rows


def load_coverage_report() -> JSONLike:
    path = OUT_DIR / "coverage_report.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass

    if DB_PATH.exists():
        try:
            con = sqlite3.connect(DB_PATH)
            con.row_factory = sqlite3.Row
            cur = con.cursor()
            cur.execute("SELECT report_json FROM reports ORDER BY rowid DESC LIMIT 1")
            row = cur.fetchone()
            con.close()
            if row and row[0]:
                loaded = load_jsonish(row[0])
                if isinstance(loaded, dict):
                    return loaded
        except Exception:
            pass
    return {}


def normalize_source(source: Any) -> JSONLike:
    obj = as_dict(source)
    if not obj:
        return {}
    out: JSONLike = {}
    for src_key, dst_key in [
        ("site", "site"),
        ("source_url", "source_url"),
        ("entity_type", "entity_type"),
        ("name", "name"),
    ]:
        value = as_str(obj.get(src_key))
        if value:
            out[dst_key] = value
    return out


def normalize_record(record: JSONLike) -> JSONLike:
    return {
        "entity_type": as_str(record.get("entity_type")),
        "entity_id": as_str(record.get("entity_id")),
        "slug": as_str(record.get("slug")),
        "name": as_str(record.get("name")),
        "data": as_dict(record.get("data")),
        "sources": [normalize_source(s) for s in as_list(record.get("sources")) if isinstance(s, dict)],
        "aliases": [as_str(x) for x in as_list(record.get("aliases")) if as_str(x)],
        "tags": [as_str(x) for x in as_list(record.get("tags")) if as_str(x)],
    }


def build_page_maps(pages: list[JSONLike]) -> tuple[dict[str, JSONLike], dict[str, list[JSONLike]]]:
    by_slug: dict[str, JSONLike] = {}
    by_kind: dict[str, list[JSONLike]] = defaultdict(list)

    for raw_page in pages:
        page = page_payload(raw_page)
        slug = as_str(raw_page.get("slug")) or slugify(as_str(raw_page.get("title")))
        if slug:
            by_slug.setdefault(slug, page)
        kind = classify_page(raw_page)
        if kind:
            by_kind[kind].append(page)

    return by_slug, by_kind


def normalize_weapon_profile(record: JSONLike) -> JSONLike:
    data = as_dict(record.get("data"))
    out: JSONLike = {
        "id": as_str(record.get("slug")) or as_str(record.get("entity_id")),
        "name": as_str(record.get("name")) or as_str(data.get("weapon_type")),
        "weapon_type": as_str(data.get("weapon_type")),
        "element": as_str(data.get("element")),
        "element_icon": first_url(data.get("element_icon")) or as_str(data.get("element_icon")),
        "description": flatten_text(data.get("description")),
        "skills": [as_dict(x) for x in as_list(data.get("skills")) if isinstance(x, dict)],
        "potentials": [as_dict(x) for x in as_list(data.get("potentials")) if isinstance(x, dict)],
        "images": [x for x in (normalize_image(i) for i in as_list(data.get("images"))) if x],
        "sections": [x for x in (normalize_section(s) for s in as_list(data.get("sections"))) if x],
        "sources": [normalize_source(s) for s in as_list(record.get("sources")) if isinstance(s, dict)],
        "aliases": [as_str(x) for x in as_list(record.get("aliases")) if as_str(x)],
        "tags": [as_str(x) for x in as_list(record.get("tags")) if as_str(x)],
    }
    image = first_url(data.get("image"), data.get("icon"), data.get("thumbnail"), out.get("images"))
    if image:
        out["image"] = image
    return {k: v for k, v in out.items() if v not in (None, "", [], {})}


def normalize_costume(record: JSONLike) -> JSONLike:
    data = as_dict(record.get("data"))
    out: JSONLike = {
        "id": as_str(record.get("slug")) or as_str(record.get("entity_id")),
        "name": as_str(record.get("name")),
        "character_slug": as_str(data.get("character_slug")),
        "character_name": as_str(data.get("character_name")),
        "description": flatten_text(data.get("description")),
        "image": first_url(data.get("image"), data.get("icon"), data.get("thumbnail")),
        "images": [x for x in (normalize_image(i) for i in as_list(data.get("images"))) if x],
        "sections": [x for x in (normalize_section(s) for s in as_list(data.get("sections"))) if x],
        "sources": [normalize_source(s) for s in as_list(record.get("sources")) if isinstance(s, dict)],
    }
    return {k: v for k, v in out.items() if v not in (None, "", [], {})}


def build_characters(records: list[JSONLike], pages_by_slug: dict[str, JSONLike]) -> list[JSONLike]:
    chars = [r for r in records if r["entity_type"] == "character"]
    profile_by_char: dict[str, list[JSONLike]] = defaultdict(list)
    costume_by_char: dict[str, list[JSONLike]] = defaultdict(list)

    for rec in records:
        et = rec["entity_type"]
        data = as_dict(rec.get("data"))
        if et == "character_weapon_profile":
            char_slug = as_str(data.get("character_slug"))
            if char_slug:
                profile_by_char[char_slug].append(normalize_weapon_profile(rec))
        elif et == "costume":
            char_slug = as_str(data.get("character_slug"))
            if char_slug:
                costume_by_char[char_slug].append(normalize_costume(rec))

    out: list[JSONLike] = []
    for rec in chars:
        data = as_dict(rec.get("data"))
        slug = as_str(rec.get("slug"))
        page = pages_by_slug.get(slug)
        profiles = profile_by_char.get(slug) or [normalize_weapon_profile({"data": x, "name": x.get("weapon_type"), "slug": slugify(as_str(x.get("weapon_type")))}) for x in as_list(data.get("weapon_profiles")) if isinstance(x, dict)]
        costumes = costume_by_char.get(slug) or [as_dict(x) for x in as_list(data.get("costumes")) if isinstance(x, dict)]
        images = [x for x in (normalize_image(i) for i in as_list(data.get("images"))) if x]
        sections = [x for x in (normalize_section(s) for s in as_list(data.get("sections"))) if x]

        entry: JSONLike = {
            "id": slug,
            "name": as_str(rec.get("name")),
            "description": flatten_text(data.get("description")),
            "image": first_url(data.get("image")),
            "element": as_str(data.get("element")),
            "element_icon": first_url(data.get("element_icon")) or as_str(data.get("element_icon")),
            "weapon_types": [as_str(x) for x in as_list(data.get("weapon_types")) if as_str(x)],
            "base_stats": data.get("base_stats") or {},
            "aliases": rec.get("aliases") or [],
            "sources": rec.get("sources") or [],
            "weapon_profiles": sorted(profiles, key=lambda x: as_str(x.get("weapon_type") or x.get("name"))),
            "costumes": costumes,
            "images": images,
            "sections": sections,
            "rarity": as_str(data.get("rarity")),
            "character_image": first_url(data.get("character_image"), data.get("portrait"), data.get("image"), images),
            "source_count": len(rec.get("sources") or []),
            "url": as_str((rec.get("sources") or [{}])[0].get("source_url")),
        }
        entry.update(page_payload(page))
        out.append({k: v for k, v in entry.items() if v not in (None, "", [], {})})
    return sorted(out, key=lambda x: x.get("name", ""))


def build_generic_entities(records: list[JSONLike], entity_type: str, pages_by_slug: dict[str, JSONLike]) -> list[JSONLike]:
    out: list[JSONLike] = []
    for rec in [r for r in records if r["entity_type"] == entity_type]:
        data = as_dict(rec.get("data"))
        slug = as_str(rec.get("slug"))
        page = pages_by_slug.get(slug)
        entry: JSONLike = {
            "id": slug,
            "name": as_str(rec.get("name")),
            "description": flatten_text(data.get("description")),
            "image": first_url(data.get("image"), data.get("icon"), data.get("thumbnail")),
            "sources": rec.get("sources") or [],
            "aliases": rec.get("aliases") or [],
            "url": as_str((rec.get("sources") or [{}])[0].get("source_url")),
        }
        for key in [
            "weapon_type",
            "rarity",
            "attack",
            "secondary_stat_name",
            "secondary_stat_value",
            "element",
            "element_icon",
            "stats",
            "effects",
            "roles",
            "tags",
        ]:
            value = data.get(key)
            if value not in (None, "", [], {}):
                entry[key] = value
        entry["images"] = [x for x in (normalize_image(i) for i in as_list(data.get("images"))) if x]
        entry["sections"] = [x for x in (normalize_section(s) for s in as_list(data.get("sections"))) if x]
        entry.update(page_payload(page))
        out.append({k: v for k, v in entry.items() if v not in (None, "", [], {})})
    return sorted(out, key=lambda x: x.get("name", ""))


def merge_page_entity(entity: JSONLike, page: JSONLike) -> JSONLike:
    merged = dict(entity)
    payload = page_payload(page)
    for key, value in payload.items():
        if key in {"sections", "images"}:
            existing = as_list(merged.get(key))
            merged[key] = existing or value
        elif not merged.get(key):
            merged[key] = value
    if not merged.get("image"):
        merged["image"] = payload.get("image")
    return merged


def build_bosses_and_guides(records: list[JSONLike], pages_by_kind: dict[str, list[JSONLike]]) -> tuple[list[JSONLike], list[JSONLike]]:
    bosses = build_generic_entities(records, "boss", {})
    guides = build_generic_entities(records, "guide", {})

    boss_by_slug = {as_str(x.get("id")): x for x in bosses}
    guide_by_slug = {as_str(x.get("id")): x for x in guides}

    for page in pages_by_kind.get("boss", []):
        slug = slugify(as_str(page.get("page_title")) or as_str(page.get("url")))
        base = boss_by_slug.get(slug)
        entity = {
            "id": slug,
            "name": as_str(page.get("page_title")) or slug.replace("-", " ").title(),
            "description": as_str(page.get("page_summary")),
            "image": first_url(page.get("image"), page.get("images")),
            "site": as_str(page.get("site")),
            "url": as_str(page.get("url")),
            "sections": as_list(page.get("sections")),
            "images": as_list(page.get("images")),
            "page_title": as_str(page.get("page_title")),
            "page_summary": as_str(page.get("page_summary")),
            "page_text": as_str(page.get("page_text")),
            "page_type": as_str(page.get("page_type")),
            "sources": [{"site": as_str(page.get("site")), "source_url": as_str(page.get("url")), "entity_type": "boss", "name": as_str(page.get("page_title"))}],
        }
        boss_by_slug[slug] = merge_page_entity(base or entity, page)

    for page in pages_by_kind.get("guide", []):
        slug = slugify(as_str(page.get("page_title")) or as_str(page.get("url")))
        base = guide_by_slug.get(slug)
        entity = {
            "id": slug,
            "name": as_str(page.get("page_title")) or slug.replace("-", " ").title(),
            "description": as_str(page.get("page_summary")),
            "image": first_url(page.get("image"), page.get("images")),
            "site": as_str(page.get("site")),
            "url": as_str(page.get("url")),
            "sections": as_list(page.get("sections")),
            "images": as_list(page.get("images")),
            "page_title": as_str(page.get("page_title")),
            "page_summary": as_str(page.get("page_summary")),
            "page_text": as_str(page.get("page_text")),
            "page_type": as_str(page.get("page_type")),
            "sources": [{"site": as_str(page.get("site")), "source_url": as_str(page.get("url")), "entity_type": "guide", "name": as_str(page.get("page_title"))}],
        }
        guide_by_slug[slug] = merge_page_entity(base or entity, page)

    return (
        sorted(boss_by_slug.values(), key=lambda x: x.get("name", "")),
        sorted(guide_by_slug.values(), key=lambda x: x.get("name", "")),
    )


def write_indexes(characters: list[JSONLike], weapons: list[JSONLike]) -> None:
    ensure_dir(CHAR_INDEX_DIR)
    ensure_dir(WEAPON_INDEX_DIR)
    write_json(CHAR_INDEX_DIR / "index.json", [{"id": x.get("id"), "name": x.get("name"), "image": x.get("character_image") or x.get("image"), "element": x.get("element"), "weapon_types": x.get("weapon_types", [])} for x in characters])
    write_json(WEAPON_INDEX_DIR / "index.json", [{"id": x.get("id"), "name": x.get("name"), "image": x.get("image"), "weapon_type": x.get("weapon_type"), "rarity": x.get("rarity")} for x in weapons])


def main() -> None:
    ensure_dir(OUT_DIR)
    records = [normalize_record(r) for r in load_canonical_entities()]
    pages = load_pages()
    coverage = load_coverage_report()

    pages_by_slug, pages_by_kind = build_page_maps(pages)

    characters = build_characters(records, pages_by_slug)
    weapons = build_generic_entities(records, "weapon", pages_by_slug)
    team_comps = build_generic_entities(records, "team_comp", pages_by_slug)
    resources = build_generic_entities(records, "resource", pages_by_slug)
    banners = build_generic_entities(records, "banner", pages_by_slug)
    familiers = build_generic_entities(records, "familiar", pages_by_slug)
    nourriture = build_generic_entities(records, "food", pages_by_slug)
    objets = build_generic_entities(records, "item", pages_by_slug)
    peche = build_generic_entities(records, "fishing", pages_by_slug)
    bosses, guides = build_bosses_and_guides(records, pages_by_kind)

    outputs = {
        "characters": characters,
        "weapons": weapons,
        "bosses": bosses,
        "guides": guides,
        "team_comps": team_comps,
        "resources": resources,
        "banners": banners,
        "familiers": familiers,
        "nourriture": nourriture,
        "objets": objets,
        "peche": peche,
    }

    for name, data in outputs.items():
        write_json(OUT_DIR / f"{name}.json", data)
    write_json(OUT_DIR / "coverage_report.json", coverage)
    write_indexes(characters, weapons)

    print(
        "[build_bot_data] "
        + " ".join(
            f"{name}={len(data)}" for name, data in [
                ("characters", characters),
                ("weapons", weapons),
                ("bosses", bosses),
                ("guides", guides),
                ("team_comps", team_comps),
                ("resources", resources),
            ]
        )
    )


if __name__ == "__main__":
    main()
