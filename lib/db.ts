import { Pool } from "pg";

function getPool() {
  return new Pool({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost/rose_glass_news",
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false, checkServerIdentity: () => undefined } : false,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

let _pool: Pool | null = null;
export function getDB() {
  if (!_pool) _pool = getPool();
  return _pool;
}

// Legacy export for routes that import pool directly
export const pool = new Proxy({} as Pool, {
  get(_, prop) {
    return (getDB() as any)[prop];
  },
});

export async function initDB() {}

interface SourceInput {
  source_name: string;
  source_type: string;
  calibration: string;
  url?: string;
  article_text?: string;
  dimensions: Record<string, number>;
  coherence: number;
  veritas: { authenticity_score: number; flags: string[] } | null;
}

interface DivergenceInput {
  [dim: string]: { label: string; mean: number; std_dev: number; variance: number };
}

export async function saveAnalysis(
  topic: string,
  date: string,
  sources: SourceInput[],
  divergence: DivergenceInput
): Promise<string> {
  const db = getDB();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const ar = await client.query(
      "INSERT INTO analyses (topic, date) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id",
      [topic, date]
    );
    let analysisId: string;
    if (ar.rows.length === 0) {
      const ex = await client.query(
        "SELECT id FROM analyses WHERE UPPER(topic)=UPPER($1) AND date=$2",
        [topic, date]
      );
      analysisId = ex.rows[0].id;
    } else {
      analysisId = ar.rows[0].id;
    }
    for (const s of sources) {
      await client.query(
        `INSERT INTO sources (analysis_id,source_name,source_type,calibration,url,article_text,
         psi,rho,q,f,tau,lambda_val,coherence,veritas_score,veritas_assessment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [analysisId, s.source_name, s.source_type, s.calibration,
         s.url||null, s.article_text||null,
         s.dimensions.psi??null, s.dimensions.rho??null, s.dimensions.q??null,
         s.dimensions.f??null, s.dimensions.tau??null, s.dimensions.lambda??null,
         s.coherence, s.veritas?.authenticity_score??null,
         s.veritas?.flags?.join(", ")||null]
      );
    }
    for (const [dim, info] of Object.entries(divergence)) {
      await client.query(
        "INSERT INTO divergence (analysis_id,dimension,mean_val,std_dev,variance) VALUES ($1,$2,$3,$4,$5)",
        [analysisId, dim, info.mean, info.std_dev, info.variance]
      );
    }
    await client.query("COMMIT");
    return analysisId;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function getCachedAnalysis(topic: string, date: string) {
  const db = getDB();
  const ar = await db.query(
    "SELECT id,topic,date::text,created_at FROM analyses WHERE UPPER(topic)=UPPER($1) AND date=$2 ORDER BY created_at DESC LIMIT 1",
    [topic, date]
  );
  if (!ar.rows.length) return null;
  const a = ar.rows[0];
  const sr = await db.query(
    "SELECT * FROM sources WHERE analysis_id=$1", [a.id]
  );
  const dr = await db.query(
    "SELECT * FROM divergence WHERE analysis_id=$1", [a.id]
  );
  const divergence: Record<string, any> = {};
  for (const r of dr.rows) {
    divergence[r.dimension] = { label: r.dimension, mean: r.mean_val, std_dev: r.std_dev, variance: r.variance };
  }
  return {
    analysis_id: a.id, topic: a.topic, date: a.date,
    sources: sr.rows.map((r: any) => ({
      source_name: r.source_name, source_type: r.source_type,
      calibration: r.calibration, url: r.url, article_text: r.article_text,
      dimensions: { psi: r.psi, rho: r.rho, q: r.q, f: r.f, tau: r.tau, lambda: r.lambda_val },
      coherence: r.coherence,
      veritas: r.veritas_score != null
        ? { authenticity_score: r.veritas_score, flags: r.veritas_assessment?.split(", ")||[] }
        : null,
    })),
    divergence, cache: true,
  };
}

export async function getRecentAnalyses(limit = 10) {
  const db = getDB();
  const r = await db.query(
    "SELECT id,topic,date::text,created_at FROM analyses ORDER BY created_at DESC LIMIT $1", [limit]
  );
  return r.rows;
}

export async function getAnalysisWithSources(analysisId: string) {
  const db = getDB();
  const ar = await db.query("SELECT id,topic,date::text FROM analyses WHERE id=$1", [analysisId]);
  if (!ar.rows.length) return null;
  const sr = await db.query("SELECT * FROM sources WHERE analysis_id=$1", [analysisId]);
  return { ...ar.rows[0], sources: sr.rows };
}
