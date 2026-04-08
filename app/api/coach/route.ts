import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { checkAuth, withTokenHeaders } from "@/lib/auth";
import type { DatasetProfile } from "@/lib/coherence-graph";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(request: NextRequest) {
  try {
    const auth = await checkAuth(request, "chat");
    if (auth instanceof NextResponse) return auth;

    const { session_id, axes } = await request.json();
    if (!session_id)
      return NextResponse.json({ error: "session_id required" }, { status: 400 });

    const db = getDB();
    const sessionRes = await db.query(
      `SELECT s.name, p.semantic_profile, p.absences, p.lens_summary
       FROM db_sessions s LEFT JOIN rg_profiles p ON p.session_id = s.id
       WHERE s.id = $1 AND (s.api_key_id = $2 OR s.api_key_id IS NULL)`,
      [session_id, auth.api_key_id]
    );
    if (sessionRes.rows.length === 0)
      return NextResponse.json({ error: "Session not found" }, { status: 404 });

    const session = sessionRes.rows[0];
    let semanticProfile: DatasetProfile | null = null;
    if (session.semantic_profile) {
      try {
        semanticProfile = typeof session.semantic_profile === "string"
          ? JSON.parse(session.semantic_profile) : session.semantic_profile;
      } catch { /* ignore */ }
    }

    if (!semanticProfile)
      return NextResponse.json(
        { error: "No semantic profile available" }, { status: 400 }
      );

    const absences = session.absences
      ? (typeof session.absences === "string"
          ? JSON.parse(session.absences) : session.absences)
      : [];

    const prompt = buildCoachPrompt(
      session.name, semanticProfile, absences, axes
    );

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    });

    const reply = response.content[0]?.type === "text"
      ? response.content[0].text : "";

    let recommendations: Array<{
      priority: string; axis: string;
      action: string; rationale: string;
    }> = [];
    try {
      const clean = reply.replace(/```json\n?|```\n?/g, "").trim();
      recommendations = JSON.parse(clean);
    } catch {
      recommendations = [{
        priority: "info", axis: "general",
        action: reply, rationale: "",
      }];
    }

    const result = NextResponse.json({
      recommendations,
      tokens_remaining: auth.tokens_remaining,
    });
    return withTokenHeaders(result, auth);

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[coach]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function buildCoachPrompt(
  name: string,
  profile: DatasetProfile,
  absences: Array<{
    domain: string; absence: string; significance: string;
  }>,
  axes?: Array<{
    label: string; key: string; score: number; explanation: string;
  }>
): string {
  const cols = profile.semantic_columns;

  const highProxy = cols
    .filter(c => c.proxy_risk === "high" || c.proxy_risk === "moderate")
    .map(c => `  ${c.column}: ${c.proxy_risk} — ${c.proxy_risk_note}`)
    .join("\n");

  const composites = cols
    .filter(c => c.semantic_type === "composite")
    .map(c => `  ${c.column}: ${c.lineage_note}`)
    .join("\n");

  const ambiguousNulls = cols
    .filter(c =>
      c.null_semantics === "ambiguous" || c.null_semantics === "suppressed"
    )
    .map(c => `  ${c.column}: ${c.null_semantics}`)
    .join("\n");

  const unclearLineage = cols
    .filter(c =>
      c.lineage_note.includes("unclear") || c.lineage_note.length < 10
    )
    .map(c => `  ${c.column}`)
    .join("\n");

  const absenceList = absences
    .map(a => `  [${a.domain}] ${a.absence}: ${a.significance}`)
    .join("\n");

  const axisScores = axes
    ?.map(a =>
      `  ${a.label}: ${Math.round(a.score * 100)}/100 — ${a.explanation}`
    )
    .join("\n") || "Not computed";

  return `You are a schema coherence coach for "${name}".

DATASET PROFILE:
Grain: ${profile.grain}
Class: ${profile.dataset_class}
Scope: ${profile.analytical_scope}
Columns: ${cols.length}

COHERENCE SCORES:
${axisScores}

PROBLEM AREAS:
${highProxy ? `Proxy risk:\n${highProxy}` : "No proxy risk issues."}
${composites ? `Composite fields:\n${composites}` : "No composites."}
${ambiguousNulls ? `Ambiguous/suppressed nulls:\n${ambiguousNulls}` : "Nulls clear."}
${unclearLineage ? `Unclear lineage:\n${unclearLineage}` : "Lineage traceable."}
${absenceList ? `Structural absences:\n${absenceList}` : "No major absences."}

Limitations: ${profile.use_limitations.join("; ")}

Generate 3-6 specific, actionable coaching recommendations.
Each must be something a data engineer or schema owner can DO.
Focus on the weakest axes first. Be specific to THIS dataset.

Respond ONLY with a JSON array:
[{
  "priority": "critical" | "important" | "suggested",
  "axis": "completeness" | "proxy_safety" | "lineage_clarity" | "null_transparency" | "referential_integrity",
  "action": "specific imperative action, one sentence",
  "rationale": "why this matters for this dataset, one sentence"
}]`;
}
