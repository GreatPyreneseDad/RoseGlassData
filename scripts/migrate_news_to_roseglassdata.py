#!/usr/bin/env python3
"""
migrate_news_to_roseglassdata.py

Reads all data from roseglass.news Supabase (old schema)
Writes into rose-glass-data Supabase (new schema)

Old schema:  analyses(id, topic, date) -> sources(...) -> divergence(...)
New schema:  entity_nodes(id, label) -> analyses(id, entity_node_id, date) -> sources(...) -> divergence(...)

Run once. Safe to re-run — skips existing entity_nodes and analyses by label+date uniqueness.
"""

import psycopg2
import psycopg2.extras
import uuid
from datetime import datetime

# ── Connection strings ──────────────────────────────────────────────────────
OLD_DB = "postgresql://postgres:qoCcyv-9pucvy-kerzas@db.jjmmcutcrgerutvotjds.supabase.co:5432/postgres?sslmode=require"
NEW_DB = "postgresql://postgres:dycgyv-nugxi8-myjmYh@db.boupwgkkzexwisctrhdr.supabase.co:5432/postgres?sslmode=require"

def migrate():
    print("Connecting to source (roseglass.news)...")
    src = psycopg2.connect(OLD_DB)
    src.autocommit = False

    print("Connecting to target (rose-glass-data)...")
    dst = psycopg2.connect(NEW_DB)
    dst.autocommit = False

    src_cur = src.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    dst_cur = dst.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # ── 1. Insert default domain config ────────────────────────────────────
    print("\n[1] Seeding domain_configs...")
    domain_id = str(uuid.uuid4())
    dst_cur.execute("""
        INSERT INTO domain_configs (id, name, entity_label, domain_question, connector, search_context, deployment_tier, source_types)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT DO NOTHING
    """, (
        domain_id,
        "Rose Glass News",
        "topic",
        "How do different global news sources frame the same events through different cultural lenses?",
        "gdelt",
        "global news coverage",
        "commercial",
        psycopg2.extras.Json(["news", "international", "editorial"])
    ))
    # Get the actual domain_id (in case it already existed)
    dst_cur.execute("SELECT id FROM domain_configs WHERE name = %s LIMIT 1", ("Rose Glass News",))
    row = dst_cur.fetchone()
    domain_id = row["id"] if row else domain_id
    print(f"  domain_id: {domain_id}")

    # ── 2. Fetch all analyses from source ──────────────────────────────────
    print("\n[2] Fetching analyses from source...")
    src_cur.execute("SELECT id, topic, date, created_at FROM analyses ORDER BY date ASC")
    analyses = src_cur.fetchall()
    print(f"  Found {len(analyses)} analyses")

    # ── 3. Build entity_nodes for each unique topic ────────────────────────
    print("\n[3] Creating entity_nodes...")
    topics = list(set(a["topic"] for a in analyses))
    topic_to_node_id = {}

    for topic in topics:
        # Check if already exists
        dst_cur.execute("SELECT id FROM entity_nodes WHERE UPPER(label) = UPPER(%s) LIMIT 1", (topic,))
        existing = dst_cur.fetchone()
        if existing:
            topic_to_node_id[topic] = existing["id"]
            continue
        node_id = str(uuid.uuid4())
        dst_cur.execute("""
            INSERT INTO entity_nodes (id, domain_id, label, entity_type, depth_level, path, metadata)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (
            node_id,
            domain_id,
            topic,
            "topic",
            0,
            topic.lower().replace(" ", "_").replace("-", "_")[:100],
            psycopg2.extras.Json({"source": "migrated_from_roseglass_news", "original_topic": topic})
        ))
        topic_to_node_id[topic] = node_id

    print(f"  Created/found {len(topic_to_node_id)} entity nodes")
    dst.commit()

    # ── 4. Migrate analyses + sources + divergence ─────────────────────────
    print("\n[4] Migrating analyses, sources, divergence...")
    skipped = 0
    migrated = 0

    for i, analysis in enumerate(analyses):
        old_analysis_id = analysis["id"]
        topic = analysis["topic"]
        date = analysis["date"]
        node_id = topic_to_node_id[topic]

        # Check if already migrated
        dst_cur.execute(
            "SELECT id FROM analyses WHERE entity_node_id = %s AND date = %s LIMIT 1",
            (node_id, date)
        )
        if dst_cur.fetchone():
            skipped += 1
            continue

        # Insert analysis
        new_analysis_id = str(uuid.uuid4())
        dst_cur.execute("""
            INSERT INTO analyses (id, entity_node_id, domain_id, date, created_at)
            VALUES (%s, %s, %s, %s, %s)
        """, (new_analysis_id, node_id, domain_id, date, analysis["created_at"]))

        # Fetch sources for this analysis
        src_cur.execute("""
            SELECT * FROM sources WHERE analysis_id = %s
        """, (old_analysis_id,))
        sources = src_cur.fetchall()

        for s in sources:
            new_source_id = str(uuid.uuid4())
            dst_cur.execute("""
                INSERT INTO sources (
                    id, analysis_id, source_name, source_type, calibration, url,
                    psi, rho, q, f, tau, lambda_val, coherence,
                    veritas_score, veritas_assessment, poem, cultural_lens,
                    poem_generated_at, created_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s
                )
            """, (
                new_source_id, new_analysis_id,
                s.get("source_name"), s.get("source_type"), s.get("calibration"), s.get("url"),
                s.get("psi"), s.get("rho"), s.get("q"), s.get("f"), s.get("tau"), s.get("lambda_val"), s.get("coherence"),
                s.get("veritas_score"), s.get("veritas_assessment"), s.get("poem"), s.get("cultural_lens"),
                s.get("poem_generated_at"), s.get("created_at")
            ))

        # Fetch divergence for this analysis
        src_cur.execute("SELECT * FROM divergence WHERE analysis_id = %s", (old_analysis_id,))
        divs = src_cur.fetchall()

        for d in divs:
            dst_cur.execute("""
                INSERT INTO divergence (id, analysis_id, dimension, mean_val, std_dev, variance)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                str(uuid.uuid4()), new_analysis_id,
                d["dimension"], d["mean_val"], d["std_dev"], d["variance"]
            ))

        migrated += 1
        if migrated % 50 == 0:
            dst.commit()
            print(f"  ...committed {migrated} analyses so far")

    dst.commit()
    print(f"\nDone. Migrated: {migrated} | Skipped (already exists): {skipped}")

    # ── 5. Verify ──────────────────────────────────────────────────────────
    print("\n[5] Verifying target counts...")
    for table in ["entity_nodes", "analyses", "sources", "divergence"]:
        dst_cur.execute(f"SELECT COUNT(*) FROM {table}")
        count = dst_cur.fetchone()["count"]
        print(f"  {table}: {count}")

    src.close()
    dst.close()
    print("\nMigration complete.")

if __name__ == "__main__":
    migrate()
