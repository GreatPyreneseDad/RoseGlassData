/**
 * roseglass-chat — Edge Function Orchestrator (WP-2026-007)
 *
 * Receives message → computes C(x) → writes coherence_readings →
 * builds system prompt with topology injection → calls Anthropic →
 * stores response → returns content + topology.
 *
 * Phase 3: Calls real Python nematocysts via CERATA API when available,
 * falls back to browser-side compute (Option C) when unreachable.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const CERATA_API_URL = Deno.env.get("CERATA_API_URL") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Types ───────────────────────────────────────────────────────────────────

interface ZoneReading {
  A: number;
  phi: number;
}

interface CxReading {
  Cx: number;
  tau: number;
  lambda: number;
  veritas_ratio: number;
  has_dark_spot: boolean;
  zones: Record<string, ZoneReading>;
}

// ─── Browser-side C(x) compute (Option C fallback) ──────────────────────────

function computeQZone(text: string): ZoneReading {
  const words = text.toLowerCase().split(/\s+/);
  const positives = [
    "good", "great", "happy", "love", "wonderful", "amazing",
    "beautiful", "excellent", "fine", "well", "joy", "hope",
  ];
  const negatives = [
    "bad", "sad", "hate", "terrible", "awful", "hurt",
    "pain", "angry", "fear", "worry", "miss", "lost", "alone",
  ];
  const posCount = words.filter((w) => positives.includes(w)).length;
  const negCount = words.filter((w) => negatives.includes(w)).length;
  const total = posCount + negCount;

  const polarity = total > 0 ? (posCount - negCount) / total : 0;
  const subjectivity = Math.min(1, total / Math.max(words.length * 0.3, 1));
  const rawQ = (Math.abs(polarity) + subjectivity) / 2;
  const Km = 0.3, Ki = 2.0;
  const A = rawQ > 0 ? rawQ / (Km + rawQ + (rawQ * rawQ) / Ki) : 0;

  const clarity = Math.abs(polarity) * subjectivity;
  const ambiguity = subjectivity * (1 - Math.abs(polarity));
  const phi = Math.PI * ambiguity / (clarity + ambiguity + 0.001);

  return { A: Math.round(A * 10000) / 10000, phi: Math.round(phi * 10000) / 10000 };
}

function computeFZone(text: string): ZoneReading {
  const words = text.toLowerCase().split(/\s+/);
  const wordCount = words.length;

  const iWords = words.filter((w) =>
    ["i", "i'm", "i've", "i'd", "i'll", "me", "my", "mine", "myself"].includes(w)
  ).length;
  const weWords = words.filter((w) =>
    ["we", "we're", "we've", "we'd", "we'll", "us", "our", "ours"].includes(w)
  ).length;
  const youWords = words.filter((w) =>
    ["you", "you're", "you've", "you'd", "you'll", "your", "yours"].includes(w)
  ).length;
  const theyWords = words.filter((w) =>
    ["they", "they're", "they've", "them", "their", "theirs"].includes(w)
  ).length;

  const relational = ["love", "miss", "need", "want", "trust", "believe",
    "together", "family", "friend", "home", "belong"];
  const isolation = ["alone", "lonely", "nobody", "nothing", "empty",
    "lost", "abandoned", "disconnected", "invisible"];

  const relCount = words.filter((w) => relational.includes(w)).length;
  const isoCount = words.filter((w) => isolation.includes(w)).length;

  const totalPronouns = iWords + weWords + youWords + theyWords + 0.001;
  let localF = Math.min(1, (weWords + relCount) / Math.max(wordCount * 0.1, 1));
  const bridgeF = Math.min(1, youWords / Math.max(wordCount * 0.05, 1));
  const influenceF = Math.min(1, (iWords + weWords) / totalPronouns);
  let reachF = Math.min(1, ((youWords > 0 ? 1 : 0) + (weWords > 0 ? 1 : 0) + (theyWords > 0 ? 1 : 0)) / 3);

  if (isoCount > 0) {
    const factor = Math.max(0.1, 1 - isoCount * 0.2);
    localF *= factor;
    reachF *= factor;
  }

  const A = (localF + bridgeF + influenceF + reachF) / 4;
  const balance = 1 - Math.max(localF, bridgeF, influenceF, reachF) +
    Math.min(localF, bridgeF, influenceF, reachF);
  const isoSignal = Math.max(0, (1 - localF) * (1 - reachF));
  const phi = Math.PI * (1 - balance) * (0.5 + 0.5 * isoSignal);

  return { A: Math.round(A * 10000) / 10000, phi: Math.round(phi * 10000) / 10000 };
}

function computeRhoZone(text: string): ZoneReading {
  const lower = text.toLowerCase();
  const temporal = [
    /\d+\s+years?/, /\d+\s+decades?/, /centuries/, /legacy/,
    /battle[\s-]tested/, /proven/, /mature/, /established/,
    /time[\s-]tested/, /veteran/, /seasoned/, /experienced/,
  ];
  const depth = [
    /comprehensive/, /thorough/, /deep/, /extensive/, /complete/,
    /full[\s-]featured/, /robust/, /sophisticated/, /advanced/,
  ];
  const community = [
    /\d+k?\+?\s+stars?/, /widely[\s-]adopted/, /industry[\s-]standard/,
    /popular/, /trusted/, /reliable/,
  ];

  const tCount = temporal.filter((p) => p.test(lower)).length;
  const dCount = depth.filter((p) => p.test(lower)).length;
  const cCount = community.filter((p) => p.test(lower)).length;

  const tScore = Math.min(tCount / 3, 1);
  const dScore = Math.min(dCount / 3, 1);
  const cScore = Math.min(cCount / 3, 1);
  const raw = 0.4 * tScore + 0.3 * dScore + 0.3 * cScore;
  const A = 1 - Math.exp(-2.5 * raw);

  const consistency = tScore;
  const precision = dScore;
  const stability = Math.min(1, (tScore + cScore) / 2);
  const convergence = cScore;
  const depthVal = (consistency + convergence) / 2;
  const surface = 1 - stability * precision;
  const phi = Math.PI * surface * (1 - depthVal);

  return { A: Math.round(A * 10000) / 10000, phi: Math.round(phi * 10000) / 10000 };
}

function computePsiZone(text: string): ZoneReading {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;

  const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
  const lexicalDensity = wordCount > 0 ? uniqueWords.size / wordCount : 0;

  let lengthConsistency = 1.0;
  if (sentences.length > 1) {
    const lengths = sentences.map((s) => s.trim().split(/\s+/).length);
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((a, l) => a + (l - avg) ** 2, 0) / lengths.length;
    lengthConsistency = 1.0 / (1.0 + variance / 10.0);
  }

  // POS entropy proxy: character type diversity
  const charTypes = new Set(text.replace(/\s/g, "").split("").map((c) => {
    if (/[a-z]/.test(c)) return "lower";
    if (/[A-Z]/.test(c)) return "upper";
    if (/[0-9]/.test(c)) return "digit";
    return "punct";
  }));
  const posEntropy = charTypes.size / 4;

  const A = 0.3 * Math.min(posEntropy, 1) + 0.3 * lexicalDensity + 0.4 * lengthConsistency;
  const structure = lengthConsistency * lexicalDensity;
  const chaos = posEntropy * (1 - lexicalDensity);
  const phi = Math.PI * chaos / (structure + chaos + 0.001);

  return { A: Math.round(A * 10000) / 10000, phi: Math.round(phi * 10000) / 10000 };
}

function computeCxBrowserSide(text: string, tau: number): CxReading {
  const zones: Record<string, ZoneReading> = {
    q: computeQZone(text),
    f: computeFZone(text),
    rho: computeRhoZone(text),
    psi: computePsiZone(text),
  };

  const zoneDepths: Record<string, number> = { q: 1, f: 2, rho: 3, psi: 4 };

  // C(x) = |Σ A_z × min(1, τ/depth) × e^(iφ × λ)|²
  let realPart = 0;
  let imagPart = 0;
  for (const [key, z] of Object.entries(zones)) {
    const tauWeight = Math.min(1.0, tau / zoneDepths[key]);
    const weighted = z.A * tauWeight;
    realPart += weighted * Math.cos(z.phi);
    imagPart += weighted * Math.sin(z.phi);
  }
  const Cx = Math.min(1.0, realPart * realPart + imagPart * imagPart);

  // Veritas
  let totalAmpSq = 0;
  for (const [key, z] of Object.entries(zones)) {
    const w = z.A * Math.min(1.0, tau / zoneDepths[key]);
    totalAmpSq += w * w;
  }
  const veritas = totalAmpSq > 0 ? Cx / totalAmpSq : 0;
  const hasDarkSpot = Cx < 0.1 && totalAmpSq > 0.2;

  return {
    Cx: Math.round(Cx * 10000) / 10000,
    tau,
    lambda: 1.0,
    veritas_ratio: Math.round(veritas * 10000) / 10000,
    has_dark_spot: hasDarkSpot,
    zones,
  };
}

// ─── System Prompt Builder (Phase 5) ─────────────────────────────────────────

function deg(phi: number): string {
  return (phi * 180 / Math.PI).toFixed(0);
}

function destructive(phi: number): string {
  return Math.abs(phi) > Math.PI * 0.4 ? "[DESTRUCTIVE]" : "[constructive]";
}

function buildSystemPrompt(cx: CxReading, msgCount: number): string {
  const z = cx.zones;
  const darkWarning = cx.has_dark_spot
    ? `\n\n⚠ DARK SPOT DETECTED: C(x) ≈ ${cx.Cx.toFixed(3)} with ` +
      `nonzero amplitudes. Structured silence — zones interfering ` +
      `destructively. Do NOT accept surface coherence. ` +
      `The quiet is signal.`
    : "";

  return `You are a Rose Glass–aware mind. You perceive through four Fresnel zones simultaneously.

COHERENCE READING (WP-2026-007):
C(x, τ=${cx.tau.toFixed(1)}, λ=1.0) = ${cx.Cx.toFixed(4)}
Veritas: ${cx.veritas_ratio.toFixed(4)}

Zones:
- Z1 q (Sentiment): A=${z.q.A.toFixed(3)} φ=${deg(z.q.phi)}° ${destructive(z.q.phi)}
- Z2 f (Belonging): A=${z.f.A.toFixed(3)} φ=${deg(z.f.phi)}° ${destructive(z.f.phi)}
- Z3 ρ (Wisdom):    A=${z.rho.A.toFixed(3)} φ=${deg(z.rho.phi)}° ${destructive(z.rho.phi)}
- Z4 Ψ (Linguistic): A=${z.psi.A.toFixed(3)} φ=${deg(z.psi.phi)}° ${destructive(z.psi.phi)}
${darkWarning}

DIRECTIVES:
- See the interference pattern, not just Zone 1.
- Dark spots are signal. Structured silence is not absence.
- When zones destructively interfere, name what you see beneath.
- Respond in natural prose. No lists. No bullet points.
- Be direct, warm, honest. No performative helpfulness.
- τ=${cx.tau.toFixed(1)} — ${cx.tau > 1.5 ? "deep context accumulated" : "early conversation, Zone 3 still emerging"}.
- The Veritas constraint binds you: do not fabricate coherence where the zones do not support it.`;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "https://roseglass.chat",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
      },
    });
  }

  try {
    const { session_id, message } = await req.json();

    if (!session_id || !message) {
      return new Response(
        JSON.stringify({ error: "session_id and message required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Ensure session row exists (FK target for chat_messages and coherence_readings)
    await supabase
      .from("db_sessions")
      .upsert(
        { id: session_id, name: "roseglass-chat", connector: "roseglass-cx" },
        { onConflict: "id", ignoreDuplicates: true },
      );

    // 1. Get conversation history + accumulated τ across sessions
    const { data: history } = await supabase
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("session_id", session_id)
      .order("created_at", { ascending: true });

    const msgCount = history?.length || 0;

    // Accumulated τ (Phase 6 — WP-2026-007)
    // Query cross-session readings for the same user (via api_key_id)
    let accumulatedTau = 0;
    const { data: session } = await supabase
      .from("db_sessions")
      .select("api_key_id")
      .eq("id", session_id)
      .single();

    if (session?.api_key_id) {
      // Get all sibling sessions for this user
      const { data: siblingReadings } = await supabase
        .rpc("get_accumulated_tau", { p_api_key_id: session.api_key_id, p_current_session: session_id })
        .maybeSingle();

      if (siblingReadings) {
        // accumulated τ from prior sessions
        const totalReadings = siblingReadings.total_readings || 0;
        const daysSinceLastSeen = siblingReadings.days_since_last || 999;
        const recencyWeight = Math.max(0.1, 1.0 - daysSinceLastSeen * 0.05);
        accumulatedTau = Math.log(1 + totalReadings) * recencyWeight * 0.3;
      }
    }

    // τ = session depth + accumulated cross-session depth, capped at 3.0
    const sessionTau = 0.5 + msgCount * 0.15;
    const tau = Math.min(3.0, sessionTau + accumulatedTau);

    // 2. Compute C(x) — try real Python nematocysts, fall back to browser-side
    let cxReading: CxReading;
    let computeSource = "browser-side";

    if (CERATA_API_URL) {
      try {
        const cerataRes = await fetch(`${CERATA_API_URL}/cx`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: message, tau, lambda: 1.0 }),
          signal: AbortSignal.timeout(5000),
        });
        if (cerataRes.ok) {
          const cerataData = await cerataRes.json();
          if (cerataData.success) {
            cxReading = {
              Cx: cerataData.Cx,
              tau: cerataData.tau,
              lambda: cerataData.lambda,
              veritas_ratio: cerataData.veritas_ratio,
              has_dark_spot: cerataData.has_dark_spot,
              zones: cerataData.zones,
            };
            computeSource = "python-nematocysts";
          } else {
            cxReading = computeCxBrowserSide(message, tau);
          }
        } else {
          cxReading = computeCxBrowserSide(message, tau);
        }
      } catch {
        // Timeout or network error — fall back silently
        cxReading = computeCxBrowserSide(message, tau);
      }
    } else {
      cxReading = computeCxBrowserSide(message, tau);
    }

    // 3. Store user message
    const { data: msgRow, error: msgErr } = await supabase
      .from("chat_messages")
      .insert({ session_id, role: "user", content: message })
      .select("id")
      .single();

    if (msgErr) console.error("[roseglass-chat] user msg insert failed:", msgErr);

    // 4. Store coherence reading
    const { error: crErr } = await supabase.from("coherence_readings").insert({
      session_id,
      message_id: msgRow?.id,
      a_q: cxReading.zones.q.A,
      a_f: cxReading.zones.f.A,
      a_rho: cxReading.zones.rho.A,
      a_psi: cxReading.zones.psi.A,
      phi_q: cxReading.zones.q.phi,
      phi_f: cxReading.zones.f.phi,
      phi_rho: cxReading.zones.rho.phi,
      phi_psi: cxReading.zones.psi.phi,
      cx: cxReading.Cx,
      tau,
      lambda: 1.0,
      veritas_ratio: cxReading.veritas_ratio,
      has_dark_spot: cxReading.has_dark_spot,
      zone_detail: cxReading.zones,
    });

    if (crErr) console.error("[roseglass-chat] coherence_readings insert failed:", crErr);

    // 5. Build system prompt with C(x) injection
    const systemPrompt = buildSystemPrompt(cxReading, msgCount);

    // 6. Build message array for Anthropic
    const apiMessages = [
      ...(history || []).map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: message },
    ];

    // 7. Call Anthropic
    const anthropicRes = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: systemPrompt,
          messages: apiMessages,
          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
            },
          ],
        }),
      },
    );
    const anthropicData = await anthropicRes.json();
    const assistantContent =
      anthropicData.content
        ?.filter((b: { type: string }) => b.type === "text")
        .map((b: { text?: string }) => b.text || "")
        .join("") || "No response";

    // 8. Store assistant message
    const { error: asstErr } = await supabase
      .from("chat_messages")
      .insert({ session_id, role: "assistant", content: assistantContent });

    if (asstErr) console.error("[roseglass-chat] assistant msg insert failed:", asstErr);

    // 9. Return response + topology
    return new Response(
      JSON.stringify({
        content: assistantContent,
        cx: cxReading,
        tau,
        compute_source: computeSource,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "https://roseglass.chat",
        },
      },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[roseglass-chat]", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "https://roseglass.chat",
        },
      },
    );
  }
});
