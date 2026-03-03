from __future__ import annotations

import json
import sqlite3
from pathlib import Path


def main() -> None:
    db_path = Path("data/7dso_scrape.sqlite")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    for row in cur.execute(
        "SELECT site, entity_type, name, attributes_json FROM entities ORDER BY site, entity_type, name LIMIT 20"
    ):
        site, entity_type, name, attrs_json = row
        attrs = json.loads(attrs_json or "{}")
        print(f"[{site}] {entity_type}: {name} -> {attrs.get('summary', '')[:80]}")
    conn.close()


if __name__ == "__main__":
    main()
