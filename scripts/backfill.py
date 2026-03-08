#!/usr/bin/env python3
"""
Rose Glass News — Parallel Backfill
Fills the DB across N days × M topics with bounded concurrency.

Usage:
    python3 scripts/backfill.py                          # 30 days, all standing topics
    python3 scripts/backfill.py --days 7                 # last 7 days
    python3 scripts/backfill.py --topics IRAN CHINA      # specific topics only
    python3 scripts/backfill.py --days 14 --workers 3    # 14 days, 3 parallel workers
    python3 scripts/backfill.py --dry-run                # show what would run, no fetch
"""

import argparse
import sys
import os
import psycopg2
import concurrent.futures
import threading
from datetime import date, timedelta, datetime
from queue import Queue

IPAI_DIR = os.path.expanduser("~/IPAI")
sys.path.insert(0, IPAI_DIR)

from run_analysis import run_analysis

DB_URL = "postgresql://localhost/rose_glass_news"
MIN_COHERENCE = 0.3
MIN_SOURCES = 2
DEFAULT_WORKERS = 4
DEFAULT_DAYS = 30

STANDING_TOPICS = [
    "IRAN", "UKRAINE", "CLIMATE", "ELECTION", "ECONOMY",
    "CHINA", "ISRAEL", "FEDERAL RESERVE", "AI", "NATO",
    "NIGERIA", "BRAZIL", "AUSTRALIA", "INDIA", "MEXICO",
]

# Thread-safe print
_print_lock = threading.Lock()
def tprint(*args, **kwargs):
    with _print_lock:
        print(*args, **kwargs, flush=True)

# Thread-local DB connections
_thread_local = threading.local()
def get_conn():
    if not hasattr(_thread_local, "conn") or _thread_local.conn.closed:
        _thread_local.conn = psycopg2.connect(DB_URL)
    return _thread_local.conn

def is_cached(topic: str, date_str: str) -> bool:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT id FROM analyses WHERE UPPER(topic) = UPPER(%s) AND date = %s LIMIT 1",
        (topic, date_str)
    )
    return cur.fetchone() is not None

def save_to_db(topic: str, date_str: str, result: dict) -> str | None:
    conn = get_conn()
    if not result.get("sources") or len(result["sources"]) < MIN_SOURCES:
        return None

    avg_coherence = sum(s["coherence"] for s in result["sources"]) / len(result["sources"])
    if avg_coherence < MIN_COHERENCE:
        tprint(f"  [skip] {topic} {date_str} coherence={avg_coherence:.3f}")
        return None

    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO analyses (topic, date) VALUES (%s, %s) ON CONFLICT DO NOTHING RETURNING id",
            (topic.upper(), date_str)
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            return None
        analysis_id = row[0]

        for s in result["sources"]:
            veritas_score = None
            veritas_flags = None
            if s.get("veritas"):
                veritas_score = s["veritas"].get("authenticity_score")
                flags = s["veritas"].get("flags", [])
                veritas_flags = ", ".join(flags) if flags else None

            dims = s.get("dimensions", {})
            cur.execute("""
                INSERT INTO sources
                  (analysis_id, source_name, source_type, calibration, url, article_text,
                   psi, rho, q, f, tau, lambda_val, coherence, veritas_score, veritas_assessment)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                analysis_id,
                s.get("source_name"), s.get("source_type"), s.get("calibration"),
                s.get("url"), s.get("article_text"),
                dims.get("psi"), dims.get("rho"), dims.get("q"),
                dims.get("f"), dims.get("tau"), dims.get("lambda"),
                s.get("coherence"), veritas_score, veritas_flags,
            ))

        for dim, info in result.get("divergence", {}).items():
            cur.execute(
                "INSERT INTO divergence (analysis_id, dimension, mean_val, std_dev, variance) VALUES (%s,%s,%s,%s,%s)",
                (analysis_id, dim, info["mean"], info["std_dev"], info["variance"])
            )

        conn.commit()
        return str(analysis_id)

    except Exception as e:
        conn.rollback()
        tprint(f"  [db error] {topic} {date_str}: {e}")
        return None

def process_job(job: tuple, stats: dict, stats_lock: threading.Lock) -> str:
    topic, date_str = job

    if is_cached(topic, date_str):
        with stats_lock:
            stats["cached"] += 1
        return f"[cached] {topic} {date_str}"

    try:
        result = run_analysis(topic, date_str, limit=5)
        if not result.get("sources"):
            with stats_lock:
                stats["empty"] += 1
            return f"[empty]  {topic} {date_str}"

        analysis_id = save_to_db(topic, date_str, result)
        if analysis_id:
            with stats_lock:
                stats["saved"] += 1
            return f"[saved]  {topic} {date_str} → {len(result['sources'])} sources"
        else:
            with stats_lock:
                stats["skipped"] += 1
            return f"[skip]   {topic} {date_str}"

    except Exception as e:
        with stats_lock:
            stats["errors"] += 1
        return f"[error]  {topic} {date_str}: {e}"

def main():
    parser = argparse.ArgumentParser(description="Rose Glass parallel backfill")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS, help="Number of days back to fill")
    parser.add_argument("--topics", nargs="*", help="Topics to fill (default: all standing)")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS, help="Parallel workers")
    parser.add_argument("--dry-run", action="store_true", help="Show jobs without running them")
    parser.add_argument("--start-date", help="Start from this date (YYYY-MM-DD) instead of today")
    args = parser.parse_args()

    topics = [t.upper() for t in args.topics] if args.topics else list(STANDING_TOPICS)
    end_date = date.fromisoformat(args.start_date) if args.start_date else date.today()
    dates = [str(end_date - timedelta(days=i)) for i in range(args.days)]

    # Build job list — newest first so the UI gets populated fast
    jobs = [(topic, d) for d in dates for topic in topics]
    total = len(jobs)

    print(f"\nRose Glass Backfill")
    print(f"Topics:  {len(topics)} × {args.days} days = {total} jobs")
    print(f"Workers: {args.workers}")
    print(f"Range:   {dates[-1]} → {dates[0]}")
    print("-" * 60)

    if args.dry_run:
        for topic, d in jobs[:20]:
            print(f"  would run: {topic} {d}")
        if total > 20:
            print(f"  ... and {total - 20} more")
        return

    stats = {"saved": 0, "cached": 0, "empty": 0, "skipped": 0, "errors": 0}
    stats_lock = threading.Lock()
    completed = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(process_job, job, stats, stats_lock): job for job in jobs}

        for future in concurrent.futures.as_completed(futures):
            result_msg = future.result()
            completed += 1
            pct = int(completed / total * 100)
            tprint(f"  [{completed:4d}/{total} {pct:3d}%] {result_msg}")

    print("-" * 60)
    print(f"Done at {datetime.now().strftime('%H:%M:%S')}")
    print(f"  saved:   {stats['saved']}")
    print(f"  cached:  {stats['cached']}")
    print(f"  empty:   {stats['empty']}")
    print(f"  skipped: {stats['skipped']}")
    print(f"  errors:  {stats['errors']}")

if __name__ == "__main__":
    main()
