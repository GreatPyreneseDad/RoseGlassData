import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";

const IPAI_URL = process.env.IPAI_API_URL || "https://ipai-production.up.railway.app";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { topic, date } = body;

    if (!topic || !date) {
      return NextResponse.json({ error: "topic and date are required" }, { status: 400 });
    }

    const normalizedTopic = topic.trim().toUpperCase();

    // Check Supabase cache first
    const db = getDB();
    const cached = await db.query(
      `SELECT a.id, a.topic, a.date,
              json_agg(json_build_object(
                'source_name', s.source_name,
                'source_type', s.source_type,
                'calibration', s.calibration,
                'url', s.url,
                'coherence', s.coherence,
                'poem', s.poem,
                'cultural_lens', s.cultural_lens,
                'dimensions', json_build_object(
                  'psi', s.psi, 'rho', s.rho, 'q', s.q,
                  'f', s.f, 'tau', s.tau, 'lambda', s.lambda_val
                )
              )) AS sources
       FROM analyses a
       JOIN sources s ON s.analysis_id = a.id
       WHERE UPPER(a.topic) = $1 AND a.date = $2
       GROUP BY a.id, a.topic, a.date
       LIMIT 1`,
      [normalizedTopic, date]
    );

    if (cached.rows.length > 0) {
      const row = cached.rows[0];
      return NextResponse.json({ topic: row.topic, date: row.date, sources: row.sources });
    }

    // Not cached — trigger IPAI ingest
    const ipaiRes = await fetch(`${IPAI_URL}/news/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topics: [normalizedTopic], date, limit: 8 }),
      signal: AbortSignal.timeout(180_000),
    });

    if (!ipaiRes.ok) {
      const err = await ipaiRes.text();
      return NextResponse.json({ error: `IPAI error: ${err}` }, { status: 500 });
    }

    const ipaiData = await ipaiRes.json();

    // If saved, trigger poem generation in background (don't await)
    if (ipaiData.saved?.length > 0) {
      fetch(`${IPAI_URL}/news/poem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: normalizedTopic, limit: 20 }),
      }).catch(() => {});
    }

    // Return fresh data from Supabase
    const fresh = await db.query(
      `SELECT a.id, a.topic, a.date,
              json_agg(json_build_object(
                'source_name', s.source_name,
                'source_type', s.source_type,
                'calibration', s.calibration,
                'url', s.url,
                'coherence', s.coherence,
                'poem', s.poem,
                'cultural_lens', s.cultural_lens,
                'dimensions', json_build_object(
                  'psi', s.psi, 'rho', s.rho, 'q', s.q,
                  'f', s.f, 'tau', s.tau, 'lambda', s.lambda_val
                )
              )) AS sources
       FROM analyses a
       JOIN sources s ON s.analysis_id = a.id
       WHERE UPPER(a.topic) = $1 AND a.date = $2
       GROUP BY a.id, a.topic, a.date
       LIMIT 1`,
      [normalizedTopic, date]
    );

    if (fresh.rows.length > 0) {
      const row = fresh.rows[0];
      return NextResponse.json({ topic: row.topic, date: row.date, sources: row.sources });
    }

    return NextResponse.json({ error: "No articles found for this topic and date" }, { status: 404 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[analyze] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
