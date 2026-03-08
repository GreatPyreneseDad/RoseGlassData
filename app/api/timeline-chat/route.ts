import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface PoemRow {
  date: string;
  source_name: string;
  cultural_lens: string;
  poem: string;
  psi: number; rho: number; q: number;
  f: number; tau: number; lambda_val: number;
}

// ─────────────────────────────────────────────────────────
// Fetch poems
// ─────────────────────────────────────────────────────────

async function fetchPoems(topic: string, startDate: string, endDate: string): Promise<PoemRow[]> {
  try {
    const result = await getDB().query<PoemRow>(
      `SELECT a.date::text, s.source_name, s.cultural_lens, s.poem,
              s.psi, s.rho, s.q, s.f, s.tau, s.lambda_val
       FROM sources s
       JOIN analyses a ON s.analysis_id = a.id
       WHERE UPPER(a.topic) = UPPER($1)
         AND a.date BETWEEN $2::date AND $3::date
         AND s.poem IS NOT NULL
       ORDER BY a.date ASC, s.source_name ASC`,
      [topic, startDate, endDate]
    );
    return result.rows;
  } catch (err) {
    console.warn("[timeline-chat] poem fetch failed:", err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────
// Web search — factual grounding layer
// Runs on every call to anchor Claude's responses in
// verifiable facts, preventing confabulation from poems alone
// ─────────────────────────────────────────────────────────

async function fetchFactualContext(
  topic: string,
  startDate: string,
  endDate: string,
  userQuestion: string,
  apiKey: string
): Promise<string> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{
          role: "user",
          content: `Search for key facts about "${topic}" between ${startDate} and ${endDate}. Focus on: specific events, casualties, named actors, confirmed figures, major developments. The user is asking: "${userQuestion}". Return only concrete verifiable facts — dates, numbers, names, confirmed events. Be brief and specific. No analysis.`
        }]
      }),
    });

    if (!response.ok) return "";

    const data = await response.json();
    return data.content
      ?.filter((b: { type: string }) => b.type === "text")
      ?.map((b: { text: string }) => b.text)
      ?.join("\n")
      ?.trim() || "";
  } catch (err) {
    console.warn("[timeline-chat] web search failed:", err);
    return "";
  }
}

// ─────────────────────────────────────────────────────────
// Build poem section
// ─────────────────────────────────────────────────────────

function buildPoemSection(poems: PoemRow[]): string {
  if (poems.length === 0) return "";

  const byDate: Record<string, PoemRow[]> = {};
  for (const p of poems) {
    if (!byDate[p.date]) byDate[p.date] = [];
    byDate[p.date].push(p);
  }

  const lines: string[] = ["WITNESS POEMS (lens through which sources saw events):"];
  for (const date of Object.keys(byDate).sort()) {
    lines.push(`\n${date}:`);
    for (const p of byDate[date]) {
      const src = (p.source_name || "unknown").split("(")[0].trim();
      lines.push(`  [${src} | ${p.cultural_lens || "unknown"}]`);
      for (const line of p.poem.split("\n")) {
        lines.push(`    ${line}`);
      }
    }
  }
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────
// System prompt
// ─────────────────────────────────────────────────────────

function buildSystemPrompt(
  topic: string,
  startDate: string,
  endDate: string,
  timeline: Array<{
    date: string; psi: number; rho: number; q: number;
    f: number; tau: number; lambda: number;
    coherence: number; sourceCount: number;
  }>,
  poemSection: string,
  factualContext: string
): string {
  const dimRows = timeline
    .map((d) =>
      `${d.date} | Ψ=${d.psi?.toFixed(2)} ρ=${d.rho?.toFixed(2)} q=${d.q?.toFixed(2)} f=${d.f?.toFixed(2)} τ=${d.tau?.toFixed(2)} λ=${d.lambda?.toFixed(2)} | coherence=${d.coherence?.toFixed(2)} | sources=${d.sourceCount}`
    )
    .join("\n");

  const factualSection = factualContext
    ? `\nVERIFIED FACTUAL CONTEXT (web search — use this as ground truth):\n${factualContext}\n`
    : "";

  return `You are Rose Glass — a translation layer between news coverage and the reader.

You have two layers of information. Use them together:

1. FACTUAL LAYER — verified facts from web search. This is ground truth. Never contradict it.
2. LENS LAYER — witness poems showing HOW sources framed those facts through cultural lenses.

The poems compress the lens, not the facts. Do not derive factual claims from poems alone.
If a fact isn't in the factual layer, say you don't have it — do not construct it from poem imagery.
${factualSection}
${poemSection}

DIMENSIONAL SIGNAL (how sources covered it, averaged per day):
${dimRows}

ROSE GLASS DIMENSIONS:
  Ψ = internal consistency   ρ = accumulated wisdom
  q = emotional activation   f = social/tribal framing
  τ = temporal depth         λ = lens interference

TRANSLATION PROTOCOL:
- Facts come from the factual layer. Lens comes from the poems.
- Use dimensional data to explain WHY lenses frame facts the way they do.
- When lenses diverge on the same verified fact, that divergence IS the story.
- High λ = cultural interpretation gap is itself significant information.
- False positive is worse than silence. If you don't have it, say so.`;
}

// ─────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { topic, startDate, endDate, timeline, message, history } = body;

    if (!topic || !timeline || !message) {
      return new Response(
        JSON.stringify({ error: "topic, timeline, and message are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Run poems + web search in parallel
    const [poems, factualContext] = await Promise.all([
      fetchPoems(topic, startDate, endDate),
      fetchFactualContext(topic, startDate, endDate, message, apiKey),
    ]);

    const poemSection = buildPoemSection(poems);
    const systemPrompt = buildSystemPrompt(
      topic, startDate, endDate, timeline, poemSection, factualContext
    );

    const messages = [
      ...(history || []).map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
      { role: "user", content: message },
    ];

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        messages,
        stream: true,
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      return new Response(
        JSON.stringify({ error: "Anthropic request failed: " + errText }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const reader = anthropicResponse.body?.getReader();
        if (!reader) { controller.close(); return; }

        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data: ")) continue;
              const data = trimmed.slice(6);
              if (data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data);
                if (
                  parsed.type === "content_block_delta" &&
                  parsed.delta?.type === "text_delta" &&
                  parsed.delta?.text
                ) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ content: parsed.delta.text })}\n\n`)
                  );
                }
                if (parsed.type === "message_stop") {
                  controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                }
              } catch { /* skip malformed */ }
            }
          }
        } catch (err) {
          console.error("[timeline-chat] stream error:", err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
