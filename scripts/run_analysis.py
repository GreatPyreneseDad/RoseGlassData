#!/usr/bin/env python3
"""
RoseGlassData — Generic analysis runner.

Data source is determined by DATA_CONNECTOR env var.
Scoring pipeline is unchanged from rose-glass-news.

Usage:
    DATA_CONNECTOR=gdelt python3 scripts/run_analysis.py --entity IRAN --date 2026-03-05
    DATA_CONNECTOR=csv   python3 scripts/run_analysis.py --entity contracts --date 2026-03-05
    DATA_CONNECTOR=file  python3 scripts/run_analysis.py --entity docs --date 2026-03-05

Legacy alias: --topic maps to --entity for backward compatibility.
"""

import argparse
import json
import math
import sys
import os
import re
import requests

IPAI_DIR = os.path.expanduser("~/IPAI")
sys.path.insert(0, IPAI_DIR)

from src.core.rose_glass_v2 import RoseGlassEngine
from scripts.news_compare import (
    SOURCE_CALIBRATIONS,
    DIMS,
    DIM_LABELS,
    compare_sources,
)
from scripts.connector_base import load_connector

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}
_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")


def fetch_article_text(url: str) -> str:
    """Fetch and strip HTML from a URL. Used only when connector returns URL without inline text."""
    try:
        resp = requests.get(url, headers=_HEADERS, timeout=(3, 5))
        resp.raise_for_status()
        html = resp.text
        html = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(r"<style[^>]*>.*?</style>", " ", html, flags=re.DOTALL | re.IGNORECASE)
        text = _TAG_RE.sub(" ", html)
        text = _WHITESPACE_RE.sub(" ", text).strip()
        return text[:5000]
    except Exception:
        return ""


def run_analysis(entity: str, date_str: str, limit: int = 10) -> dict:
    """
    Run connector query + Rose Glass analysis, return structured dict.
    entity is the grouping key: topic, case_id, ticker, customer_id, etc.
    """
    connector = load_connector()
    records = connector.query(entity, date_str, limit=limit)

    if not records:
        return {"entity": entity, "date": date_str, "sources": [], "divergence": {}}

    sources = []
    for record in records:
        text = record.get("text", "").strip()
        if not text and record.get("url", "").startswith("http"):
            text = fetch_article_text(record["url"])
        if not text:
            continue
        source_name = record.get("source", record.get("url", f"source-{len(sources)}"))
        sources.append({
            "source_name": source_name,
            "source_type": record.get("source_type", "document"),
            "calibration": record.get("calibration", SOURCE_CALIBRATIONS.get(source_name, "unknown")),
            "text": text,
            "url": record.get("url", ""),
        })

    if len(sources) < 2:
        return {"entity": entity, "date": date_str, "sources": [], "divergence": {}}

    engine = RoseGlassEngine()
    comparison = compare_sources(sources, engine)
    source_lookup = {s["source_name"]: s for s in sources}

    output_sources = []
    for r in comparison["results"]:
        score = r["score"]
        orig = source_lookup.get(r["source_name"], {})
        output_sources.append({
            "source_name": r["source_name"],
            "source_type": r["source_type"],
            "calibration": r["calibration"],
            "url": orig.get("url", ""),
            "article_text": orig.get("text", ""),
            "dimensions": {dim: round(getattr(score, dim, 0), 4) for dim in DIMS},
            "coherence": round(score.coherence, 4),
            "veritas_score": round(score.veritas_score, 4),
            "veritas_assessment": score.veritas_assessment,
            "poem": r.get("poem", ""),
            "cultural_lens": r.get("cultural_lens", ""),
        })

    output_divergence = {}
    for dim, info in comparison.get("divergence", {}).items():
        output_divergence[dim] = {
            "mean": round(info["mean"], 4),
            "std_dev": round(info["std_dev"], 4),
            "variance": round(info["variance"], 6),
        }

    return {
        "entity": entity,
        "date": date_str,
        "sources": output_sources,
        "divergence": output_divergence,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RoseGlassData — dimensional analysis for any dataset")
    parser.add_argument("--entity", help="Grouping key (topic, case_id, ticker, etc.)")
    parser.add_argument("--topic", help="Alias for --entity (backward compatibility)")
    parser.add_argument("--date", required=True)
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()

    entity = args.entity or args.topic
    if not entity:
        parser.error("--entity (or --topic) is required")

    result = run_analysis(entity, args.date, args.limit)
    print(json.dumps(result))
