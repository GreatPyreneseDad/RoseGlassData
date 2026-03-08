#!/usr/bin/env python3
"""
Rose Glass News — Daily Ingest
Runs each morning to pre-populate the DB with high-signal topics.

Discernment criteria:
- Topics must exceed GDELT mention threshold (>= MIN_MENTIONS)
- Only runs if topic not already cached for today
- Skips low-coherence results (< MIN_COHERENCE) to avoid noise
- Writes to shared postgres so all users benefit instantly

Usage:
    python3 scripts/daily_ingest.py
    python3 scripts/daily_ingest.py --date 2026-03-06
    python3 scripts/daily_ingest.py --topics IRAN CLIMATE --date 2026-03-06
"""

import argparse
import sys
import os
import psycopg2
from datetime import date, datetime

IPAI_DIR = os.path.expanduser("~/IPAI")
sys.path.insert(0, IPAI_DIR)

from run_analysis import run_analysis

DB_URL = "postgresql://localhost/rose_glass_news"
MIN_COHERENCE = 0.3
MIN_SOURCES = 2

STANDING_TOPICS = [
    "IRAN", "UKRAINE", "CLIMATE", "ELECTION", "ECONOMY",
    "CHINA", "ISRAEL", "FEDERAL RESERVE", "AI", "NATO",
    "NIGERIA", "BRAZIL", "AUSTRALIA", "INDIA", "MEXICO",
]

def get_db():
    return psycopg2.connect(DB_URL)

def is_cached(conn, topic: str, date_str: str) -> bool:
    cur = conn.cursor()
    cur.execute(
        "SELECT id FROM analyses WHERE UPPER(topic) = UPPER(%s) AND date = %s LIMIT 1",
        (topic, date_str)
    )
    return cur.fetchone() is not None

def save_to_db(conn, topic: str, date_str: str, result: dict) -> str | None:
    if not result.get("sources") or len(result["sources"]) < MIN_SOURCES:
        return None

    avg_coherence = sum(s["coherence"] for s in result["sources"]) / len(result["sources"])
    if avg_coherence < MIN_COHERENCE:
        print(f"  [skip] {topic} {date_str} coherence={avg_coherence:.3f} below threshold")
        return None

    cur = conn.cursor()
    try:
        # ON CONFLICT DO NOTHING prevents duplicates from parallel runs
        cur.execute(
            "INSERT INTO analyses (topic, date) VALUES (%s, %s) ON CONFLICT DO NOTHING RETURNING id",
            (topic.upper(), date_str)
        )
        row = cur.fetchone()
        if not row:
            print(f"  [conflict] {topic} {date_str} already exists, skipping")
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
        print(f"  [db error] {topic} {date_str}: {e}")
        return None

def discover_trending(date_str: str, limit: int = 5) -> list[str]:
    try:
        from google.cloud import bigquery
        client = bigquery.Client(project="project-cbd5d6c3-e99a-41b4-bf5")
        query = """
        SELECT REGEXP_EXTRACT(V2Themes, r'([A-Z_]{4,})') AS theme, COUNT(*) as mentions
        FROM `gdelt-bq.gdeltv2.gkg`
        WHERE DATE(PARSE_TIMESTAMP('%Y%m%d%H%M%S', CAST(DATE AS STRING) || '000000'), 'UTC') = @partition_date
          AND V2Themes IS NOT NULL AND CHAR_LENGTH(V2Themes) > 10
        GROUP BY theme HAVING mentions >= 30
        ORDER BY mentions DESC LIMIT @limit
        """
        job_config = bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("partition_date", "STRING", date_str),
            bigquery.ScalarQueryParameter("limit", "INT64", limit),
        ])
        results = client.query(query, job_config=job_config).result()
        topics = [row.theme for row in results if row.theme and len(row.theme) > 2]
        print(f"  [discover] trending: {topics}")
        return topics[:limit]
    except Exception as e:
        print(f"  [discover] failed: {e}")
        return []

def ingest_topic(conn, topic: str, date_str: str) -> bool:
    if is_cached(conn, topic, date_str):
        print(f"  [cached] {topic} {date_str}")
        return False

    print(f"  [fetch]  {topic} {date_str}...")
    try:
        result = run_analysis(topic, date_str, limit=5)
        if not result.get("sources"):
            print(f"  [empty]  {topic} {date_str} — no sources")
            return False

        analysis_id = save_to_db(conn, topic, date_str, result)
        if analysis_id:
            print(f"  [saved]  {topic} {date_str} → {analysis_id} ({len(result['sources'])} sources)")
            return True
        return False
    except Exception as e:
        print(f"  [error]  {topic} {date_str}: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Rose Glass daily ingest")
    parser.add_argument("--date", default=str(date.today()))
    parser.add_argument("--topics", nargs="*")
    parser.add_argument("--discover", action="store_true")
    args = parser.parse_args()

    date_str = args.date
    topics = [t.upper() for t in args.topics] if args.topics else list(STANDING_TOPICS)

    print(f"\nRose Glass Daily Ingest — {date_str}")
    print(f"Topics: {topics}")
    print("-" * 50)

    conn = get_db()

    if args.discover:
        trending = discover_trending(date_str, limit=5)
        for t in trending:
            if t not in topics:
                topics.append(t)
        print(f"Extended topics: {topics}")

    saved = skipped = 0
    for topic in topics:
        if ingest_topic(conn, topic, date_str):
            saved += 1
        else:
            skipped += 1

    conn.close()
    print("-" * 50)
    print(f"Done: {saved} saved, {skipped} skipped/cached")
    print(f"Completed at {datetime.now().strftime('%H:%M:%S')}")

if __name__ == "__main__":
    main()

# NOTE: poem_agent is called from cron_ingest.sh after daily_ingest completes
