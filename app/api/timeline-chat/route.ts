import { NextRequest } from "next/server";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://localhost/rose_glass_news", ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false, checkServerIdentity: () => undefined } : false });

// ─────────────────────────────────────────────────────────
// Fetch poems from DB for topic + date range
// ─────────────────────────────────────────────────────────

interface PoemRow {
  date: string;
  source_name: string;
  cultural_lens: string;
  poem: string;
  psi: number; rho: number; q: number;
  f: number; tau: number; lambda_val: number;
}

async function fetchPoems(topic: string, startDate: string, endDate: string): Promise<PoemRow[]> {
  try {
    const result = await pool.query<PoemRow>(
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
// Build poem section grouped by date
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
// Web search fallback (fires only when no poems exist)
// ─────────────────────────────────────────────────────────

async function fetchRecentNews(topic: string, startDate: string, endDate: string, apiKey: string): Promise<string> {
  try {
    const searchResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{
          role: "user",
          content: `Search for the most significant news events about "${topic}" between ${startDate} and ${endDate}. Return a concise factual summary of key events per date. Be specific about dates. 3-5 sentences max per day that had notable events.`
        }]
      }),
    });
    if (!searchResponse.ok) return "";
    const data = await searchResponse.json();
    return data.content
      ?.filter((b: { type: string }) => b.type === "text")
      ?.map((b: { text: string }) => b.text)
      ?.join("\n") || "";
  } catch {
    return "";
  }
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
  fallbackNews: string
): string {
  const dimRows = timeline
    .map((d) =>
      `${d.date} | Ψ=${d.psi?.toFixed(2)} ρ=${d.rho?.toFixed(2)} q=${d.q?.toFixed(2)} f=${d.f?.toFixed(2)} τ=${d.tau?.toFixed(2)} λ=${d.lambda?.toFixed(2)} | coherence=${d.coherence?.toFixed(2)} | sources=${d.sourceCount}`
    )
    .join("\n");

  const fallbackSection = fallbackNews
    ? `\nACTUAL EVENTS (web search fallback):\n${fallbackNews}\n`
    : "";

  return `You are Rose Glass — a translation layer between news coverage and the reader.

You do not judge sources. You translate. You carry meaning across the gap.

You are analyzing coverage of "${topic}" from ${startDate} to ${endDate}.

${poemSection}
${fallbackSection}
DIMENSIONAL SIGNAL (averaged per day — describes HOW sources covered it):
${dimRows}

ROSE GLASS DIMENSIONS:
  Ψ = internal consistency   ρ = accumulated wisdom
  q = emotional activation   f = social/tribal framing
  τ = temporal depth         λ = lens interference

HOW TO USE THIS:
- The poems carry what actually happened — actors, stakes, events, texture
- Each poem is written from inside a detected cultural lens — read as witness accounts
- The dimensional data describes signal characteristics — use it to explain WHY poems feel the way they do
- When asked what happened: read across poems for that date, synthesize common facts, note lens divergence
- When lenses diverge sharply on the same event, that divergence IS the story
- A false positive is worse than silence — if poems don't give enough to answer, say so

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

    // Fetch poems from DB — primary content layer
    const poems = await fetchPoems(topic, startDate, endDate);
    const poemSection = buildPoemSection(poems);

    // Web search fallback only if no poems AND user asking about events
    const eventKeywords = /what happened|actual events|specific|news|report|tell me|describe|summarize/i;
    const needsFallback = poems.length === 0 && eventKeywords.test(message) && history.length <= 2;
    const fallbackNews = needsFallback
      ? await fetchRecentNews(topic, startDate, endDate, apiKey)
      : "";

    const systemPrompt = buildSystemPrompt(
      topic, startDate, endDate, timeline, poemSection, fallbackNews
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
