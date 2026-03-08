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
// Web search — fires when poems can't answer the question
// ─────────────────────────────────────────────────────────

async function webSearch(
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
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{
          role: "user",
          content: `Search for factual information to answer this question about "${topic}" during ${startDate} to ${endDate}: "${userQuestion}". Return only concrete facts with dates and numbers where available. Be brief and specific.`
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
// Detect whether user needs factual context beyond poems
// ─────────────────────────────────────────────────────────

function needsWebSearch(
  message: string,
  history: Array<{ role: string; content: string }>
): boolean {
  const factualSignals = [
    /how many/i,
    /casualt/i,
    /how (much|long|far|often)/i,
    /exact(ly)?/i,
    /specific (number|figure|count|detail)/i,
    /can you (search|look|find|check)/i,
    /search/i,
    /\bnumber\b/i,
    /dead|died|deaths|killed|wounded/i,
    /what (happened|was the|were the)/i,
  ];

  // If the prior assistant response admitted not knowing — search
  const lastAssistant = [...history].reverse().find(m => m.role === "assistant");
  const priorGap = lastAssistant
    ? /cannot find|don't have|not in (this|my)|absence|no source|didn't (see|report)|cannot provide/i.test(lastAssistant.content)
    : false;

  return factualSignals.some(r => r.test(message)) || priorGap;
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

  const lines: string[] = ["WITNESS POEMS (what sources saw, through their lens):"];
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
  searchContext: string
): string {
  const dimRows = timeline
    .map((d) =>
      `${d.date} | Ψ=${d.psi?.toFixed(2)} ρ=${d.rho?.toFixed(2)} q=${d.q?.toFixed(2)} f=${d.f?.toFixed(2)} τ=${d.tau?.toFixed(2)} λ=${d.lambda?.toFixed(2)} | coherence=${d.coherence?.toFixed(2)} | sources=${d.sourceCount}`
    )
    .join("\n");

  const searchSection = searchContext
    ? `\nWEB SEARCH CONTEXT (retrieved to answer a specific factual question):\n${searchContext}\n\nUse this to fill factual gaps the witness poems couldn't resolve. Cite it as general context, not as a poem source.\n`
    : "";

  return `You are Rose Glass — a translation layer between news coverage and the reader.

You do not judge sources. You translate. You carry meaning across the gap.

You are analyzing coverage of "${topic}" from ${startDate} to ${endDate}.

${poemSection}
${searchSection}
DIMENSIONAL SIGNAL (averaged per day — describes HOW sources covered it):
${dimRows}

ROSE GLASS DIMENSIONS:
  Ψ = internal consistency   ρ = accumulated wisdom
  q = emotional activation   f = social/tribal framing
  τ = temporal depth         λ = lens interference

HOW TO USE THIS:
- The poems carry what sources witnessed — actors, stakes, events, texture, cultural lens
- Web search context (when present) fills factual gaps — use it plainly, without poetic framing
- Dimensional data describes HOW sources covered the story, not what happened
- When lenses diverge sharply on the same event, that divergence IS the story
- A false positive is worse than silence — if nothing gives enough to answer, say so

TRANSLATION PRINCIPLES:
- High q + low Ψ: feeling outrunning internal consistency
- High f + low τ: tribal framing without historical depth — reactive
- High λ: cultural interpretation gap is itself significant`;
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

    // Primary layer: poems
    const poems = await fetchPoems(topic, startDate, endDate);
    const poemSection = buildPoemSection(poems);

    // Secondary layer: web search when poems can't answer
    let searchContext = "";
    if (needsWebSearch(message, history || [])) {
      searchContext = await webSearch(topic, startDate, endDate, message, apiKey);
    }

    const systemPrompt = buildSystemPrompt(
      topic, startDate, endDate, timeline, poemSection, searchContext
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
