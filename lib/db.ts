import { Pool } from "pg";

// Local dev: postgresql://localhost/rose_glass_news
// Production: set DATABASE_URL in Vercel env vars (Supabase connection string)
const connectionString =
  process.env.DATABASE_URL || "postgresql://localhost/rose_glass_news";

const pool = new Pool({
  connectionString,
  // Supabase requires SSL in production
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT NOT NULL,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE,
  source_name TEXT,
  source_type TEXT,
  calibration TEXT,
  url TEXT,
  article_text TEXT,
  psi FLOAT, rho FLOAT, q FLOAT, f FLOAT, tau FLOAT, lambda_val FLOAT,
  coherence FLOAT,
  veritas_score FLOAT,
  veritas_assessment TEXT,
  poem TEXT,
  cultural_lens TEXT,
  poem_generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS divergence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE,
  dimension TEXT,
  mean_val FLOAT,
  std_dev FLOAT,
  variance FLOAT
);
`;

let initialized = false;

export async function initDB() {
  if (initialized) return;
  await pool.query(SCHEMA);
  initialized = true;
}

export { pool };

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
  [dim: string]: {
    label: string;
    mean: number;
    std_dev: number;
    variance: number;
  };
}

export async function saveAnalysis(
  topic: string,
  date: string,
  sources: SourceInput[],
  divergence: DivergenceInput
): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const analysisResult = await client.query(
      "INSERT INTO analyses (topic, date) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id",
      [topic, date]
    );

    let analysisId: string;
    if (analysisResult.rows.length === 0) {
      const existing = await client.query(
        "SELECT id FROM analyses WHERE UPPER(topic) = UPPER($1) AND date = $2",
        [topic, date]
      );
      analysisId = existing.rows[0].id;
    } else {
      analysisId = analysisResult.rows[0].id;
    }

    for (const s of sources) {
      const veritasScore = s.veritas?.authenticity_score ?? null;
      const veritasAssessment = s.veritas?.flags?.length
        ? s.veritas.flags.join(", ")
        : null;

      await client.query(
        `INSERT INTO sources
          (analysis_id, source_name, source_type, calibration, url, article_text,
           psi, rho, q, f, tau, lambda_val, coherence, veritas_score, veritas_assessment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          analysisId,
          s.source_name, s.source_type, s.calibration,
          s.url || null, s.article_text || null,
          s.dimensions.psi ?? null, s.dimensions.rho ?? null,
          s.dimensions.q ?? null, s.dimensions.f ?? null,
          s.dimensions.tau ?? null, s.dimensions.lambda ?? null,
          s.coherence, veritasScore, veritasAssessment,
        ]
      );
    }

    for (const [dim, info] of Object.entries(divergence)) {
      await client.query(
        `INSERT INTO divergence (analysis_id, dimension, mean_val, std_dev, variance)
         VALUES ($1,$2,$3,$4,$5)`,
        [analysisId, dim, info.mean, info.std_dev, info.variance]
      );
    }

    await client.query("COMMIT");
    return analysisId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getCachedAnalysis(topic: string, date: string) {
  const analysisResult = await pool.query(
    `SELECT id, topic, date::text, created_at FROM analyses
     WHERE UPPER(topic) = UPPER($1) AND date = $2
     ORDER BY created_at DESC LIMIT 1`,
    [topic, date]
  );
  if (analysisResult.rows.length === 0) return null;

  const analysis = analysisResult.rows[0];
  const sourcesResult = await pool.query(
    `SELECT source_name, source_type, calibration, url, article_text,
            psi, rho, q, f, tau, lambda_val, coherence,
            veritas_score, veritas_assessment
     FROM sources WHERE analysis_id = $1`,
    [analysis.id]
  );

  const sources = sourcesResult.rows.map((r) => ({
    source_name: r.source_name,
    source_type: r.source_type,
    calibration: r.calibration,
    url: r.url,
    article_text: r.article_text,
    dimensions: { psi: r.psi, rho: r.rho, q: r.q, f: r.f, tau: r.tau, lambda: r.lambda_val },
    coherence: r.coherence,
    veritas: r.veritas_score != null
      ? { authenticity_score: r.veritas_score, flags: r.veritas_assessment ? r.veritas_assessment.split(", ") : [] }
      : null,
  }));

  const divergenceResult = await pool.query(
    `SELECT dimension, mean_val, std_dev, variance FROM divergence WHERE analysis_id = $1`,
    [analysis.id]
  );

  const divergence: Record<string, { label: string; mean: number; std_dev: number; variance: number }> = {};
  for (const r of divergenceResult.rows) {
    divergence[r.dimension] = { label: r.dimension, mean: r.mean_val, std_dev: r.std_dev, variance: r.variance };
  }

  return { analysis_id: analysis.id, topic: analysis.topic, date: analysis.date, sources, divergence, cache: true };
}

export async function getRecentAnalyses(limit = 10) {
  const result = await pool.query(
    `SELECT id, topic, date::text, created_at FROM analyses ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function getAnalysisWithSources(analysisId: string) {
  const analysisResult = await pool.query(
    `SELECT id, topic, date::text FROM analyses WHERE id = $1`,
    [analysisId]
  );
  if (analysisResult.rows.length === 0) return null;
  const analysis = analysisResult.rows[0];
  const sourcesResult = await pool.query(
    `SELECT source_name, source_type, calibration, url, article_text,
            psi, rho, q, f, tau, lambda_val, coherence, veritas_score, veritas_assessment
     FROM sources WHERE analysis_id = $1`,
    [analysisId]
  );
  return { ...analysis, sources: sourcesResult.rows };
}
