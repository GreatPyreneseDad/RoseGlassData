// lib/column-translator.ts
// Semantic column profiling agent — runs at ingest, once per dataset.
// Produces industry-standard metadata that deepens chat LLM perception of the dataset.
// Vocabulary: data lineage, semantic typing, null semantics, proxy risk, grain, cardinality.

import Anthropic from "@anthropic-ai/sdk";

export interface SemanticColumn {
  column: string;

  // What kind of field this is operationally
  semantic_type:
    | "identifier"        // row-level key, no analytical value alone
    | "categorical"       // fixed set of values, nominal
    | "ordinal"           // ordered categories (severity, stage, tier)
    | "continuous"        // true numeric measure
    | "flag"              // boolean or binary indicator
    | "free_text"         // unstructured narrative
    | "composite"         // encodes multiple concepts (e.g. ICD code = diagnosis + system)
    | "temporal"          // date, time, or duration
    | "geographic"        // location reference
    | "derived"           // computed from other fields
    | "unknown";

  // How the value was produced
  collection_method:
    | "self_reported"     // subject provided their own value
    | "administratively_assigned"  // institution assigned it (not subject input)
    | "clinically_observed"        // professional judgment encoded
    | "computationally_derived"    // calculated from other fields
    | "inferred"          // imputed or modeled
    | "unknown";

  // What null means in this field — these are analytically distinct
  null_semantics:
    | "not_collected"     // field exists but wasn't gathered for this record
    | "not_applicable"    // field doesn't apply to this record by design
    | "unknown"           // value exists but wasn't captured
    | "suppressed"        // value withheld (privacy, small-N)
    | "ambiguous";        // can't determine from context

  // Cardinality and join implications
  cardinality_class:
    | "binary"            // 2 values
    | "low"               // <20 distinct values
    | "medium"            // 20–200 distinct values
    | "high"              // >200 distinct values, near-unique
    | "unique";           // 1:1 with row (ID-like)

  // Which other columns this field depends on for meaningful interpretation
  referential_dependencies: string[];

  // Proxy risk: does this field correlate with protected attributes
  // and risk functioning as a discriminatory proxy in modeling?
  proxy_risk: "none" | "low" | "moderate" | "high";
  proxy_risk_note: string;  // explain the risk, or "none" if not applicable

  // Data lineage note: what system, process, or decision produced this field
  lineage_note: string;
}

export interface DatasetProfile {
  semantic_columns: SemanticColumn[];

  // Row-level grain: what real-world entity does one record represent?
  grain: string;

  // Dataset class
  dataset_class:
    | "administrative_record"   // produced by institutional process (court, hospital, DMV)
    | "survey"                  // self-reported, sampled
    | "sensor_telemetry"        // machine-generated measurements
    | "transaction_log"         // event-driven, append-only
    | "derived_aggregate"       // rolled up from a more granular source
    | "research_cohort"         // curated for a specific study
    | "unknown";

  // Structural completeness note — what the column set can and cannot support analytically
  analytical_scope: string;

  // Key limitations for downstream use: joins, modeling, aggregation
  use_limitations: string[];
}

export async function translateColumns(
  columns: Array<{ name: string; concept: string; sample_values: string[]; null_rate: number; unique_count: number; predicate_type: string }>,
  filename: string,
  rowCount: number
): Promise<DatasetProfile | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const sample = columns.slice(0, 60);

  const columnBlock = sample.map(c => {
    const samples = c.sample_values.slice(0, 5).filter(Boolean).join(" | ");
    const nullPct = Math.round(c.null_rate * 100);
    const cardNote = c.unique_count > rowCount * 0.8 ? "near-unique" : c.unique_count < 5 ? `${c.unique_count} distinct` : `${c.unique_count} distinct`;
    return `${c.name} [null:${nullPct}%, cardinality:${cardNote}, type:${c.predicate_type}]: ${samples || "(no sample)"}`;
  }).join("\n");

  const prompt = `You are a senior data engineer performing semantic profiling on a dataset.

Dataset: "${filename}"
Row count: ${rowCount}
Columns: ${columns.length}

COLUMN INVENTORY (name [null%, cardinality, inferred type]: sample values):
${columnBlock}

Your job: produce a structured semantic profile that a data engineer or analyst would use to understand this dataset before working with it. Focus on operational reality — what these fields actually are, how they were likely produced, what their analytical limitations are, and where proxy risk exists for downstream modeling.

Respond ONLY with valid JSON. No preamble, no markdown fences.

{
  "grain": "what one row represents — be specific",
  "dataset_class": "administrative_record | survey | sensor_telemetry | transaction_log | derived_aggregate | research_cohort | unknown",
  "analytical_scope": "1-2 sentences: what analytical questions this dataset can and cannot support",
  "use_limitations": ["specific limitation 1", "specific limitation 2", "..."],
  "semantic_columns": [
    {
      "column": "exact column name",
      "semantic_type": "identifier | categorical | ordinal | continuous | flag | free_text | composite | temporal | geographic | derived | unknown",
      "collection_method": "self_reported | administratively_assigned | clinically_observed | computationally_derived | inferred | unknown",
      "null_semantics": "not_collected | not_applicable | unknown | suppressed | ambiguous",
      "cardinality_class": "binary | low | medium | high | unique",
      "referential_dependencies": ["other_column_name"],
      "proxy_risk": "none | low | moderate | high",
      "proxy_risk_note": "explain the risk if moderate/high, or 'none' if not applicable",
      "lineage_note": "what system, process, or decision likely produced this field"
    }
  ]
}

Rules:
- Skip pure row-index columns (unnamed first column, sequential integers with no semantic value).
- referential_dependencies: only list columns that are genuinely needed to interpret this one.
- proxy_risk: flag fields that correlate with protected characteristics (race, gender, disability, zip code as income proxy, etc.) and could function as discriminatory proxies in ML models. This is standard fair lending / model card practice — be direct.
- lineage_note should reflect what institutional system likely produced the value (e.g. "medical examiner determination at time of certification", "self-reported at intake", "derived from timestamp delta").
- use_limitations should be specific to this dataset — not generic caveats.
- Be precise. No hedging. If something is ambiguous, name the ambiguity specifically.`;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-opus-4-5-20251101",
      max_tokens: 5000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const clean = text.replace(/```json\n?|```\n?/g, "").trim();
    const parsed = JSON.parse(clean) as DatasetProfile;

    if (!parsed.semantic_columns || !Array.isArray(parsed.semantic_columns)) return null;
    if (!parsed.grain || !parsed.dataset_class) return null;

    return parsed;
  } catch (err) {
    console.error("[column-translator] failed:", err);
    return null;
  }
}
