// app/api/read/route.ts
//
// PUBLIC schema-read endpoint for the EE26 demo page.
//
// This reuses the SAME reader logic as the account-gated /api/upload
// (profileCSV + translateColumns) but with three deliberate differences required
// by the EE26 brief: (1) no account / no API key / no token decrement, (2) nothing
// is persisted or logged — schema in, read out, in-session only, (3) a deterministic
// BRFSS-aware structural pre-layer (lib/reader/structural) runs alongside the Claude
// pass so the "which kind of null", raw->derived, design-weight, and "absence wearing
// a large number" structure surfaces even when the model can't see it.
//
// Two Hands: this returns ONLY Hand 1 (what is perceived about the dataset). It never
// returns advice/score/grade — free-text from the model is scrubbed, and where a lens
// cannot verify, the field is left null (Veritas / silence), never guessed.

import { NextRequest, NextResponse } from "next/server";
import { profileCSV } from "@/lib/csv-profiler";
import { translateColumns } from "@/lib/column-translator";
import { analyzeStructure } from "@/lib/reader/structural";

export const runtime = "nodejs";
export const maxDuration = 60;

// ---- guards: this is public, so bound the work and never persist ----
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB of CSV text
const MAX_ROWS = 6000; // schema reading, not analytics — sample is plenty
const RATE_PER_MIN = 12; // per-IP, best-effort (resets on cold start)

const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const e = hits.get(ip);
  if (!e || now > e.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  e.count += 1;
  return e.count > RATE_PER_MIN;
}

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else {
        if (ch === '"') q = true;
        else if (ch === ",") { out.push(cur); cur = ""; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1, 1 + MAX_ROWS).map(parseLine);
  return { headers, rows };
}

// Translation, not judgment: drop any model free-text that drifts into advice/scoring.
const BANNED = /\b(scores?|graded?|grades|recommend\w*|advice|advise[sd]?|should|improv\w*)\b/i;
function clean(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t || /^none$/i.test(t)) return null;
  if (BANNED.test(t)) return null; // silence beats a confident judgment
  return t;
}

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "anon";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: "Too many reads from this address — wait a minute." },
      { status: 429 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const filename = typeof body.filename === "string" ? body.filename : "upload.csv";
  const csv =
    (typeof body.csv_text === "string" && body.csv_text) ||
    (typeof body.csvText === "string" && body.csvText) ||
    (typeof body.content === "string" && body.content) ||
    "";
  if (!csv) {
    return NextResponse.json({ ok: false, error: "csv_text required." }, { status: 400 });
  }
  if (csv.length > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: "CSV too large for the in-session reader (8 MB max)." },
      { status: 413 }
    );
  }

  const { headers, rows } = parseCSV(csv);
  if (headers.length === 0) {
    return NextResponse.json({ ok: false, error: "Empty or invalid CSV." }, { status: 400 });
  }

  // 1. deterministic structural profile (shared with /api/upload)
  const profile = profileCSV(filename, headers, rows);

  // 2. deterministic structural pre-layer (typed nulls, raw->derived, weights, naive-vs-valid)
  const structure = analyzeStructure(headers, rows);

  // 3. Claude semantic pass — best-effort and TIME-BOUNDED. The deterministic read
  //    above is the headline; the model pass only enriches it. If the model is slow,
  //    missing its key, or errors, we proceed with semantic=null (Veritas silence)
  //    rather than let this public function hang until a gateway timeout (504).
  let semantic = null;
  try {
    const translatePromise = translateColumns(
      profile.columns.map((c) => ({
        name: c.name,
        concept: c.concept,
        sample_values: c.sample_values,
        null_rate: c.null_rate,
        unique_count: c.unique_count,
        predicate_type: c.predicate_type,
      })),
      filename,
      profile.row_count
    );
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 48_000));
    semantic = await Promise.race([translatePromise, timeout]);
  } catch {
    semantic = null;
  }

  const semByCol = new Map(
    (semantic?.semantic_columns ?? []).map((c) => [c.column, c])
  );
  const structByCol = new Map(structure.columns.map((c) => [c.name, c]));

  // ---- assemble Hand 1 (read vocabulary only) ----
  const columns = profile.columns.map((c) => {
    const sem = semByCol.get(c.name);
    const st = structByCol.get(c.name)!;

    const nullKinds = st.null_findings.map((f) => ({
      code: f.code,
      kind: f.kind,
      label: f.label,
      n: f.n,
    }));

    // proxy risk: prefer the model's named level; fall back to the deterministic
    // contested-concept flag so the vocabulary is present even without the model.
    let proxy: { level: string; note: string | null } | null = null;
    if (sem && sem.proxy_risk && sem.proxy_risk !== "none") {
      proxy = { level: sem.proxy_risk, note: clean(sem.proxy_risk_note) };
    } else if (st.proxy_concept) {
      proxy = {
        level: "named",
        note: `Encodes ${st.proxy_concept}; can act as a proxy for it in downstream use.`,
      };
    }

    return {
      name: c.name,
      semantic_type: sem?.semantic_type ?? null,
      collection_method: sem?.collection_method ?? null,
      raw_or_derived: st.raw_or_derived,
      derived_from: st.derived_from,
      is_design_weight: st.is_design_weight,
      // imputed-vs-reported: a verifiable schema fact (the variable's derivation),
      // distinct from the generic proxy tag. Hand 1 may name it plainly (Veritas).
      is_imputed: st.is_imputed,
      imputed_note: st.imputed_note,
      null_kinds: nullKinds,
      null_note: clean(sem?.null_semantics),
      naive_vs_valid: st.naive_vs_valid,
      // categorical code columns get a distribution, never a mean.
      categorical_distribution: st.categorical_distribution,
      structural_absence: st.structural_absence,
      proxy_risk: proxy,
      // Veritas: nothing perceivable on this column -> say so, do not invent.
      silent:
        !sem &&
        nullKinds.length === 0 &&
        !st.naive_vs_valid &&
        !st.categorical_distribution &&
        !st.structural_absence &&
        !st.is_imputed &&
        st.raw_or_derived === "raw" &&
        !st.is_design_weight &&
        !st.proxy_concept,
    };
  });

  // dataset-level structural absences (from the deterministic profiler), scrubbed
  const structuralAbsences = profile.absences
    .map((a) => clean(a.significance))
    .filter((x): x is string => !!x);

  const read = {
    filename: profile.name,
    n_rows_sampled: profile.row_count,
    n_cols: profile.variable_count,
    dataset_level: {
      grain: clean(semantic?.grain),
      dataset_class: semantic?.dataset_class ?? null,
      analytical_scope: clean(semantic?.analytical_scope),
      structural_absence: structuralAbsences,
      raw_derived_pairs: structure.raw_derived_pairs,
      design_weights: structure.design_weights,
      structural_notes: structure.notes,
      // Veritas: if the model pass produced nothing, name the silence rather than fake convergence.
      semantic_available: !!semantic,
    },
    columns,
  };

  return NextResponse.json(
    { ok: true, read },
    { headers: { "Cache-Control": "no-store" } }
  );
}
