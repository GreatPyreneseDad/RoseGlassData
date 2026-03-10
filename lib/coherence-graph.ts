// lib/coherence-graph.ts
// Seven-agent semantic profiler. Runs at ingest, once per dataset.
// Six agents each resolve one industry-standard metadata property per column.
// Seventh agent synthesizes dataset-level profile from the combined output.
//
// Output vocabulary is standard data engineering / model card practice:
// semantic type, collection method, null semantics, cardinality, proxy risk,
// referential dependencies, lineage, grain, dataset class, use limitations.
//
// Internal scoring (Ψ ρ q f τ λ) drives what each agent attends to —
// it never surfaces in outputs.

import Anthropic from "@anthropic-ai/sdk";

// ── Input ─────────────────────────────────────────────────────────────────────

export interface ColumnNode {
  name: string;
  sample_values: string[];
  null_rate: number;
  unique_count: number;
  row_count: number;
  inferred_concept: string;
}

// ── Output types — industry vocabulary ───────────────────────────────────────

export type SemanticType =
  | "identifier"       // row key, no analytical value alone
  | "categorical"      // nominal, fixed value set
  | "ordinal"          // ordered categories
  | "continuous"       // true numeric measure
  | "flag"             // boolean / binary
  | "free_text"        // unstructured narrative
  | "composite"        // encodes multiple concepts (e.g. ICD code)
  | "temporal"         // date, time, duration
  | "geographic"       // location reference
  | "derived"          // computed from other fields
  | "unknown";

export type CollectionMethod =
  | "self_reported"
  | "administratively_assigned"
  | "clinically_observed"
  | "computationally_derived"
  | "inferred"
  | "unknown";

export type NullSemantics =
  | "not_collected"    // field exists, wasn't gathered for this record
  | "not_applicable"   // field doesn't apply to this record by design
  | "unknown_value"    // value exists but wasn't captured
  | "suppressed"       // withheld — privacy, small-N, legal
  | "ambiguous";       // can't determine from context

export type CardinalityClass =
  | "binary"
  | "low"              // <20 distinct values
  | "medium"           // 20–200
  | "high"             // >200, near-unique
  | "unique";          // 1:1 with row

export type ProxyRisk = "none" | "low" | "moderate" | "high";

export type DatasetClass =
  | "administrative_record"
  | "survey"
  | "sensor_telemetry"
  | "transaction_log"
  | "derived_aggregate"
  | "research_cohort"
  | "unknown";


export interface SemanticColumn {
  column: string;
  semantic_type: SemanticType;
  collection_method: CollectionMethod;
  null_semantics: NullSemantics;
  cardinality_class: CardinalityClass;
  referential_dependencies: string[];   // columns needed to interpret this one
  proxy_risk: ProxyRisk;
  proxy_risk_note: string;              // "none" or specific risk explanation
  lineage_note: string;                 // what system/process produced this field
}

export interface DatasetProfile {
  semantic_columns: SemanticColumn[];
  grain: string;                        // what one row represents
  dataset_class: DatasetClass;
  analytical_scope: string;            // what this data can and cannot support
  use_limitations: string[];           // specific downstream constraints
}


// ── Agent 1: Semantic Type (driven by Ψ — internal consistency) ───────────────

function semanticTypePrompt(columns: ColumnNode[]): string {
  const rows = columns.map(c => {
    const s = c.sample_values.slice(0, 5).filter(Boolean).join(" | ");
    return `${c.name} [null:${Math.round(c.null_rate*100)}%, unique:${c.unique_count}/${c.row_count}]: ${s || "(empty)"}`;
  }).join("\n");
  return `You are classifying the semantic type of each column in a dataset.

Semantic types:
- identifier: row key or surrogate key — no standalone analytical value
- categorical: nominal, fixed value set (e.g. cause of death, race, state)
- ordinal: ordered categories (severity, stage, grade)
- continuous: true numeric measure (age, income, count, rate)
- flag: boolean or binary (yes/no, 0/1, true/false)
- free_text: unstructured narrative or notes
- composite: encodes multiple concepts in one field (ICD codes, FIPS codes, combined status fields)
- temporal: date, time, timestamp, duration
- geographic: location — address, zip, county, lat/lon
- derived: computed or aggregated from other fields
- unknown: genuinely cannot determine

COLUMNS:
${rows}

Respond ONLY with a JSON array. One entry per column. No explanation.
[{"column":"exact_name","semantic_type":"type"}]`;
}

// ── Agent 2: Collection Method (driven by ρ — knowledge depth) ───────────────

function collectionMethodPrompt(columns: ColumnNode[]): string {
  const rows = columns.map(c => {
    const s = c.sample_values.slice(0, 5).filter(Boolean).join(" | ");
    return `${c.name} [concept:${c.inferred_concept}]: ${s || "(empty)"}`;
  }).join("\n");
  return `You are determining how each column's values were produced.

Collection methods:
- self_reported: the subject provided their own value (intake form, survey, self-identification)
- administratively_assigned: an institution assigned it without the subject's direct input (case number, assigned status, classification)
- clinically_observed: a professional's judgment was encoded (diagnosis, cause of death, assessment score)
- computationally_derived: calculated from other fields in the same or linked dataset
- inferred: imputed, modeled, or estimated — not directly observed
- unknown: cannot determine from column name and samples

COLUMNS:
${rows}

Respond ONLY with a JSON array. One entry per column. No explanation.
[{"column":"exact_name","collection_method":"method"}]`;
}


// ── Agent 3: Null Semantics (driven by Ψ — internal consistency) ─────────────

function nullSemanticsPrompt(columns: ColumnNode[]): string {
  const rows = columns.map(c => {
    const s = c.sample_values.slice(0, 5).filter(Boolean).join(" | ");
    const nullPct = Math.round(c.null_rate * 100);
    return `${c.name} [${nullPct}% null, concept:${c.inferred_concept}]: ${s || "(empty)"}`;
  }).join("\n");
  return `You are determining what NULL means in each column. These are analytically distinct — they affect how missing values should be handled.

Null semantics:
- not_collected: field exists in schema but wasn't gathered for this record (optional field, late addition to schema)
- not_applicable: field doesn't apply to this record by design (e.g. "spouse name" for single person)
- unknown_value: value exists in reality but wasn't captured (data entry gap, lost record)
- suppressed: value was withheld — privacy rules, small-N suppression, legal hold
- ambiguous: multiple null semantics plausibly apply; cannot determine which

COLUMNS (null rate shown):
${rows}

Respond ONLY with a JSON array. One entry per column. No explanation.
[{"column":"exact_name","null_semantics":"type"}]`;
}

// ── Agent 4: Cardinality + Referential Dependencies (driven by f — social architecture) ──

function cardinalityPrompt(columns: ColumnNode[]): string {
  const names = columns.map(c => c.name);
  const rows = columns.map(c => {
    const s = c.sample_values.slice(0, 5).filter(Boolean).join(" | ");
    return `${c.name} [unique:${c.unique_count}/${c.row_count}]: ${s || "(empty)"}`;
  }).join("\n");
  return `You are assessing cardinality class and referential dependencies for each column.

Cardinality classes:
- binary: exactly 2 distinct values
- low: <20 distinct values (good for groupby, aggregation, filters)
- medium: 20–200 distinct values
- high: >200 distinct, approaching unique (bad join key candidate)
- unique: 1:1 with row count (likely an ID)

Referential dependencies: list other columns from this dataset that are REQUIRED to interpret this column meaningfully.
Example: a "rate" column depends on knowing what population it's a rate of.
Only list genuine dependencies — columns whose absence makes this column ambiguous or uninterpretable.

Available column names: ${names.join(", ")}

COLUMNS:
${rows}

Respond ONLY with a JSON array. One entry per column. No explanation.
[{"column":"exact_name","cardinality_class":"class","referential_dependencies":["col1","col2"]}]`;
}


// ── Agent 5: Proxy Risk (driven by q+λ — moral activation + lens interference) ──

function proxyRiskPrompt(columns: ColumnNode[]): string {
  const rows = columns.map(c => {
    const s = c.sample_values.slice(0, 5).filter(Boolean).join(" | ");
    return `${c.name} [concept:${c.inferred_concept}]: ${s || "(empty)"}`;
  }).join("\n");
  return `You are a fairness auditor assessing proxy risk for each column.

Proxy risk: the risk that a field correlates with protected characteristics (race, gender, national origin, disability, religion, age) and could function as a discriminatory proxy in machine learning models or statistical analysis — even if the field itself appears neutral.

Standard examples of proxy risk:
- ZIP code → racial segregation, income → moderate/high
- Surname → national origin, ethnicity → moderate/high  
- Commute time → neighborhood/race → low/moderate
- Drug type (crack vs powder cocaine) → race → high
- Cause of death categorization → socioeconomic status → low/moderate
- Self-reported race/ethnicity → direct protected attribute → high (note: not a proxy, IS the attribute)

Risk levels:
- none: no plausible correlation with protected characteristics
- low: weak or indirect correlation, unlikely to be a functional proxy
- moderate: meaningful correlation; warrants monitoring in modeling context
- high: strong correlation with protected attributes; should be excluded or carefully controlled in any predictive model

COLUMNS:
${rows}

Respond ONLY with a JSON array. Include a proxy_risk_note for moderate/high — one sentence, specific.
[{"column":"exact_name","proxy_risk":"level","proxy_risk_note":"explanation or none"}]`;
}

// ── Agent 6: Data Lineage (driven by ρ+τ — knowledge depth + temporal) ───────

function lineagePrompt(columns: ColumnNode[]): string {
  const rows = columns.map(c => {
    const s = c.sample_values.slice(0, 5).filter(Boolean).join(" | ");
    return `${c.name} [concept:${c.inferred_concept}, type:${c.inferred_concept}]: ${s || "(empty)"}`;
  }).join("\n");
  return `You are tracing the likely data lineage of each column — what institutional system, process, or decision produced this field's values.

Be specific about the production mechanism. Not "a person entered it" but "medical examiner determination at time of death certification." Not "collected at registration" but "self-reported race/ethnicity at hospital intake, categorized against OMB 1997 standards."

If the lineage is genuinely unclear, say so directly: "origin unclear from column name and samples."

COLUMNS:
${rows}

Respond ONLY with a JSON array. One sentence per column. No explanation outside JSON.
[{"column":"exact_name","lineage_note":"production mechanism"}]`;
}


// ── Agent 7: Dataset-level Synthesizer ────────────────────────────────────────

function synthesizerPrompt(
  columns: ColumnNode[],
  assembled: SemanticColumn[],
  filename: string,
  rowCount: number
): string {
  const highProxy = assembled.filter(c => c.proxy_risk === "high" || c.proxy_risk === "moderate")
    .map(c => `${c.column} (${c.proxy_risk}: ${c.proxy_risk_note})`).join("; ");
  const composites = assembled.filter(c => c.semantic_type === "composite")
    .map(c => c.column).join(", ");
  const highNull = assembled.filter(c => c.null_semantics === "suppressed" || c.null_semantics === "ambiguous")
    .map(c => c.column).join(", ");
  const derived = assembled.filter(c => c.collection_method === "computationally_derived" || c.collection_method === "inferred")
    .map(c => c.column).join(", ");

  const colSummary = assembled.map(c =>
    `${c.column}: ${c.semantic_type} | ${c.collection_method} | null=${c.null_semantics} | cardinality=${c.cardinality_class}`
  ).join("\n");

  return `You are producing the dataset-level profile for "${filename}" (${rowCount} rows, ${columns.length} columns).

You have the per-column semantic analysis. Use it.

PER-COLUMN SUMMARY:
${colSummary}

SIGNALS:
- High/moderate proxy risk columns: ${highProxy || "none identified"}
- Composite fields (encode multiple concepts): ${composites || "none"}
- Suppressed or ambiguous nulls: ${highNull || "none"}
- Derived or inferred columns: ${derived || "none"}

Produce the dataset-level profile. Be specific to THIS dataset, not generic.

Dataset classes:
- administrative_record: produced by an institutional process (court, hospital, DMV, registry)
- survey: self-reported, sampled population
- sensor_telemetry: machine-generated measurements
- transaction_log: event-driven, append-only
- derived_aggregate: rolled up or joined from more granular sources
- research_cohort: curated for a specific study or analysis
- unknown

Respond ONLY with valid JSON. No preamble.
{
  "grain": "what one row represents — be specific about the unit of observation",
  "dataset_class": "one of the classes above",
  "analytical_scope": "1-2 sentences: what analytical questions this data can support, and what it cannot",
  "use_limitations": [
    "specific limitation relevant to downstream analysis, modeling, or joining",
    "..."
  ]
}

use_limitations: 3-5 items. Specific to this dataset. No generic data quality platitudes.`;
}


// ── Response parser ───────────────────────────────────────────────────────────

function parseArray<T>(text: string): T[] {
  try {
    const clean = text.replace(/```json\n?|```\n?/g, "").trim();
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function parseObject<T>(text: string): T | null {
  try {
    const clean = text.replace(/```json\n?|```\n?/g, "").trim();
    return JSON.parse(clean) as T;
  } catch { return null; }
}

function extractText(res: Anthropic.Message): string {
  return res.content[0]?.type === "text" ? res.content[0].text : "";
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function buildCoherenceGraph(
  columns: ColumnNode[],
  filename: string
): Promise<DatasetProfile | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  // Cap at 60 columns — sufficient to read structure
  const working = columns.slice(0, 60);
  const client = new Anthropic({ apiKey });
  const model = "claude-haiku-4-5-20251001"; // agents use Haiku — fast, cheap, adequate for classification
  const synthModel = "claude-opus-4-5-20251101"; // synthesizer uses Opus — dataset-level judgment

  // Run 6 classification agents in parallel
  const [typeRes, methodRes, nullRes, cardRes, proxyRes, lineageRes] = await Promise.all([
    client.messages.create({ model, max_tokens: 2000, messages: [{ role: "user", content: semanticTypePrompt(working) }] }),
    client.messages.create({ model, max_tokens: 2000, messages: [{ role: "user", content: collectionMethodPrompt(working) }] }),
    client.messages.create({ model, max_tokens: 2000, messages: [{ role: "user", content: nullSemanticsPrompt(working) }] }),
    client.messages.create({ model, max_tokens: 3000, messages: [{ role: "user", content: cardinalityPrompt(working) }] }),
    client.messages.create({ model, max_tokens: 2000, messages: [{ role: "user", content: proxyRiskPrompt(working) }] }),
    client.messages.create({ model, max_tokens: 2000, messages: [{ role: "user", content: lineagePrompt(working) }] }),
  ]);

  type TypeRow     = { column: string; semantic_type: SemanticType };
  type MethodRow   = { column: string; collection_method: CollectionMethod };
  type NullRow     = { column: string; null_semantics: NullSemantics };
  type CardRow     = { column: string; cardinality_class: CardinalityClass; referential_dependencies: string[] };
  type ProxyRow    = { column: string; proxy_risk: ProxyRisk; proxy_risk_note: string };
  type LineageRow  = { column: string; lineage_note: string };

  const types     = parseArray<TypeRow>(extractText(typeRes));
  const methods   = parseArray<MethodRow>(extractText(methodRes));
  const nulls     = parseArray<NullRow>(extractText(nullRes));
  const cards     = parseArray<CardRow>(extractText(cardRes));
  const proxies   = parseArray<ProxyRow>(extractText(proxyRes));
  const lineages  = parseArray<LineageRow>(extractText(lineageRes));

  function find<T extends { column: string }>(arr: T[], col: string): T | undefined {
    return arr.find(x => x.column === col);
  }

  // Assemble per-column profile
  const assembled: SemanticColumn[] = working.map(c => {
    const t = find(types, c.name);
    const m = find(methods, c.name);
    const n = find(nulls, c.name);
    const k = find(cards, c.name);
    const p = find(proxies, c.name);
    const l = find(lineages, c.name);
    return {
      column: c.name,
      semantic_type:             t?.semantic_type             ?? "unknown",
      collection_method:         m?.collection_method         ?? "unknown",
      null_semantics:            n?.null_semantics            ?? "ambiguous",
      cardinality_class:         k?.cardinality_class         ?? "medium",
      referential_dependencies:  k?.referential_dependencies  ?? [],
      proxy_risk:                p?.proxy_risk                ?? "none",
      proxy_risk_note:           p?.proxy_risk_note           ?? "none",
      lineage_note:              l?.lineage_note              ?? "origin unclear",
    };
  });

  // Agent 7: synthesize dataset-level profile
  const synthRes = await client.messages.create({
    model: synthModel,
    max_tokens: 2000,
    messages: [{ role: "user", content: synthesizerPrompt(working, assembled, filename, working[0]?.row_count ?? 0) }],
  });

  const synthData = parseObject<{
    grain: string;
    dataset_class: DatasetClass;
    analytical_scope: string;
    use_limitations: string[];
  }>(extractText(synthRes));

  if (!synthData) return null;

  return {
    semantic_columns: assembled,
    grain:            synthData.grain,
    dataset_class:    synthData.dataset_class,
    analytical_scope: synthData.analytical_scope,
    use_limitations:  synthData.use_limitations ?? [],
  };
}
