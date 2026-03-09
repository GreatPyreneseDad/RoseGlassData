import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { SampleResult } from "../sample/route";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Keyword → Census topic mapping for live data injection
const TOPIC_TRIGGERS: Array<{ patterns: RegExp[]; topic: string }> = [
  { patterns: [/youth.*(disconnect|not.*(work|school)|neither)/i, /disconnected youth/i], topic: "youth_disconnected" },
  { patterns: [/poverty rate/i, /below poverty/i, /poor(est)? (county|area|place)/i], topic: "poverty_rate" },
  { patterns: [/median income/i, /household income/i, /richest.*(county|area)/i], topic: "median_income" },
  { patterns: [/wage gap/i, /earnings.*sex/i, /women.*earn/i, /gender.*pay/i], topic: "earnings_sex" },
  { patterns: [/commute/i, /travel time.*work/i, /transit.*work/i], topic: "commute_time" },
  { patterns: [/foreign.?born/i, /immigrant population/i, /immigration/i], topic: "foreign_born" },
  { patterns: [/language.*isolat/i, /linguistically/i, /english.*ability/i], topic: "language_isolation" },
  { patterns: [/housing.*(burden|cost)/i, /rent.*income/i, /cost.burden/i], topic: "housing_cost_burden" },
];

function detectTopic(message: string): string | null {
  for (const { patterns, topic } of TOPIC_TRIGGERS) {
    if (patterns.some(p => p.test(message))) return topic;
  }
  return null;
}

async function fetchSample(
  dataset_id: string,
  vintage: number,
  topic: string
): Promise<SampleResult | null> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/sample`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id, vintage, topic }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
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
       FROM db_sessions s
       LEFT JOIN rg_profiles p ON p.session_id = s.id
       WHERE s.id = $1`,
      [session_id]
    );
    if (sessionRes.rows.length === 0) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const session = sessionRes.rows[0];

    const conceptsRes = await db.query(
      `SELECT concept, COUNT(*) as count,
              SUM(CASE WHEN has_moe THEN 1 ELSE 0 END) as moe_count
       FROM db_variables WHERE session_id = $1
       GROUP BY concept ORDER BY count DESC LIMIT 40`,
      [session_id]
    );

    const histRes = await db.query(
      `SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
      [session_id]
    );

    // Detect if this question can be grounded with actual data
    const detectedTopic = detectTopic(message);
    let sampleData: SampleResult | null = null;
    if (detectedTopic) {
      sampleData = await fetchSample(session.dataset_id, session.vintage, detectedTopic);
    }

    const systemPrompt = buildSystemPrompt(session, conceptsRes.rows, sampleData);

    await db.query(
      `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, $2, $3)`,
      [session_id, "user", message]
    );

    const history = histRes.rows;
    const messages = [
      ...history.map(h => ({ role: h.role as "user" | "assistant", content: h.content })),
      { role: "user" as const, content: message }
    ];

    const response = await anthropic.messages.create({
      model: "claude-opus-4-5-20251101",
      max_tokens: 1024,
      system: systemPrompt,
      messages,
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
  sampleData: SampleResult | null
): string {
  const absences = (session.absences as Array<{ domain: string; absence: string; significance: string }>) || [];
  const topConcepts = concepts.slice(0, 20)
    .map(c => `  ${c.concept} (${c.count} variables, ${c.moe_count} with error margins)`)
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

  let dataSection = "";
  if (sampleData) {
    const rowSummary = sampleData.rows.slice(0, 20).map(r => {
      const name = r["NAME"] || r["state"] || r["county"] || "?";
      const vals = sampleData.variables
        .map(v => `${v}: ${r[v] ?? "N/A"}`)
        .join(", ");
      return `  ${name}: ${vals}`;
    }).join("\n");

    dataSection = `
LIVE DATA — USE THESE ACTUAL VALUES IN YOUR RESPONSE:
Query: ${sampleData.query_description}
${sampleData.note ? `Note: ${sampleData.note}` : ""}
${rowSummary}

These are real numbers from the Census API for this dataset. Cite them specifically. Do not approximate or generalize when you have actual figures.`;
  }

  return `You are a Rose Glass intelligence analyst embedded in this dataset. You have read its complete structure.

DATASET: ${session.name}
SOURCE: ${session.dataset_id} vintage ${session.vintage}
VARIABLES: ${session.variable_count} across ${session.concept_count} concept domains
GEOGRAPHIES: ${(session.geography_depth as string[] || []).join(", ")}

WHAT THIS DATA MEASURES:
${topConcepts}

WHAT IT DOES NOT MEASURE:
${absenceList}

HOW IT WAS BUILT:
${session.lens_summary}
${dataSection}
YOUR READING POSTURE — internalize, never quote:
${psi > 0.7 ? "- The framework is internally coherent. Cross-references between concepts are reliable." : "- The framework has internal gaps. Variables don't always connect as cleanly as they appear."}
${q > 0.6 ? "- This data touches contested categories. Name the contestedness when it's relevant." : "- The categories appear neutral. Look for what's been naturalized."}
${lambda > 0.6 ? "- High worldview interference: the measurer's assumptions are baked deep into the structure." : "- Moderate worldview interference: some assumptions embedded, but relatively transparent."}
${tau > 0.7 ? "- Meaningful temporal depth. You can speak to trends." : "- Limited temporal depth. Be careful about trend claims."}
${f < 0.5 ? "- The household is the unit of analysis. People who don't fit that mold are systematically undercounted." : "- Individual-level data is available, though household proxies still dominate."}
${moe > 60 ? `- ${moe}% MOE coverage — well-documented uncertainty.` : `- Only ${moe}% MOE coverage — much uncertainty is undocumented.`}

PRINCIPLES:
- Translation, not judgment. Surface what's there and what's absent without editorializing.
- Be specific. When you have actual data, use it. Named counties, real numbers.
- If something is absent from the profile, say so — don't construct meaning from silence.
- Never mention Rose Glass, dimensional scores, or framework names. Just speak.
- Plain language. No academic hedging. No "it is important to note."
- False confidence is worse than acknowledged uncertainty.`;
}
