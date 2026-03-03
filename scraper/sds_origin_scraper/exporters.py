from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Iterable

from sds_origin_scraper.models import CanonicalRecord, EntityRecord, PageRecord


def export_sqlite(
    path: str | Path,
    pages: Iterable[PageRecord],
    entities: Iterable[EntityRecord],
    canonical_records: Iterable[CanonicalRecord] | None = None,
    coverage_report: dict | None = None,
) -> None:
    db_path = Path(path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS pages (
            site TEXT NOT NULL,
            url TEXT PRIMARY KEY,
            canonical_url TEXT,
            page_type TEXT,
            title TEXT,
            h1 TEXT,
            summary TEXT,
            text TEXT,
            metadata_json TEXT,
            fetched_at TEXT,
            status_code INTEGER,
            used_browser INTEGER
        );

        CREATE TABLE IF NOT EXISTS raw_entities (
            site TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            slug TEXT NOT NULL,
            name TEXT,
            source_url TEXT,
            attributes_json TEXT,
            aliases_json TEXT,
            tags_json TEXT,
            extracted_at TEXT,
            PRIMARY KEY (site, entity_type, slug, source_url)
        );

        CREATE TABLE IF NOT EXISTS canonical_entities (
            entity_type TEXT NOT NULL,
            entity_id TEXT PRIMARY KEY,
            slug TEXT,
            name TEXT,
            data_json TEXT,
            sources_json TEXT,
            aliases_json TEXT,
            tags_json TEXT,
            updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS reports (
            report_name TEXT PRIMARY KEY,
            payload_json TEXT
        );
        """
    )
    cur.executemany(
        """
        INSERT OR REPLACE INTO pages (
            site, url, canonical_url, page_type, title, h1, summary, text,
            metadata_json, fetched_at, status_code, used_browser
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                page.site,
                page.url,
                page.canonical_url,
                page.page_type,
                page.title,
                page.h1,
                page.summary,
                page.text,
                json.dumps(page.metadata, ensure_ascii=False),
                page.fetched_at,
                page.status_code,
                int(page.used_browser),
            )
            for page in pages
        ],
    )
    cur.executemany(
        """
        INSERT OR REPLACE INTO raw_entities (
            site, entity_type, slug, name, source_url, attributes_json,
            aliases_json, tags_json, extracted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                entity.site,
                entity.entity_type,
                entity.slug,
                entity.name,
                entity.source_url,
                json.dumps(entity.attributes, ensure_ascii=False),
                json.dumps(entity.aliases, ensure_ascii=False),
                json.dumps(entity.tags, ensure_ascii=False),
                entity.extracted_at,
            )
            for entity in entities
        ],
    )
    if canonical_records is not None:
        cur.executemany(
            """
            INSERT OR REPLACE INTO canonical_entities (
                entity_type, entity_id, slug, name, data_json, sources_json,
                aliases_json, tags_json, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    record.entity_type,
                    record.entity_id,
                    record.slug,
                    record.name,
                    json.dumps(record.data, ensure_ascii=False),
                    json.dumps(record.sources, ensure_ascii=False),
                    json.dumps(record.aliases, ensure_ascii=False),
                    json.dumps(record.tags, ensure_ascii=False),
                    record.updated_at,
                )
                for record in canonical_records
            ],
        )
    if coverage_report is not None:
        cur.execute(
            "INSERT OR REPLACE INTO reports (report_name, payload_json) VALUES (?, ?)",
            ("coverage_report", json.dumps(coverage_report, ensure_ascii=False)),
        )
    conn.commit()
    conn.close()
