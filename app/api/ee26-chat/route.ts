// app/api/ee26-chat/route.ts
//
// PUBLIC, ephemeral chat about an EE26 schema read.
//
// Same constraints as /api/read: no account, no token decrement, nothing persisted
// or logged. The conversation lives entirely in the caller's browser session and is
// posted here each turn; the server holds no state.
//
// The assistant is Opus 4.8 carrying the Rose Glass perception posture — Two Hands
// (perceive freely, hand back the gap), Veritas (refuse the false positive), and
// translation-not-judgment — but it NEVER discloses the lens: it does not name the
// framework, its dimensions, or that it is applying any "lens" at all. It is simply a
// careful reader of this dataset's structure, grounded only in the read it was given.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-opus-4-8";

// public surface -> bound the work
const MAX_TURNS = 16; // last N messages kept
const MAX_MSG_CHARS = 4000; // per message
const RATE_PER_MIN = 20; // per IP, best-effort (resets on cold start)

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

// ---- the read shape (mirrors /api/read output; read defensively) ----
interface NullKind { code: string; kind: string; label: string; n: number }
interface ReadColumn {
  name: string;
  semantic_type: string | null;
  collection_method: string | null;
  raw_or_derived: "raw" | "derived" | null;
  derived_from: string[] | null;
  is_design_weight: boolean;
  null_kinds: NullKind[];
  null_note: string | null;
  naive_vs_valid: {
    naive_mean: number; valid_mean: number; excluded_codes: string[];
    n_valid: number; n_excluded: number;
  } | null;
  structural_absence: string | null;
  proxy_risk: { level: string; note: string | null } | null;
  silent: boolean;
}
interface ReadResult {
  filename: string;
  n_rows_sampled: number;
  n_cols: number;
  dataset_level: {
    grain: string | null;
    dataset_class: string | null;
    analytical_scope: string | null;
    structural_absence: string[];
    raw_derived_pairs: Array<{ raw: string; derived: string[] }>;
    design_weights: string[];
    structural_notes: string[];
    semantic_available: boolean;
  };
  columns: ReadColumn[];
}

// Compact the read into a grounding block. Only what was actually perceived — no
// invented values. Columns the read was silent on are summarised, not enumerated.
function summarizeRead(read: ReadResult): string {
  const dl = read.dataset_level;
  const lines: string[] = [];
  lines.push(`DATASET: ${read.filename}`);
  lines.push(`SHAPE: ${read.n_rows_sampled} rows read, ${read.n_cols} columns.`);
  if (dl.grain) lines.push(`One row represents: ${dl.grain}`);
  if (dl.dataset_class) lines.push(`Reads as: ${dl.dataset_class.replace(/_/g, " ")}`);
  if (dl.analytical_scope) lines.push(`Analytical scope: ${dl.analytical_scope}`);
  if (!dl.semantic_available) {
    lines.push(
      `NOTE: the semantic pass did not converge for this file. Only structural observations below are verified — do not infer semantic detail that is not present.`
    );
  }
  if (dl.design_weights.length) lines.push(`Design weights present: ${dl.design_weights.join(", ")} (any unweighted count or mean describes the sample, not the population).`);
  if (dl.raw_derived_pairs.length) {
    lines.push(
      `Raw -> derived dependencies: ` +
        dl.raw_derived_pairs.map((p) => `${p.raw} -> ${p.derived.join(", ")}`).join("; ")
    );
  }
  for (const n of dl.structural_notes) lines.push(`Structure: ${n}`);
  for (const a of dl.structural_absence) lines.push(`Absence: ${a}`);

  lines.push("");
  lines.push("COLUMNS (only the observed signal per column):");
  const silent: string[] = [];
  for (const c of read.columns) {
    if (c.silent) {
      silent.push(c.name);
      continue;
    }
    const parts: string[] = [];
    if (c.semantic_type) parts.push(c.semantic_type.replace(/_/g, " "));
    if (c.collection_method) parts.push(c.collection_method.replace(/_/g, " "));
    if (c.is_design_weight) parts.push("design weight");
    if (c.raw_or_derived === "derived") {
      parts.push(c.derived_from ? `derived from ${c.derived_from.join(", ")}` : "derived");
    }
    if (c.null_kinds.length) {
      parts.push(
        "nulls: " + c.null_kinds.map((k) => `${k.code}=${k.kind.replace(/_/g, " ")} (${k.n})`).join(", ")
      );
    }
    if (c.naive_vs_valid) {
      const nv = c.naive_vs_valid;
      parts.push(
        `naive mean ${nv.naive_mean} counts the reserved codes (${nv.excluded_codes.join(", ")}) as real; over the ${nv.n_valid} valid values the mean is ${nv.valid_mean}`
      );
    }
    if (c.null_note) parts.push(`null note: ${c.null_note}`);
    if (c.structural_absence) parts.push(`absence: ${c.structural_absence}`);
    if (c.proxy_risk) parts.push(`proxy risk ${c.proxy_risk.level}${c.proxy_risk.note ? ` (${c.proxy_risk.note})` : ""}`);
    lines.push(`- ${c.name}: ${parts.join("; ") || "plain column"}`);
  }
  if (silent.length) {
    lines.push(
      `- (${silent.length} columns carried no signal the read could verify: ${silent.slice(0, 30).join(", ")}${silent.length > 30 ? ", …" : ""})`
    );
  }
  return lines.join("\n");
}

const SYSTEM_POSTURE = `You are a careful reader of a single dataset, in conversation with the person who just had its structure read. You speak plainly, warmly, and concretely.

WHAT YOU TALK ABOUT
- You discuss what was perceived about THIS dataset's structure: what it tracks, what is absent, what kind of thing each null is, where a raw response carries a derived shadow column, where a count or mean would mislead, where a field could act as a proxy.
- Ground every claim in the read you were given below. Use its actual column names and numbers. Do not invent values, distributions, or columns that are not in the read.

HOW YOU HOLD THE LINE
- Translation, not judgment. You surface what is there and what is missing. You do not score, grade, rank, rate, or evaluate the dataset, and you do not tell the person what they should do, what to fix, or what to conclude. No advice, no recommendations.
- The meaning is theirs. What the read implies for their research, their decision, their next step belongs to the person, not to you. When asked "what should I do / what does this mean for my study / is this good enough," reflect what is structurally true and hand the judgment back to them — plainly, not coyly. Do not fill that space for them.
- Refuse the false positive. If the read does not establish something, say you cannot tell from what was read. "I can't verify that from the read" is a complete answer. Silence beats a confident wrong reading. Never manufacture certainty to be helpful.
- Match the temperature. Report at true temperature; do not amplify a charged framing. Calm, plain, accurate.

WHAT YOU NEVER DISCLOSE
- Do not name or describe any framework, lens, method, scoring system, or set of "dimensions" behind how you read. Do not say you are applying a lens, a perception model, or a particular methodology, and do not use proprietary jargon. If asked how you analyze or what method you use, answer simply in terms of the data's own structure — columns, codes, nulls, dependencies — without naming any system. You are just reading this dataset carefully.

Keep replies tight and specific. Prefer the concrete observation over the general statement.`;

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "anon";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: "Too many messages from this address — wait a minute." },
      { status: 429 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Chat is unavailable right now." },
      { status: 503 }
    );
  }

  let body: { read?: ReadResult; messages?: Array<{ role: string; content: string }> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const read = body.read;
  if (!read || !Array.isArray(read.columns)) {
    return NextResponse.json({ ok: false, error: "A read is required to chat about." }, { status: 400 });
  }

  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages = rawMessages
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
    )
    .slice(-MAX_TURNS)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content.slice(0, MAX_MSG_CHARS),
    }));

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ ok: false, error: "Expected a user message." }, { status: 400 });
  }

  const grounding = summarizeRead(read);

  try {
    const client = new Anthropic({ apiKey });
    const aiResponse = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      // Prompt caching: the posture + this read are stable across a conversation, so
      // cache them and pay full price only on the first turn.
      system: [
        { type: "text", text: SYSTEM_POSTURE },
        {
          type: "text",
          text: `THE READ (your only ground truth about this dataset):\n\n${grounding}`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
    });

    const reply =
      aiResponse.content[0]?.type === "text" ? aiResponse.content[0].text : "";
    return NextResponse.json(
      { ok: true, reply },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Chat could not complete.";
    console.error("[ee26-chat]", msg);
    return NextResponse.json({ ok: false, error: "Chat could not complete." }, { status: 500 });
  }
}
