from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stamp-file", default=".bot-state/last_refresh.txt")
    parser.add_argument("--hours", type=int, default=72)
    args = parser.parse_args()

    stamp_path = Path(args.stamp_file)
    now = datetime.now(timezone.utc)
    should_run = True

    if stamp_path.exists():
        raw = stamp_path.read_text(encoding="utf-8").strip()
        if raw:
            last = datetime.fromisoformat(raw)
            should_run = now - last >= timedelta(hours=args.hours)

    github_env = Path(__import__("os").environ.get("GITHUB_ENV", ""))
    if github_env:
        with github_env.open("a", encoding="utf-8") as fh:
            fh.write(f"RUN_SCRAPE={'true' if should_run else 'false'}\n")
            fh.write(f"NOW_ISO={now.isoformat()}\n")

    print("true" if should_run else "false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
