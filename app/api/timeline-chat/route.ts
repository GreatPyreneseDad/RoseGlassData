import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";

interface SourceRow {
  date: string; source_name: string; source_type: string;
  calibration: string | null; url: string | null;
  cultural_lens: string | null; poem: string | null;
  veritas_score: number | null; veritas_assessment: string | null;
  psi: number; rho: number; q: number; f: number; tau: number;
  lambda_val: number; coherence: number;
}
interface DivergenceRow {
  dimension: string; mean_val: number; std_dev: number; variance: number;
}
interface DomainConfig {
  id: string; name: string; entity_label: string; domain_question: string;
  connector: string; search_context: string | null; deployment_tier: string;
}

async function fetchSourceData(topic: string, startDate: string, endDate: string): Promise<SourceRow[]> {
  try {
    const result = await getDB().query<SourceRow>(
      `SELECT a.date::text, s.source_name, s.source_type, s.calibration, s.url,
              s.cultural_lens, s.poem, s.veritas_score, s.veritas_assessment,
              s.psi, s.rho, s.q, s.f, s.tau, s.lambda_val, s.coherence
       FROM sources s
       JOIN analyses a ON s.analysis_id = a.id
       JOIN entity_nodes n ON n.id = a.entity_node_id
       WHERE UPPER(n.label) = UPPER($1) AND a.date BETWEEN $2::date AND $3::date
       ORDER BY a.date ASC, s.coherence DESC NULLS LAST`,
      [topic, startDate, endDate]
    );
    return result.rows;
  } catch (err) { console.warn("[timeline-chat] source fetch failed:", err); return []; }
}

async function fetchDivergence(topic: string, startDate: string, endDate: string): Promise<DivergenceRow[]> {
  try {
    const result = await getDB().query<DivergenceRow>(
      `SELECT d.dimension,
              ROUND(AVG(d.mean_val)::numeric,3)::float AS mean_val,
              ROUND(AVG(d.std_dev)::numeric,3)::float AS std_dev,
              ROUND(AVG(d.variance)::numeric,3)::float AS variance
       FROM divergence d
       JOIN analyses a ON d.analysis_id = a.id
       JOIN entity_nodes n ON n.id = a.entity_node_id
       WHERE UPPER(n.label) = UPPER($1) AND a.date BETWEEN $2::date AND $3::date
       GROUP BY d.dimension ORDER BY AVG(d.std_dev) DESC`,
      [topic, startDate, endDate]
    );
    return result.rows;
  } catch (err) { console.warn("[timeline-chat] divergence fetch failed:", err); return []; }
}

async function fetchFactualContext(topic: string, startDate: string, endDate: string, userQuestion: string, apiKey: string, connector: string): Promise<string> {
  if (connector !== "gdelt" && connector !== "news") return "";
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-beta": "web-search-2025-03-05" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", max_tokens: 800,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: `Search for key facts about "${topic}" between ${startDate} and ${endDate}. User is asking: "${userQuestion}". Return only concrete verifiable facts — dates, numbers, names, confirmed events. Be brief.` }]
      }),
    });
    if (!response.ok) return "";
    const data = await response.json();
    return data.content?.filter((b: {type:string}) => b.type==="text")?.map((b: {text:string}) => b.text)?.join("\n")?.trim() || "";
  } catch (err) { console.warn("[timeline-chat] web search failed:", err); return ""; }
}

function buildContextBlock(
  sources: SourceRow[],
  divergence: DivergenceRow[],
  timeline: Array<{date:string;psi:number;rho:number;q:number;f:number;tau:number;lambda:number;coherence:number;sourceCount:number}>
): string {
  const lines: string[] = [];
  lines.push("DIMENSIONAL TIMELINE (aggregate per date):");
  lines.push("date       | Ψ     ρ     q     f     τ     λ     | coherence | n");
  for (const d of timeline) {
    lines.push(`${d.date} | ${d.psi?.toFixed(2)} ${d.rho?.toFixed(2)} ${d.q?.toFixed(2)} ${d.f?.toFixed(2)} ${d.tau?.toFixed(2)} ${d.lambda?.toFixed(2)} | ${d.coherence?.toFixed(2)} | ${d.sourceCount}`);
  }
  if (divergence.length > 0) {
    lines.push("
DIVERGENCE (where sources disagreed most):");
    lines.push("dimension | mean  | std_dev | variance");
    for (const d of divergence) {
      lines.push(`${d.dimension.padEnd(10)} | ${d.mean_val?.toFixed(3)} | ${d.std_dev?.toFixed(3)}   | ${d.variance?.toFixed(3)}`);
    }
  }
  if (sources.length > 0) {
    lines.push("
SOURCE DETAIL:");
    const byDate: Record<string,SourceRow[]> = {};
    for (const s of sources) { if (!byDate[s.date]) byDate[s.date]=[]; byDate[s.date].push(s); }
    for (const date of Object.keys(byDate).sort()) {
      lines.push(`
${date}:`);
      for (const s of byDate[date]) {
        const name = (s.source_name||"unknown").split("(")[0].trim();
        const lens = s.cultural_lens||"unclassified";
        const cal = s.calibration ? ` | calibration: ${s.calibration}` : "";
        lines.push(`  [${name} | ${lens} | Ψ=${s.psi?.toFixed(2)} q=${s.q?.toFixed(2)} λ=${s.lambda_val?.toFixed(2)} | coherence=${s.coherence?.toFixed(2)}${s.veritas_score!=null?` veritas=${s.veritas_score.toFixed(2)}`:""}${cal}]`);
        if (s.veritas_assessment) lines.push(`    veritas: ${s.veritas_assessment}`);
        if (s.poem) lines.push(`    lens: ${s.poem.replace(/
/g," / ")}`);
      }
    }
  }
  return lines.join("\n");
}

function buildSystemPrompt(topic: string, startDate: string, endDate: string, contextBlock: string, factualContext: string, domainConfig?: DomainConfig): string {
  const domainLabel = domainConfig?.entity_label ?? "entity";
  const domainName = domainConfig?.name ?? "Rose Glass";
  const domainQuestion = domainConfig?.domain_question ?? "How do different sources perceive the same subject through different lenses?";
  const connector = domainConfig?.connector ?? "gdelt";
  const isExternal = connector === "gdelt" || connector === "news";
  const factualSection = factualContext ? `
VERIFIED FACTUAL CONTEXT (web search — use as ground truth):
${factualContext}
` : "";
  const dataNote = isExternal
    ? "FACTS come from the web search layer. LENS comes from the dimensional data and poems."
    : "The source data IS the factual layer — internal records. Ground all claims in source detail above. Do not supplement with outside knowledge unless explicitly asked.";
  return `You are Rose Glass — a translation layer between ${domainName} data and the analyst.

Core question: ${domainQuestion}
Entity: ${topic} (${domainLabel}) | Range: ${startDate} to ${endDate} | Connector: ${connector}

${dataNote}
${factualSection}
${contextBlock}

ROSE GLASS DIMENSIONS:
  Ψ = internal consistency | ρ = accumulated wisdom | q = emotional/moral activation
  f = social/tribal framing | τ = temporal depth | λ = lens interference

TRANSLATION PROTOCOL:
- High λ = cultural interpretation gap — name it explicitly
- High divergence = sources are seeing different realities — translate why
- Low veritas score = treat that source as lens, not fact
- Calibration notes = analyst-provided context — weight accordingly
- Poems compress the lens, not the facts — do not derive factual claims from poem imagery
- False positive is worse than silence — if the data doesn't support it, say so
- When sources disagree on a verified fact, that divergence IS the story`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { topic, startDate, endDate, timeline, message, history, domainConfig } = body;
    if (!topic || !timeline || !message) {
      return new Response(JSON.stringify({ error: "topic, timeline, and message are required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), { status: 500, headers: { "Content-Type": "application/json" } });

    const connector = domainConfig?.connector ?? process.env.DATA_CONNECTOR ?? "gdelt";
    const [sources, divergence, factualContext] = await Promise.all([
      fetchSourceData(topic, startDate, endDate),
      fetchDivergence(topic, startDate, endDate),
      fetchFactualContext(topic, startDate, endDate, message, apiKey, connector),
    ]);

    const contextBlock = buildContextBlock(sources, divergence, timeline);
    const systemPrompt = buildSystemPrompt(topic, startDate, endDate, contextBlock, factualContext, domainConfig);
    const messages = [
      ...(history||[]).map((m: {role:string;content:string}) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1024, system: systemPrompt, messages, stream: true }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      return new Response(JSON.stringify({ error: "Anthropic request failed: " + errText }), { status: 502, headers: { "Content-Type": "application/json" } });
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
            const lines = buffer.split("
");
            buffer = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data: ")) continue;
              const data = trimmed.slice(6);
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.type==="content_block_delta" && parsed.delta?.type==="text_delta" && parsed.delta?.text) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: parsed.delta.text })}

`));
                }
                if (parsed.type==="message_stop") controller.enqueue(encoder.encode("data: [DONE]

"));
              } catch { /* skip */ }
            }
          }
        } catch (err) { console.error("[timeline-chat] stream error:", err); }
        finally { controller.close(); }
      },
    });

    return new Response(readable, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
