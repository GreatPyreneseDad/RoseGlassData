#!/usr/bin/env python3
"""
JSON wrapper around IPAI's gdelt_news_compare.py for the Rose Glass News platform.

Usage:
    python3 scripts/run_analysis.py --topic IRAN --date 2026-03-05
    python3 scripts/run_analysis.py --topic IRAN --date 2026-03-05 --limit 10

Outputs JSON to stdout with structure:
{
  "topic": "IRAN",
  "date": "2026-03-05",
  "sources": [...],
  "divergence": {...}
}
"""

import argparse
import json
import math
import sys
import os

# Add IPAI to path
IPAI_DIR = os.path.expanduser("~/IPAI")
sys.path.insert(0, IPAI_DIR)

from src.core.rose_glass_v2 import RoseGlassEngine
from scripts.news_compare import (
    SOURCE_CALIBRATIONS,
    DIMS,
    DIM_LABELS,
    compare_sources,
)
from scripts.gdelt_news_compare import (
    gdelt_query,
    fetch_article_text as _fetch_article_text_orig,
    map_source_to_type,
    _extract_domain,
    _HEADERS,
    _TAG_RE,
    _WHITESPACE_RE,
)

import re
import requests


def fetch_article_text(url: str) -> str:
    """Fetch article text with tight timeouts (3s connect, 5s read)."""
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


def run_analysis(topic: str, date_str: str, limit: int = 10) -> dict:
    """Run GDELT query + Rose Glass analysis, return structured dict."""
    articles = gdelt_query(topic, date_str, limit=limit * 3)

    if not articles:
        return {"topic": topic, "date": date_str, "sources": [], "divergence": {}}

    # Deduplicate by domain
    seen_domains = set()
    deduped = []
    for article in articles:
        domain = _extract_domain(article["url"])
        if domain and domain not in seen_domains:
            seen_domains.add(domain)
            deduped.append({**article, "domain": domain})
        if len(deduped) >= limit:
            break

    # Fetch article text
    sources = []
    for article in deduped:
        domain = article["domain"]
        text = fetch_article_text(article["url"])
        if not text:
            continue

        source_type = map_source_to_type(domain)
        sources.append({
            "source_name": f"{article['source']} ({domain})",
            "source_type": source_type,
            "text": text,
            "url": article["url"],
            "v2tone": article["v2tone"],
        })

    if len(sources) < 2:
        return {"topic": topic, "date": date_str, "sources": [], "divergence": {}}

    # Run Rose Glass comparison
    engine = RoseGlassEngine()
    comparison = compare_sources(sources, engine)

    # Build a lookup from source_name to the original source dict
    source_lookup = {s["source_name"]: s for s in sources}

    # Serialize results
    output_sources = []
    for r in comparison["results"]:
        score = r["score"]
        orig = source_lookup.get(r["source_name"], {})
        source_data = {
            "source_name": r["source_name"],
            "source_type": r["source_type"],
            "calibration": r["calibration"],
            "url": orig.get("url", ""),
            "article_text": orig.get("text", ""),
            "dimensions": {
                "psi": score.psi,
                "rho": score.rho,
                "q": score.q_raw,
                "f": score.f,
                "tau": score.tau,
                "lambda": score.lambda_,
            },
            "coherence": score.coherence,
            "veritas": score.veritas,
        }
        output_sources.append(source_data)

    # Serialize divergence
    output_divergence = {}
    for dim, info in comparison["divergence"].items():
        label = DIM_LABELS.get(dim, dim)
        output_divergence[dim] = {
            "label": label,
            "mean": round(info["mean"], 4),
            "std_dev": round(info["std_dev"], 4),
            "variance": round(info["variance"], 6),
        }

    return {
        "topic": topic,
        "date": date_str,
        "sources": output_sources,
        "divergence": output_divergence,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Rose Glass News JSON analysis")
    parser.add_argument("--topic", required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()

    result = run_analysis(args.topic, args.date, args.limit)
    print(json.dumps(result))
