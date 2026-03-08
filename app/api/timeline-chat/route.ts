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

interface SourceRow {
  source_name: string;
  url: string;
  article_text: string | null;
  date: string;
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
// Fetch source URLs + cached article text
// ─────────────────────────────────────────────────────────

async function fetchSources(topic: string, startDate: string, endDate: string): Promise<SourceRow[]> {
  try {
    const result = await getDB().query<SourceRow>(
      `SELECT s.source_name, s.url, s.article_text, a.date::text
       FROM sources s
       JOIN analyses a ON s.analysis_id = a.id
       WHERE UPPER(a.topic) = UPPER($1)
         AND a.date BETWEEN $2::date AND $3::date
         AND s.url IS NOT NULL
       ORDER BY a.date ASC
       LIMIT 20`,
      [topic, startDate, endDate]
    );
    return result.rows;
  } catch (err) {
    console.warn("[timeline-chat] source fetch failed:", err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────
// Fetch article text from URL (with timeout)
// ─────────────────────────────────────────────────────────

async function fetchArticleText(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RoseGlassBot/1.0)" },
    });
    clearTimeout(timeout);
    if (!res.ok) return "";
    const html = await res.text();
    // Strip tags, collapse whitespace, truncate
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000);
    return text;
  } catch {
    return "";
  }
}

// ─────────────────────────────────────────────────────────
// Build source fetch section for fallback
// ─────────────────────────────────────────────────────────

async function buildSourceFallback(
  sources: SourceRow[],
  limit = 5
): Promise<string> {
  if (sources.length === 0) return "";

  const results: string[] = ["RAW SOURCE TEXT (fetched from GDELT source URLs):"];
  let fetched = 0;

  for (const src of sources) {
    if (fetched >= limit) break;

    // Use cached article_text if available, otherwise fetch
    let text = src.article_text?.trim() || "";
    if (!text && src.url) {
      text = await fetchArticleText(src.url);
    }
    if (!text) continue;

    results.push(
      `\n[${src.date} | ${src.source_name}]\nURL: ${src.url}\n${text.slice(0, 2000)}`
    );
    fetched++;
  }

  if (fetched === 0) return "";
  return results.join("\n");
}

// ─────────────────────────────────────────────────────────
// Detect whether user is asking a factual question
// the poems didn't answer
// ─────────────────────────────────────────────────────────

function needsSourceFallback(message: string, history: Array<{ role: string; content: string }>): boolean {
  // User is pushing for specifics the poems didn't provide
  const specificitySignals = [
    /how many/i,
    /casualt/i,
    /exact(ly)?/i,
    /specific (number|figure|count|detail)/i,
    /can you (search|look|find|check)/i,
    /what (number|figure|count)/i,
    /dead|died|deaths|killed|wounded/i,
    /search/i,
  ];

  // Check if prior assistant turn admitted not having the answer
  const lastAssistant = [...history].reverse().find(m => m.role === "assistant");
  const assistantAdmittedGap = lastAssistant
    ? /cannot find|don't have|not in (this|my)|absence|no source|didn't (see|report)/i.test(lastAssistant.content)
    : false;

  const isSpecific = specificitySignals.some(r => r.test(message));
  return isSpecific || assistantAdmittedGap;
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
  sourceFallback: string
): string {
  const dimRows = timeline
    .map((d) =>
      `${d.date} | Ψ=${d.psi?.toFixed(2)} ρ=${d.rho?.toFixed(2)} q=${d.q?.toFixed(2)} f=${d.f?.toFixed(2)} τ=${d.tau?.toFixed(2)} λ=${d.lambda?.toFixed(2)} | coherence=${d.coherence?.toFixed(2)} | sources=${d.sourceCount}`
    )
    .join("\n");

  const sourceSection = sourceFallback
    ? `\n${sourceFallback}\n\nNOTE: The above is raw text fetched directly from the GDELT source URLs. Use it to answer specific factual questions the poems couldn't resolve. Cite the source name and date when drawing from it. This is still bounded to the same sources — just unpoemed.\n`
    : "";

  return `You are Rose Glass — a translation layer between news coverage and the reader.

You do not judge sources. You translate. You carry meaning across the gap.

You are analyzing coverage of "${topic}" from ${startDate} to ${endDate}.

${poemSection}
${sourceSection}
DIMENSIONAL SIGNAL (averaged per day — describes HOW sources covered it):
${dimRows}

ROSE GLASS DIMENSIONS:
  Ψ = internal consistency   ρ = accumulated wisdom
  q = emotional activation   f = social/tribal framing
  τ = temporal depth         λ = lens interference

HOW TO USE THIS:
- The poems carry what actually happened — actors, stakes, events, texture
- Each poem is written from inside a detected cultural lens — read as witness accounts
- Raw source text (when present) contains the unpoemed original — use for specific facts
- The dimensional data describes signal characteristics — use it to explain WHY poems feel the way they do
- When asked what happened: read across poems for that date, synthesize common facts, note lens divergence
- When lenses diverge sharply on the same event, that divergence IS the story
- A false positive is worse than silence — if neither poems nor source text give enough to answer, say so clearly

TRANSLATION PRINCIPLES:
- High q + low Ψ: feeling outrunning internal consistency
- High f + low τ: tribal framing without historical depth — reactive
- High λ: cultural interpretation gap is itself significant
- pan_islamic and western_liberal poems on the same event: read both, name the gap`;
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

    // Secondary layer: raw source text, fetched from GDELT URLs
    // Fires when user is asking for specifics the poems didn't answer
    let sourceFallback = "";
    if (needsSourceFallback(message, history || [])) {
      const sources = await fetchSources(topic, startDate, endDate);
      sourceFallback = await buildSourceFallback(sources, 5);
    }

    const systemPrompt = buildSystemPrompt(
      topic, startDate, endDate, timeline, poemSection, sourceFallback
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
