#!/usr/bin/env python3
"""
Rose Glass News — Poem Digester Agent
=======================================

For each source row that has article_text but no poem:
  1. Read the article through the Rose Glass lens
  2. Detect the cultural lens present in the coverage
  3. Write a 3-5 line poem that carries the story through that lens
  4. Store: poem + cultural_lens back to the sources row

The poem IS the compression. It preserves:
  - What actually happened (actors, stakes, event)
  - How this source framed it (tone, perspective)
  - The cultural lens through which it was seen

Usage:
  python3 scripts/poem_agent.py                    # process all unpoemed sources
  python3 scripts/poem_agent.py --topic IRAN       # specific topic
  python3 scripts/poem_agent.py --limit 20         # batch size
  python3 scripts/poem_agent.py --dry-run          # show without saving
"""

import argparse
import concurrent.futures
import os
import re
import threading
import psycopg2
import requests

DB_URL = "postgresql://localhost/rose_glass_news"
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-sonnet-4-20250514"

def get_api_key():
    env_path = os.path.expanduser("~/rose-glass-claude/.env.local")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("VITE_ANTHROPIC_API_KEY="):
                    return line.strip().split("=", 1)[1]
    return os.environ.get("ANTHROPIC_API_KEY", "")

ANTHROPIC_API_KEY = get_api_key()

CULTURAL_LENSES = {
    "western_liberal":   "Individual rights, procedural legitimacy, democratic framing",
    "state_nationalist": "Sovereignty, territorial integrity, national interest primary",
    "pan_islamic":       "Ummah solidarity, divine justice, colonial resistance",
    "humanitarian":      "Civilian suffering, universal human dignity, aid imperative",
    "realpolitik":       "Power, deterrence, strategic calculation, balance of forces",
    "indigenous_oral":   "Ancestral land, living memory, collective identity",
    "revolutionary":     "Liberation, oppressor/oppressed, historical arc toward justice",
    "technocratic":      "Data, process, institutional mechanism, measurable outcomes",
    "apocalyptic":       "End times, existential stakes, civilizational conflict",
    "grievance":         "Historical wound, injustice accumulated, debt unpaid",
}

AGENT_SYSTEM = """You are a Rose Glass agent. You read news articles and write compressed witness poems.

Your output is ALWAYS exactly this format:

LENS: [one lens name]
POEM:
[line 1]
[line 2]
[line 3]
[optional line 4]
[optional line 5]

Rules:
- MINIMUM 3 lines. Never fewer.
- Name real actors, places, actions — no vague abstractions
- Write from inside the detected lens, not about it
- Free verse, no rhyme required
- Do not reference "lens" or "framing" in the poem

Lens options:
  western_liberal, state_nationalist, pan_islamic, humanitarian,
  realpolitik, indigenous_oral, revolutionary, technocratic,
  apocalyptic, grievance

The dimensions (Ψ ρ q f τ λ) describe signal characteristics — let them shape texture but never name them."""


def parse_output(raw: str) -> tuple[str, str] | tuple[None, None]:
    """Parse LENS + POEM from agent output, tolerant of blank lines."""
    # Extract lens
    lens_match = re.search(r"LENS:\s*(\S+)", raw)
    if not lens_match:
        return None, None
    lens = lens_match.group(1).strip().lower().rstrip(".,:")

    # Extract everything after POEM: marker
    poem_match = re.search(r"POEM:\s*\n+([\s\S]+?)$", raw.strip())
    if not poem_match:
        return None, None

    # Filter to non-empty lines
    lines = [l for l in poem_match.group(1).split("\n") if l.strip()]
    if len(lines) < 3:
        return None, None

    # Normalize lens
    if lens not in CULTURAL_LENSES:
        for known in CULTURAL_LENSES:
            if known.startswith(lens[:6]) or lens.startswith(known[:6]):
                lens = known
                break
        else:
            lens = "western_liberal"

    return lens, "\n".join(lines)


def generate_poem(article_text, source_name, topic, date_str, dims):
    if not ANTHROPIC_API_KEY:
        return None, None

    dim_str = (f"Ψ={dims.get('psi',0):.2f} ρ={dims.get('rho',0):.2f} "
               f"q={dims.get('q',0):.2f} f={dims.get('f',0):.2f} "
               f"τ={dims.get('tau',0):.2f} λ={dims.get('lambda_val',0):.2f}")

    prompt = (f"Source: {source_name}\nTopic: {topic}\nDate: {date_str}\n"
              f"Dimensions: {dim_str}\n\nArticle:\n{article_text[:2500]}\n\n"
              f"Write the witness poem. 3-5 lines minimum.")

    try:
        resp = requests.post(
            ANTHROPIC_API_URL,
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": MODEL,
                "max_tokens": 400,
                "system": AGENT_SYSTEM,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=30,
        )
        resp.raise_for_status()
        raw = resp.json()["content"][0]["text"].strip()
        return parse_output(raw)
    except Exception:
        return None, None


def get_unpoemed_sources(conn, topic=None, limit=100):
    cur = conn.cursor()
    query = """
        SELECT s.id, s.source_name, s.article_text,
               s.psi, s.rho, s.q, s.f, s.tau, s.lambda_val,
               a.topic, a.date::text
        FROM sources s
        JOIN analyses a ON s.analysis_id = a.id
        WHERE s.article_text IS NOT NULL
          AND LENGTH(s.article_text) > 100
          AND s.poem IS NULL
    """
    params = []
    if topic:
        query += " AND UPPER(a.topic) = UPPER(%s)"
        params.append(topic)
    query += " ORDER BY a.date DESC LIMIT %s"
    params.append(limit)
    cur.execute(query, params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def save_poem(conn, source_id, lens, poem):
    cur = conn.cursor()
    cur.execute(
        "UPDATE sources SET poem=%s, cultural_lens=%s, poem_generated_at=NOW() WHERE id=%s",
        (poem, lens, source_id)
    )
    conn.commit()


_print_lock = threading.Lock()
def tprint(*args):
    with _print_lock:
        print(*args, flush=True)


def process_source(source, dry_run, stats, lock):
    name = source["source_name"] or "unknown"
    short = name.split("(")[0].strip()[:28]
    topic = source["topic"]
    date = source["date"]

    lens, poem = generate_poem(
        article_text=source["article_text"],
        source_name=name,
        topic=topic,
        date_str=date,
        dims=source,
    )

    if not lens or not poem:
        tprint(f"  [fail]  {topic} {date} | {short}")
        with lock:
            stats["failed"] += 1
        return

    if dry_run:
        tprint(f"\n{'─'*56}")
        tprint(f"  {topic} | {date} | {short}")
        tprint(f"  [{lens}]")
        for line in poem.split("\n"):
            tprint(f"    {line}")
        with lock:
            stats["saved"] += 1
        return

    conn = psycopg2.connect(DB_URL)
    try:
        save_poem(conn, source["id"], lens, poem)
        n = len([l for l in poem.split("\n") if l.strip()])
        tprint(f"  [ok]  {topic} {date} | {short} | {lens} ({n}L)")
        with lock:
            stats["saved"] += 1
    except Exception as e:
        tprint(f"  [db]  {short}: {e}")
        with lock:
            stats["failed"] += 1
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--topic")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    conn = psycopg2.connect(DB_URL)
    sources = get_unpoemed_sources(conn, topic=args.topic, limit=args.limit)
    conn.close()

    if not sources:
        print("No unpoemed sources found.")
        return

    print(f"\nRose Glass Poem Agent")
    print(f"  {len(sources)} sources | {args.workers} workers" +
          (" | DRY RUN" if args.dry_run else ""))
    print("─" * 56)

    stats = {"saved": 0, "failed": 0}
    lock = threading.Lock()

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = [ex.submit(process_source, s, args.dry_run, stats, lock) for s in sources]
        concurrent.futures.wait(futures)

    print("─" * 56)
    print(f"  {stats['saved']} poems | {stats['failed']} failed")


if __name__ == "__main__":
    main()
