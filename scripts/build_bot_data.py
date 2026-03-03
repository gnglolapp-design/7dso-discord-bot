import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Le workflow écrit dans --out scrape-data
SCRAPE_OUT = ROOT / "scrape-data"
OUT = ROOT / "data"
OUT.mkdir(exist_ok=True)

def read_json(p: Path):
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding="utf-8"))

def find_input(filename: str) -> Path | None:
    # Cherche n'importe où dans scrape-data (canonical / merged / export etc.)
    hits = list(SCRAPE_OUT.rglob(filename))
    if hits:
        return hits[0]
    # fallback: cherche "contains"
    hits = list(SCRAPE_OUT.rglob(f"*{filename}*"))
    return hits[0] if hits else None

def fallback_name(e: dict) -> str | None:
    # Plusieurs formats: e.name, e.data.name, e.sources[0].name
    if isinstance(e.get("name"), str) and e["name"].strip():
        return e["name"].strip()
    data = e.get("data") or e.get("attributes") or {}
    if isinstance(data.get("name"), str) and data["name"].strip():
        return data["name"].strip()
    sources = e.get("sources") or []
    for s in sources:
        n = s.get("name")
        if isinstance(n, str) and n.strip():
            return n.strip()
    return None

def normalize_entity(e: dict) -> dict:
    data = e.get("data") or e.get("attributes") or {}
    out = {}
    # garde tout ce qui est déjà structuré
    if isinstance(data, dict):
        out.update(data)
    # champs top-level
    out["id"] = e.get("id") or out.get("id")
    out["name"] = fallback_name(e) or out.get("name")
    # fallback image/description
    if not out.get("description"):
        out["description"] = e.get("description") or out.get("description")
    if not out.get("image"):
        out["image"] = e.get("image") or out.get("image")
    # sources toujours conservées
    out["sources"] = e.get("sources") or out.get("sources") or []
    return out

def build(in_name: str, out_name: str):
    inp = find_input(in_name)
    if not inp:
        print(f"[WARN] input introuvable: {in_name}")
        (OUT / out_name).write_text("[]", encoding="utf-8")
        return
    raw = read_json(inp)
    cleaned = [normalize_entity(e) for e in raw]
    (OUT / out_name).write_text(json.dumps(cleaned, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Built {out_name}: {len(cleaned)} (from {inp})")

# Noms attendus côté bot / GitHub pages
build("characters.json", "characters.json")
build("weapons.json", "weapons.json")
build("banners.json", "banners.json")
build("bosses.json", "bosses.json")
build("guides.json", "guides.json")
build("team_comps.json", "team_comps.json")
build("resources.json", "resources.json")
