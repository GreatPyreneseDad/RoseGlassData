import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { queryCensus, resolveStateFips, SampleResult } from "@/lib/census-sampler";

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
  const twoWord = STATE_NAMES.filter(s => s.includes(" "));
  const oneWord = STATE_NAMES.filter(s => !s.includes(" "));
  for (const s of [...twoWord, ...oneWord]) {
    if (lower.includes(s)) { state = s; break; }
  }
  return { topic, state };
}

// Extract CSV sample data from endpoint_url for non-census sessions
function extractCSVSample(endpointUrl: string): { headers: string[]; rows: string[][] } | null {
  if (!endpointUrl?.startsWith("csv_data:")) return null;
  try {
    const json = endpointUrl.slice("csv_data:".length);
    return JSON.parse(json);
  } catch { return null; }
}

export async function POST(request: NextRequest) {
  try {
    const { session_id, message } = await request.json();
    if (!session_id || !message) {
      return NextResponse.json({ error: "session_id and message required" }, { status: 400 });
    }

    const db = getDB();
    const sessionRes = await db.query(
      `SELECT s.*, p.psi, p.rho, p.q, p.f, p.tau, p.lambda,
              p.absences, p.moe_coverage, p.lens_summary
       FROM db_sessions s LEFT JOIN rg_profiles p ON p.session_id = s.id
       WHERE s.id = $1`,
      [session_id]
    );
    if (sessionRes.rows.length === 0) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
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

    // Branch: Census gets live API queries; CSV/Postgres gets sample data from session
    let sampleData: SampleResult | null = null;
    let csvSample: { headers: string[]; rows: string[][] } | null = null;

    if (session.connector === "census" || !session.connector) {
      const { topic: detectedTopic, state: detectedState } = detectTopicAndState(message);
      if (detectedTopic) {
        const stateFips = detectedState ? resolveStateFips(detectedState) : undefined;
        sampleData = await queryCensus(session.dataset_id, session.vintage, detectedTopic, stateFips);
      }
    } else if (session.connector === "csv") {
      csvSample = extractCSVSample(session.endpoint_url);
    }

    const systemPrompt = buildSystemPrompt(session, conceptsRes.rows, sampleData, csvSample);

    await db.query(
      `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, $2, $3)`,
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
      `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, $2, $3)`,
      [session_id, "assistant", reply]
    );

    return NextResponse.json({ reply });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[chat]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function buildSystemPrompt(
  session: Record<string, unknown>,
  concepts: Array<{ concept: string; count: string; moe_count: string }>,
  sampleData: SampleResult | null,
  csvSample: { headers: string[]; rows: string[][] } | null
): string {
  const absences = (session.absences as Array<{ domain: string; absence: string; significance: string }>) || [];
  const topConcepts = concepts.slice(0, 20)
    .map(c => `  ${c.concept} (${c.count} variables)`)
    .join("\n");
  const absenceList = absences
    .map(a => `  [${a.domain}] ${a.absence}: ${a.significance}`)
    .join("\n");

  const psi = Number(session.psi) || 0.5;
  const q = Number(session.q) || 0.5;
  const f = Number(session.f) || 0.5;
  const tau = Number(session.tau) || 0.5;
  const lambda = Number(session.lambda) || 0.5;
  const moe = Number(session.moe_coverage) || 0;
  const connector = (session.connector as string) || "census";

  let dataSection = "";

  if (sampleData && sampleData.rows.length > 0) {
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

  if (csvSample && csvSample.headers.length > 0) {
    const header = csvSample.headers.join(" | ");
    const sampleRows = csvSample.rows.slice(0, 10)
      .map(r => r.map((v, i) => csvSample.headers[i] ? `${csvSample.headers[i]}: ${v}` : v).join(", "))
      .join("\n  ");
    dataSection = `\nSAMPLE DATA (first 10 rows of ${session.name}):\nColumns: ${header}\n\n  ${sampleRows}\n\nYou can reason directly from these values. When the user asks a question answerable from the data, use it.\n`;
  }

  const connectorNote = connector === "csv"
    ? "This is a user-uploaded CSV file. You have access to sample data above."
    : connector === "postgres"
    ? "This is a user-connected PostgreSQL database. You see the schema structure; live queries would require database access."
    : "This is a US Census Bureau public API dataset.";

  return `You are a Rose Glass intelligence analyst embedded in this dataset. You have read its complete structure.

DATASET: ${session.name}
CONNECTOR: ${connector.toUpperCase()} — ${connectorNote}
VARIABLES: ${session.variable_count} across ${session.concept_count} concept domains
${connector === "census" ? `GEOGRAPHIES: ${(session.geography_depth as string[] || []).join(", ")}` : ""}

WHAT THIS DATA MEASURES:
${topConcepts}

WHAT IT DOES NOT MEASURE:
${absenceList}

HOW IT WAS BUILT:
${session.lens_summary}
${dataSection}
YOUR READING POSTURE — internalize, never quote:
${psi > 0.7 ? "- Framework is internally coherent." : "- Framework has internal gaps. Be careful about cross-referencing."}
${q > 0.6 ? "- Contested categories present. Name the contestedness when relevant." : "- Categories appear neutral. Look for what has been naturalized."}
${lambda > 0.6 ? "- High worldview interference: the measurer's assumptions are baked deep into the structure." : "- Moderate worldview interference."}
${tau > 0.7 ? "- Meaningful temporal depth. You can speak to trends." : "- Limited temporal depth. Be careful about trend claims."}
${f < 0.5 ? "- Household or aggregate is the unit. Individual experience is flattened." : "- Individual-level data available."}
${moe > 60 ? `- ${moe}% error margin coverage.` : `- Only ${moe}% error margin coverage — uncertainty is largely undocumented.`}

PRINCIPLES:
- When you have actual data above, use it. Specific values. Named rows. No approximation.
- Translation, not judgment. Surface what is there and what is absent.
- If something is not in the profile or sample, say so. Don't construct from silence.
- Never mention Rose Glass, dimensional scores, or framework names.
- Plain language. No academic hedging. No "it is important to note."
- False confidence is worse than acknowledged uncertainty.`;
}
