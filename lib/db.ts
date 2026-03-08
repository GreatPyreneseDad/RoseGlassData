import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Server-side client — uses service role, bypasses RLS for writes
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

// Keep pool export for any routes still using raw pg locally
import { Pool } from "pg";
export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || "postgresql://localhost/rose_glass_news",
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

export async function initDB() {
  // No-op when using Supabase client — schema managed via migrations
}

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
  // Upsert analysis
  const { data: existing } = await supabase
    .from("analyses")
    .select("id")
    .eq("topic", topic.toUpperCase())
    .eq("date", date)
    .single();

  let analysisId: string;

  if (existing) {
    analysisId = existing.id;
  } else {
    const { data, error } = await supabase
      .from("analyses")
      .insert({ topic: topic.toUpperCase(), date })
      .select("id")
      .single();
    if (error) throw error;
    analysisId = data.id;
  }

  // Insert sources
  const sourceRows = sources.map((s) => ({
    analysis_id: analysisId,
    source_name: s.source_name,
    source_type: s.source_type,
    calibration: s.calibration,
    url: s.url || null,
    article_text: s.article_text || null,
    psi: s.dimensions.psi ?? null,
    rho: s.dimensions.rho ?? null,
    q: s.dimensions.q ?? null,
    f: s.dimensions.f ?? null,
    tau: s.dimensions.tau ?? null,
    lambda_val: s.dimensions.lambda ?? null,
    coherence: s.coherence,
    veritas_score: s.veritas?.authenticity_score ?? null,
    veritas_assessment: s.veritas?.flags?.join(", ") || null,
  }));

  const { error: srcErr } = await supabase.from("sources").insert(sourceRows);
  if (srcErr) throw srcErr;

  // Insert divergence
  const divRows = Object.entries(divergence).map(([dim, info]) => ({
    analysis_id: analysisId,
    dimension: dim,
    mean_val: info.mean,
    std_dev: info.std_dev,
    variance: info.variance,
  }));

  const { error: divErr } = await supabase.from("divergence").insert(divRows);
  if (divErr) throw divErr;

  return analysisId;
}

export async function getCachedAnalysis(topic: string, date: string) {
  const { data: analysis } = await supabase
    .from("analyses")
    .select("id, topic, date, created_at")
    .eq("date", date)
    .ilike("topic", topic)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!analysis) return null;

  const { data: sources } = await supabase
    .from("sources")
    .select("*")
    .eq("analysis_id", analysis.id);

  const { data: divRows } = await supabase
    .from("divergence")
    .select("*")
    .eq("analysis_id", analysis.id);

  const divergence: Record<string, { label: string; mean: number; std_dev: number; variance: number }> = {};
  for (const r of divRows || []) {
    divergence[r.dimension] = {
      label: r.dimension,
      mean: r.mean_val,
      std_dev: r.std_dev,
      variance: r.variance,
    };
  }

  return {
    analysis_id: analysis.id,
    topic: analysis.topic,
    date: analysis.date,
    sources: (sources || []).map((r) => ({
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
    })),
    divergence,
    cache: true,
  };
}

export async function getRecentAnalyses(limit = 10) {
  const { data } = await supabase
    .from("analyses")
    .select("id, topic, date, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data || [];
}

export async function getAnalysisWithSources(analysisId: string) {
  const { data: analysis } = await supabase
    .from("analyses")
    .select("id, topic, date")
    .eq("id", analysisId)
    .single();

  if (!analysis) return null;

  const { data: sources } = await supabase
    .from("sources")
    .select("*")
    .eq("analysis_id", analysisId);

  return { ...analysis, sources: sources || [] };
}
