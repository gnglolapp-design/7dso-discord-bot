from __future__ import annotations

import argparse
from pathlib import Path

from sds_origin_scraper.crawler import SiteCrawler
from sds_origin_scraper.exporters import export_sqlite
from sds_origin_scraper.merger import build_canonical_records, export_canonical_jsonl
from sds_origin_scraper.parsers import get_adapters
from sds_origin_scraper.report import build_coverage_report, export_report
from sds_origin_scraper.utils import write_jsonl


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Crawler 7DS Origin community sites")
    parser.add_argument(
        "--site",
        choices=["all", "7dsorigin", "hideout", "genshin"],
        default="all",
        help="Site à crawler",
    )
    parser.add_argument("--out", default="data", help="Dossier de sortie")
    parser.add_argument("--max-pages", type=int, default=600, help="Nombre max de pages par site")
    parser.add_argument(
        "--force-browser",
        action="store_true",
        help="Force Playwright sur toutes les pages du site sélectionné",
    )
    parser.add_argument(
        "--sqlite",
        action="store_true",
        help="Crée aussi une base SQLite fusionnée pour ingestion côté bot",
    )
    parser.add_argument(
        "--no-sitemaps",
        action="store_true",
        help="Désactive la découverte via robots.txt et sitemap.xml",
    )
    parser.add_argument(
        "--raw-only",
        action="store_true",
        help="N'exporte pas la couche canonique ni le merge cross-source",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    all_pages = []
    all_entities = []

    for adapter in get_adapters(args.site):
        crawler = SiteCrawler(
            adapter=adapter,
            out_dir=out_dir,
            max_pages=args.max_pages,
            force_browser=args.force_browser,
            discover_sitemaps=not args.no_sitemaps,
        )
        result = crawler.crawl()
        all_pages.extend(result.pages)
        all_entities.extend(result.entities)
        print(f"[{adapter.name}] pages={len(result.pages)} entities={len(result.entities)}")

    write_jsonl(out_dir / "all_raw_entities.jsonl", [entity.to_dict() for entity in all_entities], mode="w")
    write_jsonl(out_dir / "all_pages.jsonl", [page.to_dict() for page in all_pages], mode="w")

    canonical_records = []
    coverage_report = {}
    if not args.raw_only:
        canonical_records = build_canonical_records(all_entities)
        export_canonical_jsonl(out_dir, canonical_records)
        coverage_report = build_coverage_report(all_pages, all_entities, canonical_records)
        export_report(out_dir, coverage_report)
        print(f"[canonical] records={len(canonical_records)}")

    if args.sqlite:
        export_sqlite(
            out_dir / "7dso_scrape.sqlite",
            all_pages,
            all_entities,
            canonical_records=canonical_records,
            coverage_report=coverage_report,
        )
        print(f"SQLite écrite dans {out_dir / '7dso_scrape.sqlite'}")


if __name__ == "__main__":
    main()
