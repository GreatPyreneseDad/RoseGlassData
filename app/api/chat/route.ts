import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { queryCensus, resolveStateFips, SampleResult } from "@/lib/census-sampler";
import type { DatasetProfile, SemanticColumn } from "@/lib/coherence-graph";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TOPIC_TRIGGERS: Array<{ patterns: RegExp[]; topic: string }> = [
  { patterns: [/youth.*(disconnect|not.*(work|school)|neither|rate)/i, /disconnected youth/i, /\bneet\b/i], topic: "youth_disconnected" },
  { patterns: [/poverty rate/i, /below poverty/i, /poor(est)? (county|area|place)/i], topic: "poverty_rate" },
  { patterns: [/median income/i, /household income/i, /richest.*(county|area)/i], topic: "median_income" },
  { patterns: [/wage gap/i, /earnings.*sex/i, /women.*earn/i, /gender.*pay/i], topic: "earnings_sex" },
  { patterns: [/commute/i, /travel time.*work/i, /transit.*work/i], topic: "commute_time" },
  { patterns: [/foreign.?born/i, /immigrant population/i], topic: "foreign_born" },
  { patterns: [/language.*isolat/i, /linguistically/i, /english.*ability/i], topic: "language_isolation" },
  { patterns: [/housing.*(burden|cost)/i, /rent.*income/i, /cost.burden/i], topic: "housing_cost_burden" },
];

const STATE_NAMES = [
  "alabama","alaska","arizona","arkansas","california","colorado","connecticut",
  "delaware","florida","georgia","hawaii","idaho","illinois","indiana","iowa",
  "kansas","kentucky","louisiana","maine","maryland","massachusetts","michigan",
  "minnesota","mississippi","missouri","montana","nebraska","nevada",
  "new hampshire","new jersey","new mexico","new york","north carolina",
  "north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island",
  "south carolina","south dakota","tennessee","texas","utah","vermont",
  "virginia","washington","west virginia","wisconsin","wyoming"
];

function detectTopicAndState(message: string): { topic: string | null; state: string | null } {
  let topic: string | null = null;
  for (const { patterns, topic: t } of TOPIC_TRIGGERS) {
    if (patterns.some(p => p.test(message))) { topic = t; break; }
  }
  let state: string | null = null;
  const lower = message.toLowerCase();
  for (const s of [...STATE_NAMES.filter(s => s.includes(" ")), ...STATE_NAMES.filter(s => !s.includes(" "))]) {
    if (lower.includes(s)) { state = s; break; }
  }
  return { topic, state };
}

function extractCSVSample(endpointUrl: string): { headers: string[]; rows: string[][] } | null {
  if (!endpointUrl?.startsWith("csv_data:")) return null;
  try { return JSON.parse(endpointUrl.slice("csv_data:".length)); }
  catch { return null; }
}

export async function POST(request: NextRequest) {
  try {
    const { session_id, message } = await request.json();
    if (!session_id || !message)
      return NextResponse.json({ error: "session_id and message required" }, { status: 400 });

    const db = getDB();
    const sessionRes = await db.query(
      `SELECT s.*, p.psi, p.rho, p.q, p.f, p.tau, p.lambda,
              p.absences, p.moe_coverage, p.lens_summary, p.semantic_profile
       FROM db_sessions s LEFT JOIN rg_profiles p ON p.session_id = s.id
       WHERE s.id = $1`,
      [session_id]
    );
    if (sessionRes.rows.length === 0)
      return NextResponse.json({ error: "Session not found" }, { status: 404 });

    const session = sessionRes.rows[0];

    const [conceptsRes, histRes] = await Promise.all([
      db.query(
        `SELECT concept, COUNT(*) as count, SUM(CASE WHEN has_moe THEN 1 ELSE 0 END) as moe_count
         FROM db_variables WHERE session_id = $1 GROUP BY concept ORDER BY count DESC LIMIT 40`,
        [session_id]
      ),
      db.query(
        `SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
        [session_id]
      )
    ]);

    let sampleData: SampleResult | null = null;
    let csvSample: { headers: string[]; rows: string[][] } | null = null;

    if (session.connector === "census" || !session.connector) {
      const { topic, state } = detectTopicAndState(message);
      if (topic) {
        const fips = state ? resolveStateFips(state) : undefined;
        sampleData = await queryCensus(session.dataset_id, session.vintage, topic, fips);
      }
    } else if (session.connector === "csv") {
      csvSample = extractCSVSample(session.endpoint_url);
    }

    // Parse semantic profile if present
    let semanticProfile: DatasetProfile | null = null;
    if (session.semantic_profile) {
      try { semanticProfile = typeof session.semantic_profile === "string"
        ? JSON.parse(session.semantic_profile)
        : session.semantic_profile;
      } catch { /* ignore parse failure */ }
    }

    const systemPrompt = buildSystemPrompt(session, conceptsRes.rows, sampleData, csvSample, semanticProfile);

    await db.query(
      `INSERT INTO chat_messages (session_id, role, content) VALUES ($1,$2,$3)`,
      [session_id, "user", message]
    );

    const response = await anthropic.messages.create({
      model: "claude-opus-4-5-20251101",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        ...histRes.rows.map(h => ({ role: h.role as "user" | "assistant", content: h.content })),
        { role: "user" as const, content: message }
      ],
    });

    const reply = response.content[0].type === "text" ? response.content[0].text : "";
    await db.query(
      `INSERT INTO chat_messages (session_id, role, content) VALUES ($1,$2,$3)`,
      [session_id, "assistant", reply]
    );

    return NextResponse.json({ reply });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[chat]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function buildSemanticSection(profile: DatasetProfile): string {
  if (!profile) return "";

  const highProxy = profile.semantic_columns
    .filter(c => c.proxy_risk === "high" || c.proxy_risk === "moderate")
    .map(c => `  ${c.column} (${c.proxy_risk}): ${c.proxy_risk_note}`)
    .join("\n");

  const composites = profile.semantic_columns
    .filter(c => c.semantic_type === "composite")
    .map(c => `  ${c.column}: ${c.lineage_note}`)
    .join("\n");

  const suppressed = profile.semantic_columns
    .filter(c => c.null_semantics === "suppressed" || c.null_semantics === "ambiguous")
    .map(c => `  ${c.column} (${c.null_semantics})`)
    .join("\n");

  const limitations = profile.use_limitations.map(l => `  - ${l}`).join("\n");

  return `
SEMANTIC PROFILE (produced by pre-processing analysis):
Grain: ${profile.grain}
Dataset class: ${profile.dataset_class}
Analytical scope: ${profile.analytical_scope}

Use limitations:
${limitations}
${highProxy ? `\nProxy risk (moderate/high — relevant for any modeling or scoring use):\n${highProxy}` : ""}
${composites ? `\nComposite fields (encode multiple concepts — interpret carefully):\n${composites}` : ""}
${suppressed ? `\nSuppressed or ambiguous nulls (do not treat as "not applicable"):\n${suppressed}` : ""}`;
}

function buildSystemPrompt(
  session: Record<string, unknown>,
  concepts: Array<{ concept: string; count: string; moe_count: string }>,
  sampleData: SampleResult | null,
  csvSample: { headers: string[]; rows: string[][] } | null,
  semanticProfile: DatasetProfile | null
): string {
  const absences = (session.absences as Array<{ domain: string; absence: string; significance: string }>) || [];
  const topConcepts = concepts.slice(0, 20).map(c => `  ${c.concept} (${c.count} variables)`).join("\n");
  const absenceList = absences.map(a => `  [${a.domain}] ${a.absence}: ${a.significance}`).join("\n");

  const psi = Number(session.psi) || 0.5;
  const q = Number(session.q) || 0.5;
  const f = Number(session.f) || 0.5;
  const tau = Number(session.tau) || 0.5;
  const lambda = Number(session.lambda) || 0.5;
  const moe = Number(session.moe_coverage) || 0;
  const connector = (session.connector as string) || "census";

  let dataSection = "";

  if (sampleData?.rows.length) {
    const rowSummary = sampleData.rows.map(r => {
      const name = r["NAME"] || "?";
      const rate = r["_rate"] ? `${r["_rate"]}` : "";
      const count = r["_neet_count"] ? ` (${r["_neet_count"]} youth)` : "";
      const total = sampleData.variables[0] && r[sampleData.variables[0]]
        ? ` of ${r[sampleData.variables[0]]} total` : "";
      return `  ${name}: ${rate}${count}${total}`;
    }).join("\n");
    dataSection = `\nLIVE DATA — USE THESE EXACT VALUES:\n${sampleData.query_description}\n${sampleData.note ? `(${sampleData.note})` : ""}\n${rowSummary}\n\nDo not hedge. Do not approximate. Use what is above.\n`;
  }

  if (csvSample?.headers.length) {
    const header = csvSample.headers.join(" | ");
    const sampleRows = csvSample.rows.slice(0, 10)
      .map(r => r.map((v, i) => csvSample.headers[i] ? `${csvSample.headers[i]}: ${v}` : v).join(", "))
      .join("\n  ");
    dataSection = `\nSAMPLE DATA (first 10 rows of ${session.name}):\nColumns: ${header}\n\n  ${sampleRows}\n\nReason directly from these values when answering questions about the data.\n`;
  }

  const connectorNote = connector === "csv"
    ? "User-uploaded CSV file."
    : connector === "postgres"
    ? "User-connected PostgreSQL database. Schema only — live queries require database access."
    : "US Census Bureau public API dataset.";

  const semanticSection = semanticProfile ? buildSemanticSection(semanticProfile) : "";

  return `You are a data intelligence analyst. You have read this dataset completely.

DATASET: ${session.name}
SOURCE: ${connector.toUpperCase()} — ${connectorNote}
VARIABLES: ${session.variable_count} across ${session.concept_count} concept domains
${connector === "census" ? `GEOGRAPHIES: ${(session.geography_depth as string[] || []).join(", ")}` : ""}

CONCEPT DOMAINS:
${topConcepts}

STRUCTURAL GAPS:
${absenceList}

BUILDER'S LENS:
${session.lens_summary}
${semanticSection}
${dataSection}
READING POSTURE — internalize, never surface:
${psi > 0.7 ? "- Internal structure is coherent." : "- Internal gaps present — cross-referencing requires care."}
${q > 0.6 ? "- Contested categories present. Name the contestedness when it matters." : "- Categories appear neutral — look for what has been naturalized."}
${lambda > 0.6 ? "- Measurer's assumptions are deep in the structure." : "- Moderate interpretive load."}
${tau > 0.7 ? "- Temporal depth available — trend claims are supportable." : "- Limited temporal depth — be careful with trends."}
${f < 0.5 ? "- Aggregate unit of analysis — individual experience is flattened." : "- Individual-level resolution available."}
${moe > 60 ? `- ${moe}% uncertainty documented.` : `- Only ${moe}% uncertainty documented — confidence intervals largely absent.`}

PRINCIPLES:
- When you have actual data, use it. Specific values. Named rows. No approximation.
- Surface what is there and what is absent. Translation, not judgment.
- Proxy risk fields: name the risk when a user is considering modeling or scoring use.
- If something isn't in the profile, say so. Don't construct from silence.
- Plain language. No academic hedging.
- False confidence is worse than acknowledged uncertainty.`;
}
