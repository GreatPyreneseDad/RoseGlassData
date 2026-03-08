import { NextRequest } from "next/server";
import { initDB, getAnalysisWithSources } from "@/lib/db";

let dbReady = false;

async function ensureDB() {
  if (!dbReady) {
    await initDB();
    dbReady = true;
  }
}

function buildSystemPrompt(analysis: {
  topic: string;
  date: string;
  sources: Array<{
    source_name: string;
    calibration: string;
    article_text: string;
    psi: number;
    rho: number;
    q: number;
    f: number;
    tau: number;
    lambda_val: number;
    coherence: number;
  }>;
}): string {
  const sourceBlocks = analysis.sources
    .map((s) => {
      return `━━━ ${s.source_name} | ${s.calibration} ━━━
Ψ=${s.psi?.toFixed(3) ?? "?"} ρ=${s.rho?.toFixed(3) ?? "?"} q=${s.q?.toFixed(3) ?? "?"} f=${s.f?.toFixed(3) ?? "?"} τ=${s.tau?.toFixed(3) ?? "?"} λ=${s.lambda_val?.toFixed(3) ?? "?"} | Coherence=${s.coherence?.toFixed(3) ?? "?"}
${s.article_text || "(no text available)"}`;
    })
    .join("\n\n");

  return `You are Rose Glass — a translation layer between news sources and the reader.

You do not judge. You do not rank. You translate.

You have analyzed ${analysis.sources.length} sources covering "${analysis.topic}" on ${analysis.date}.

ROSE GLASS DIMENSIONS:
- Ψ (psi): internal consistency — does the source contradict itself?
- ρ (rho): accumulated wisdom — depth of knowledge referenced
- q (activation): emotional/moral charge — how much feeling is carried
- f (social): community framing — who is the "we" in this story?
- τ (tau): temporal depth — how much history is invoked
- λ (decay): narrative pressure — urgency and weight of the story

SOURCES:
${sourceBlocks}

When the user asks about the story:
- Reference specific phrases from the article text
- Explain what the dimensional scores reveal about HOW the source tells the story
- Show differences between sources as translation differences, not quality differences
- Use quotes from the actual articles to ground your observations
- Never say one source is better or worse`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { analysis_id, message, history } = body;

    console.log("[chat] analysis_id:", analysis_id);

    if (!analysis_id || !message) {
      return new Response(
        JSON.stringify({ error: "analysis_id and message are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    await ensureDB();

    const analysis = await getAnalysisWithSources(analysis_id);
    console.log("[chat] analysis found:", !!analysis);

    if (!analysis) {
      return new Response(
        JSON.stringify({ error: "Analysis not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = buildSystemPrompt(analysis);
    console.log("[chat] system prompt preview:", systemPrompt.slice(0, 200));

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Build messages (system is passed separately to Anthropic)
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
      console.error("[chat] Anthropic error:", errText);
      return new Response(
        JSON.stringify({ error: "Anthropic request failed: " + errText }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    // Stream Anthropic SSE → forward as { content } chunks to ChatPanel
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const reader = anthropicResponse.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

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
              if (!trimmed) continue;

              if (trimmed.startsWith("data: ")) {
                const data = trimmed.slice(6);
                if (data === "[DONE]") continue;

                try {
                  const parsed = JSON.parse(data);

                  // content_block_delta carries the text tokens
                  if (
                    parsed.type === "content_block_delta" &&
                    parsed.delta?.type === "text_delta" &&
                    parsed.delta?.text
                  ) {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ content: parsed.delta.text })}\n\n`
                      )
                    );
                  }

                  // message_stop signals end of stream
                  if (parsed.type === "message_stop") {
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                  }
                } catch {
                  // Skip malformed lines
                }
              }
            }
          }
        } catch (err) {
          console.error("[chat] stream error:", err);
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
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error("[chat] error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
