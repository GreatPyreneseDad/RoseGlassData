"use client";

// roseglassdata.com/EE26 — Edge Esmeralda 2026 demo.
// Upload a CSV (or open the BRFSS sample) and watch Rose Glass read the SCHEMA:
// what the data believes, what is absent, the proxy/null semantics a profiler can't
// see. Translation, not judgment. Two Hands: the page renders Hand 1 (what is
// perceived about the dataset) and leaves Hand 2 (what it means for your research) a
// deliberately empty, open hand. Where the read cannot verify, it stays silent.

import { useCallback, useEffect, useRef, useState } from "react";

interface ChatMessage { role: "user" | "assistant"; content: string }

interface NullKind { code: string; kind: string; label: string; n: number }
interface MeanReading {
  naive_mean: number;
  corrected_mean: number | null;
  valid_domain: string | null;
  zero_code: string | null;
  zero_inclusive_mean: number | null;
  excluded_codes: string[];
  n_valid: number;
  n_excluded: number;
  domain_verified: boolean;
  sample_caveat: string;
}
interface CategoricalDistribution {
  total: number;
  codes: Array<{ code: string; n: number }>;
  truncated: number;
}
interface ReadColumn {
  name: string;
  semantic_type: string | null;
  collection_method: string | null;
  raw_or_derived: "raw" | "derived" | null;
  derived_from: string[] | null;
  is_design_weight: boolean;
  is_imputed: boolean;
  imputed_note: string | null;
  null_kinds: NullKind[];
  null_note: string | null;
  naive_vs_valid: MeanReading | null;
  categorical_distribution: CategoricalDistribution | null;
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

const SAMPLES = [
  {
    id: "brfss-2024-womens-health",
    title: "BRFSS 2024 — Women’s Health",
    blurb:
      "6,000 female respondents, 52 columns, raw CDC codes — nothing recoded. Five kinds of “null,” none of which look like null.",
    source:
      "CDC BRFSS 2024 combined landline+cell (457,670 records). This card is a 6,000-row sample for schema reading, not prevalence estimation.",
    path: "/samples/brfss_2024_womens_health.csv",
  },
];

const NICE: Record<string, string> = {
  absent_as_value: "None / zero, coded as a number",
  dont_know: "Don’t know",
  refused: "Refused",
  not_asked: "Not asked (skip logic)",
  sentinel: "Reserved code",
};

export default function EE26Page() {
  const [stage, setStage] = useState<"idle" | "reading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [read, setRead] = useState<ReadResult | null>(null);
  const [activeName, setActiveName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // ---- chat about the read (ephemeral, in-session only) ----
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, chatBusy]);

  const doRead = useCallback(async (csvText: string, filename: string) => {
    setStage("reading");
    setError("");
    setRead(null);
    setChat([]);
    setChatInput("");
    setChatError("");
    setActiveName(filename);
    try {
      const res = await fetch("/api/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, csv_text: csvText }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "The read could not complete.");
      setRead(data.read as ReadResult);
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The read could not complete.");
      setStage("error");
    }
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      if (file.size > 8 * 1024 * 1024) {
        setError("That CSV is larger than the 8 MB in-session reader limit.");
        setStage("error");
        return;
      }
      const text = await file.text();
      doRead(text, file.name);
    },
    [doRead]
  );

  const openSample = useCallback(
    async (path: string, title: string) => {
      setStage("reading");
      setError("");
      setRead(null);
      setActiveName(title);
      try {
        const res = await fetch(path);
        if (!res.ok) throw new Error("Could not load the sample file.");
        const text = await res.text();
        doRead(text, title);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load the sample.");
        setStage("error");
      }
    },
    [doRead]
  );

  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatBusy || !read) return;
    const next: ChatMessage[] = [...chat, { role: "user", content: text }];
    setChat(next);
    setChatInput("");
    setChatBusy(true);
    setChatError("");
    try {
      const res = await fetch("/api/ee26-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read, messages: next }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Chat could not complete.");
      setChat((c) => [...c, { role: "assistant", content: data.reply }]);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Chat could not complete.");
    } finally {
      setChatBusy(false);
    }
  }, [chatInput, chatBusy, read, chat]);

  const SUGGESTIONS = [
    "Which columns would mislead a naive average?",
    "What is absent here that I might assume is present?",
    "Where could a field act as a proxy for something else?",
  ];

  return (
    <div className="ee">
      <style>{CSS}</style>

      <header className="hdr">
        <a className="mark" href="/">
          <img src="/logo.png" alt="" width={30} height={30} style={{ borderRadius: 6 }} />
          Rose Glass Data
        </a>
        <span className="badge">Edge Esmeralda 2026</span>
      </header>

      {/* ---- welcome ---- */}
      <section className="hero">
        <p className="kicker">For the village · Week 1: Health &amp; Longevity</p>
        <h1>
          What does your dataset <em>believe</em>?
        </h1>
        <p className="sub">
          Rose Glass reads the <strong>structure</strong> of a dataset, not its rows: what it tracks,
          what is absent, and the proxy and null semantics a profiler can’t see. It translates what
          the schema encodes. It does not rate it, rank it, or tell you what to do.
        </p>
        <p className="meta">Free · no account · nothing saved — the read happens in your session and is then gone.</p>
      </section>

      {/* ---- two entry paths ---- */}
      <section className="paths" aria-label="Choose a dataset to read">
        <div
          className={`card drop${dragOver ? " over" : ""}`}
          role="button"
          tabIndex={0}
          aria-label="Upload your own CSV. Drag a file here or press Enter to choose one."
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInput.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
        >
          <div className="card-eyebrow">01 · Your data</div>
          <h2>Upload your own CSV</h2>
          <p>Drag a file here, or click to choose one. It is read in your browser session and never stored.</p>
          <span className="hint">CSV · up to 8 MB</span>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </div>

        <div className="card">
          <div className="card-eyebrow">02 · A sample</div>
          <h2>Open a sample</h2>
          <p>Reads through the exact same path as your own upload.</p>
          <div className="samples">
            {SAMPLES.map((s) => (
              <button
                key={s.id}
                className="sample"
                onClick={() => openSample(s.path, s.title)}
                aria-label={`Open sample: ${s.title}`}
              >
                <span className="sample-title">{s.title}</span>
                <span className="sample-blurb">{s.blurb}</span>
                <span className="sample-source">{s.source}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ---- status (Veritas-aware) ---- */}
      <div className="status" aria-live="polite">
        {stage === "reading" && <p className="reading">Reading the schema of <em>{activeName}</em>…</p>}
        {stage === "error" && <p className="err" role="alert">{error}</p>}
      </div>

      {/* ---- the read: Hand 1 ---- */}
      {stage === "done" && read && (
        <section className="read" aria-label="What is perceived about this dataset">
          <div className="hand-label">
            <span className="hand-num">Hand 1</span>
            <span>What is perceived about the dataset</span>
          </div>

          <div className="read-head">
            <h2>{read.filename}</h2>
            <p className="counts">
              {read.n_rows_sampled.toLocaleString()} rows read · {read.n_cols} columns
            </p>
            {read.dataset_level.grain && (
              <p className="grain"><span className="lbl">One row is</span> {read.dataset_level.grain}</p>
            )}
            {read.dataset_level.dataset_class && (
              <p className="grain"><span className="lbl">Reads as</span> {read.dataset_level.dataset_class.replace(/_/g, " ")}</p>
            )}
            {read.dataset_level.analytical_scope && (
              <p className="scope">{read.dataset_level.analytical_scope}</p>
            )}
          </div>

          {/* dataset-level structure */}
          {(read.dataset_level.structural_notes.length > 0 ||
            read.dataset_level.raw_derived_pairs.length > 0 ||
            read.dataset_level.structural_absence.length > 0) && (
            <div className="block">
              <h3>What the structure carries</h3>
              {read.dataset_level.design_weights.length > 0 && (
                <p className="tagline">
                  <span className="tag">design weights</span>
                  {read.dataset_level.design_weights.join(", ")}
                </p>
              )}
              {read.dataset_level.raw_derived_pairs.map((p) => (
                <p className="tagline" key={p.raw}>
                  <span className="tag">raw → derived</span>
                  <code>{p.raw}</code> → <code>{p.derived.join(", ")}</code>
                </p>
              ))}
              {read.dataset_level.structural_notes.map((n, i) => (
                <p className="note" key={i}>{n}</p>
              ))}
              {read.dataset_level.structural_absence.map((n, i) => (
                <p className="note absence" key={`a${i}`}>{n}</p>
              ))}
            </div>
          )}

          {/* Veritas: name the silence when the semantic lens did not converge */}
          {!read.dataset_level.semantic_available && (
            <p className="veritas">
              The semantic lens did not return a reading for this file. Rather than guess, the read
              stays with what can be verified structurally below.
            </p>
          )}

          {/* per-column */}
          <div className="cols">
            {read.columns.map((c) => (
              <article className={`col${c.silent ? " silent" : ""}`} key={c.name}>
                <header className="col-h">
                  <code className="col-name">{c.name}</code>
                  <span className="col-flags">
                    {c.is_design_weight && <span className="flag wt">design weight</span>}
                    {c.is_imputed && <span className="flag imp">imputed</span>}
                    {c.raw_or_derived === "derived" && (
                      <span className="flag dv">
                        derived{c.derived_from ? ` from ${c.derived_from.join(", ")}` : ""}
                      </span>
                    )}
                  </span>
                </header>

                {c.silent ? (
                  <p className="col-silent">Nothing the read can verify here beyond a plain column.</p>
                ) : (
                  <div className="col-body">
                    {(c.semantic_type || c.collection_method) && (
                      <p className="line">
                        {c.semantic_type && <span className="chip">{c.semantic_type.replace(/_/g, " ")}</span>}
                        {c.collection_method && (
                          <span className="chip soft">{c.collection_method.replace(/_/g, " ")}</span>
                        )}
                      </p>
                    )}

                    {c.null_kinds.length > 0 && (
                      <div className="nulls">
                        <span className="lbl">null semantics</span>
                        {c.null_kinds.map((k) => (
                          <span className="nullk" key={k.code} title={k.label}>
                            <code>{k.code}</code> = {NICE[k.kind] || k.kind}{" "}
                            <span className="nn">({k.n.toLocaleString()})</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {c.is_imputed && c.imputed_note && (
                      <p className="imputed">{c.imputed_note}</p>
                    )}

                    {c.naive_vs_valid && c.naive_vs_valid.domain_verified && (
                      <div className="naive">
                        <p>
                          Naive mean <strong>{c.naive_vs_valid.naive_mean}</strong>{" "}
                          {c.naive_vs_valid.excluded_codes.length > 0 ? (
                            <>counts the reserved codes ({c.naive_vs_valid.excluded_codes.join(", ")}) and any out-of-range value as real numbers.</>
                          ) : (
                            <>counts out-of-range values as real numbers.</>
                          )}{" "}
                          Over the {c.naive_vs_valid.valid_domain} valid range:{" "}
                          <strong>{c.naive_vs_valid.corrected_mean}</strong>{" "}
                          (n&nbsp;=&nbsp;{c.naive_vs_valid.n_valid.toLocaleString()}).
                          {c.naive_vs_valid.zero_code && c.naive_vs_valid.zero_inclusive_mean != null && (
                            <> Counting code {c.naive_vs_valid.zero_code} as 0 days:{" "}
                              <strong>{c.naive_vs_valid.zero_inclusive_mean}</strong>.</>
                          )}
                        </p>
                        <p className="mean-caveat">{c.naive_vs_valid.sample_caveat}</p>
                      </div>
                    )}

                    {c.naive_vs_valid && !c.naive_vs_valid.domain_verified && (
                      <div className="naive unverified">
                        <p>
                          Naive mean <strong>{c.naive_vs_valid.naive_mean}</strong>. Suspected reserved
                          codes ({c.naive_vs_valid.excluded_codes.join(", ")}) sit above the value range,
                          so this mean is likely inflated — but without a codebook the valid domain is
                          unverified, so no corrected figure is asserted.
                        </p>
                        <p className="mean-caveat">{c.naive_vs_valid.sample_caveat}</p>
                      </div>
                    )}

                    {c.categorical_distribution && (
                      <div className="dist">
                        <span className="lbl">code distribution</span>
                        <span className="dist-codes">
                          {c.categorical_distribution.codes.map((d) => (
                            <span className="distk" key={d.code}>
                              <code>{d.code}</code> <span className="nn">{d.n.toLocaleString()}</span>
                            </span>
                          ))}
                          {c.categorical_distribution.truncated > 0 && (
                            <span className="distk more">+{c.categorical_distribution.truncated} more</span>
                          )}
                        </span>
                        <span className="dist-note">categorical codes — a mean would not be a quantity</span>
                      </div>
                    )}

                    {c.null_note && <p className="subtle">{c.null_note}</p>}

                    {c.structural_absence && <p className="subtle absence">{c.structural_absence}</p>}

                    {c.proxy_risk && (
                      <p className="proxy">
                        <span className="lbl">proxy risk</span>
                        <span className="proxy-lvl">{c.proxy_risk.level}</span>
                        {c.proxy_risk.note && <span className="proxy-note"> — {c.proxy_risk.note}</span>}
                      </p>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>

          {/* ---- Hand 2: the open hand, never filled ---- */}
          <div className="hand2" aria-label="Hand 2 — left open for you">
            <div className="hand-label">
              <span className="hand-num open">Hand 2</span>
              <span>What this means for your research</span>
            </div>
            <p className="hand2-body">
              This panel is left open on purpose. The instrument perceives; what the read means for your
              question, your study, your next step — that is yours to hold. Rose Glass does not fill it.
            </p>
          </div>

          {/* ---- ask about the read (ephemeral chat) ---- */}
          <div className="chat" aria-label="Ask about what was perceived">
            <div className="hand-label">
              <span className="hand-num">Ask</span>
              <span>Questions about what was perceived</span>
            </div>
            <p className="chat-intro">
              Ask about the columns, the codes, the absences, the dependencies above. It answers only from
              this read, says when it can’t tell, and leaves the meaning to you.
            </p>

            {chat.length === 0 && (
              <div className="chat-suggest">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="suggest" onClick={() => setChatInput(s)} disabled={chatBusy}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            {chat.length > 0 && (
              <div className="chat-log">
                {chat.map((m, i) => (
                  <div key={i} className={`bubble ${m.role}`}>
                    {m.content}
                  </div>
                ))}
                {chatBusy && (
                  <div className="bubble assistant pending" aria-live="polite">
                    <span className="dots"><span /><span /><span /></span>
                  </div>
                )}
                <div ref={chatEnd} />
              </div>
            )}

            {chatError && <p className="err" role="alert">{chatError}</p>}

            <div className="chat-input-row">
              <textarea
                className="chat-input"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendChat();
                  }
                }}
                placeholder="Ask about this read…"
                rows={1}
                aria-label="Ask a question about this read"
              />
              <button
                className="chat-send"
                onClick={sendChat}
                disabled={chatBusy || !chatInput.trim()}
                aria-label="Send question"
              >
                {chatBusy ? "…" : "Ask"}
              </button>
            </div>
            <p className="chat-note">Conversation stays in this session — nothing is saved.</p>
          </div>
        </section>
      )}

      {/* ---- privacy ---- */}
      <section className="privacy">
        <h3>What happens to your file</h3>
        <p>
          Uploads are ephemeral. The reader sees your column structure and a bounded row sample in this
          session only. Your file is not persisted, its contents are not logged, and there is no account
          or login. Non-essential cookies are declined by default.
        </p>
      </section>

      <footer className="footer">
        <p>
          The Rose Glass framework is human-authored — Christopher MacGregor bin Joseph, ROSE Corp
          (SDVOSB). The read surfaces structure; it does not validate the data, and it is not machine-authored
          insight. Built with AI tooling, disclosed honestly.
        </p>
        <p className="legal">ROSE Corp · Service-Disabled Veteran-Owned Small Business · roseglassdata.com</p>
      </footer>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,400&family=JetBrains+Mono:wght@300;400&display=swap');
.ee *{box-sizing:border-box;margin:0;padding:0}
.ee{min-height:100vh;background:#faf8f4;color:#2a2520;font-family:Georgia,serif;line-height:1.7}
.ee code{font-family:'JetBrains Mono',monospace}
.ee .hdr{display:flex;align-items:center;justify-content:space-between;padding:1.1rem 2rem;border-bottom:1px solid #e8e2d8;position:sticky;top:0;background:rgba(250,248,244,.97);backdrop-filter:blur(12px);z-index:10}
.ee .mark{display:flex;align-items:center;gap:12px;font-family:'Cormorant Garamond',serif;font-size:1.05rem;letter-spacing:.22em;text-transform:uppercase;color:#6b5d3e;text-decoration:none}
.ee .badge{font-family:'JetBrains Mono',monospace;font-size:.6rem;letter-spacing:.18em;color:#8b6f3a;border:1px solid #d8cdb5;padding:.35rem .7rem;border-radius:999px}
.ee .hero{max-width:760px;margin:0 auto;padding:4.5rem 2rem 2.5rem}
.ee .kicker{font-family:'JetBrains Mono',monospace;font-size:.62rem;letter-spacing:.2em;text-transform:uppercase;color:#a89a78;margin-bottom:1.2rem}
.ee .hero h1{font-family:'Cormorant Garamond',serif;font-weight:300;font-size:3rem;line-height:1.15;letter-spacing:.01em;color:#2a2520;margin-bottom:1.4rem}
.ee .hero h1 em{font-style:italic;color:#8b6f3a}
.ee .sub{font-size:1.02rem;color:#6b6253;max-width:620px;margin-bottom:1rem}
.ee .sub strong{color:#2a2520;font-weight:600}
.ee .meta{font-family:'JetBrains Mono',monospace;font-size:.66rem;letter-spacing:.06em;color:#a89a78}
.ee .paths{max-width:900px;margin:0 auto;padding:1.5rem 2rem;display:grid;grid-template-columns:1fr 1fr;gap:1.3rem}
.ee .card{background:#fff;border:1px solid #e8e2d8;border-radius:14px;padding:1.6rem;display:flex;flex-direction:column}
.ee .card.drop{cursor:pointer;transition:border-color .15s,background .15s;outline:none}
.ee .card.drop:hover,.ee .card.drop:focus-visible,.ee .card.drop.over{border-color:#8b6f3a;background:#fffdf8}
.ee .card-eyebrow{font-family:'JetBrains Mono',monospace;font-size:.58rem;letter-spacing:.18em;color:#b0a890;margin-bottom:.7rem}
.ee .card h2{font-family:'Cormorant Garamond',serif;font-weight:400;font-size:1.55rem;color:#2a2520;margin-bottom:.5rem}
.ee .card p{font-size:.88rem;color:#7a7060;margin-bottom:.8rem}
.ee .hint{margin-top:auto;font-family:'JetBrains Mono',monospace;font-size:.6rem;letter-spacing:.1em;color:#b0a890}
.ee .samples{display:flex;flex-direction:column;gap:.7rem;margin-top:auto}
.ee .sample{text-align:left;background:#fbf9f4;border:1px solid #e8e2d8;border-radius:10px;padding:.9rem 1rem;cursor:pointer;transition:border-color .15s,background .15s;font-family:inherit}
.ee .sample:hover,.ee .sample:focus-visible{border-color:#8b6f3a;background:#fffdf8;outline:none}
.ee .sample-title{display:block;font-family:'Cormorant Garamond',serif;font-size:1.15rem;color:#2a2520;margin-bottom:.25rem}
.ee .sample-blurb{display:block;font-size:.82rem;color:#7a7060;margin-bottom:.4rem}
.ee .sample-source{display:block;font-family:'JetBrains Mono',monospace;font-size:.56rem;line-height:1.5;letter-spacing:.04em;color:#b0a890}
.ee .status{max-width:900px;margin:0 auto;padding:0 2rem;min-height:1.5rem}
.ee .reading{font-family:'JetBrains Mono',monospace;font-size:.72rem;letter-spacing:.08em;color:#8b6f3a;padding:1rem 0}
.ee .reading em{font-style:normal;color:#2a2520}
.ee .err{color:#9a3b2e;background:#fbeeea;border:1px solid #e6c9c0;border-radius:10px;padding:.9rem 1.1rem;font-size:.86rem;margin:.6rem 0}
.ee .read{max-width:900px;margin:0 auto;padding:1.5rem 2rem 1rem}
.ee .hand-label{display:flex;align-items:baseline;gap:.7rem;font-family:'JetBrains Mono',monospace;font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:#a89a78;border-top:1px solid #e8e2d8;padding-top:1rem;margin-bottom:1.2rem}
.ee .hand-num{color:#8b6f3a;font-weight:400;border:1px solid #d8cdb5;padding:.18rem .5rem;border-radius:6px}
.ee .hand-num.open{border-style:dashed;color:#b0a890}
.ee .read-head h2{font-family:'Cormorant Garamond',serif;font-weight:400;font-size:1.9rem;color:#2a2520}
.ee .counts{font-family:'JetBrains Mono',monospace;font-size:.66rem;letter-spacing:.06em;color:#a89a78;margin:.3rem 0 1rem}
.ee .grain{font-size:.95rem;color:#5a5246;margin-bottom:.3rem}
.ee .grain .lbl,.ee .lbl{font-family:'JetBrains Mono',monospace;font-size:.56rem;letter-spacing:.14em;text-transform:uppercase;color:#b0a890;margin-right:.5rem}
.ee .scope{font-size:.92rem;color:#6b6253;font-style:italic;margin:.6rem 0}
.ee .block{background:#fff;border:1px solid #e8e2d8;border-radius:12px;padding:1.2rem 1.3rem;margin:1.3rem 0}
.ee .block h3{font-family:'Cormorant Garamond',serif;font-weight:500;font-size:1.2rem;color:#2a2520;margin-bottom:.7rem}
.ee .tagline{font-size:.86rem;color:#5a5246;margin-bottom:.45rem;display:flex;flex-wrap:wrap;align-items:center;gap:.4rem}
.ee .tag{font-family:'JetBrains Mono',monospace;font-size:.54rem;letter-spacing:.12em;text-transform:uppercase;color:#8b6f3a;background:#f4efe4;border-radius:5px;padding:.2rem .45rem}
.ee .tagline code,.ee .col-name{font-size:.8rem;color:#6b5d3e}
.ee .note{font-size:.88rem;color:#6b6253;margin-top:.5rem;padding-left:.8rem;border-left:2px solid #e8e2d8}
.ee .note.absence,.ee .absence{border-left-color:#c9a96a}
.ee .veritas{font-size:.88rem;color:#7a7060;font-style:italic;background:#f7f3ea;border:1px dashed #d8cdb5;border-radius:10px;padding:.9rem 1.1rem;margin:1rem 0}
.ee .cols{display:flex;flex-direction:column;gap:.7rem;margin-top:1.3rem}
.ee .col{background:#fff;border:1px solid #e8e2d8;border-radius:11px;padding:1rem 1.1rem}
.ee .col.silent{background:#fbfaf6;border-style:dashed}
.ee .col-h{display:flex;align-items:center;justify-content:space-between;gap:.6rem;flex-wrap:wrap}
.ee .col-name{font-size:.86rem;font-weight:400;color:#2a2520;letter-spacing:.02em}
.ee .col-flags{display:flex;gap:.4rem;flex-wrap:wrap}
.ee .flag{font-family:'JetBrains Mono',monospace;font-size:.52rem;letter-spacing:.1em;text-transform:uppercase;padding:.2rem .45rem;border-radius:5px}
.ee .flag.wt{color:#7a5b8b;background:#f3edf6}
.ee .flag.dv{color:#5b7a6b;background:#edf5f0}
.ee .col-silent{font-size:.82rem;color:#b0a890;font-style:italic;margin-top:.4rem}
.ee .col-body{margin-top:.6rem;display:flex;flex-direction:column;gap:.55rem}
.ee .line{display:flex;gap:.4rem;flex-wrap:wrap}
.ee .chip{font-family:'JetBrains Mono',monospace;font-size:.6rem;letter-spacing:.06em;color:#2a2520;background:#f0ebdf;border-radius:6px;padding:.25rem .55rem}
.ee .chip.soft{color:#7a7060;background:#f7f3ea}
.ee .nulls{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}
.ee .nullk{font-size:.78rem;color:#5a5246;background:#fbf7ee;border:1px solid #ece4d3;border-radius:6px;padding:.2rem .5rem}
.ee .nullk code{font-size:.72rem;color:#8b6f3a}
.ee .nullk .nn{color:#b0a890;font-family:'JetBrains Mono',monospace;font-size:.6rem}
.ee .naive{font-size:.88rem;color:#5a4a2e;background:#fbf3e2;border:1px solid #e8d6ad;border-radius:9px;padding:.7rem .85rem;line-height:1.65}
.ee .naive strong{color:#7a5a1e}
.ee .naive.unverified{background:#f7f3ea;border-color:#d8cdb5;color:#6b6253}
.ee .mean-caveat{font-family:'JetBrains Mono',monospace;font-size:.56rem;letter-spacing:.04em;color:#a8946a;margin-top:.45rem;line-height:1.5}
.ee .imputed{font-size:.86rem;color:#6a4a6a;background:#f6f0f6;border:1px solid #e3d3e6;border-radius:9px;padding:.7rem .85rem;line-height:1.6}
.ee .flag.imp{color:#8a5a8a;background:#f3e8f4}
.ee .dist{display:flex;flex-direction:column;gap:.4rem}
.ee .dist-codes{display:flex;flex-wrap:wrap;gap:.4rem}
.ee .distk{font-size:.76rem;color:#5a5246;background:#f4f1ea;border:1px solid #e6ddcb;border-radius:6px;padding:.18rem .5rem}
.ee .distk code{font-size:.72rem;color:#6b5d3e}
.ee .distk .nn{color:#a89a78;font-family:'JetBrains Mono',monospace;font-size:.62rem;margin-left:.2rem}
.ee .distk.more{color:#a89a78;font-style:italic}
.ee .dist-note{font-family:'JetBrains Mono',monospace;font-size:.56rem;letter-spacing:.04em;color:#b0a890}
.ee .subtle{font-size:.82rem;color:#7a7060}
.ee .proxy{font-size:.84rem;color:#5a5246}
.ee .proxy-lvl{font-family:'JetBrains Mono',monospace;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:#8b5b5b;background:#f6eded;border-radius:5px;padding:.2rem .45rem}
.ee .proxy-note{color:#7a7060}
.ee .hand2{margin:2rem 0 .5rem;background:repeating-linear-gradient(135deg,#faf8f4,#faf8f4 10px,#f6f2e9 10px,#f6f2e9 20px);border:1px dashed #d8cdb5;border-radius:13px;padding:1.4rem 1.5rem}
.ee .hand2-body{font-size:.95rem;color:#7a7060;font-style:italic;max-width:560px}
.ee .chat{margin:2rem 0 .5rem}
.ee .chat-intro{font-size:.9rem;color:#7a7060;max-width:560px;margin-bottom:1rem}
.ee .chat-suggest{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem}
.ee .suggest{text-align:left;font-family:inherit;font-size:.82rem;color:#6b5d3e;background:#fff;border:1px solid #e8e2d8;border-radius:999px;padding:.45rem .9rem;cursor:pointer;transition:border-color .15s,background .15s}
.ee .suggest:hover:not(:disabled),.ee .suggest:focus-visible{border-color:#8b6f3a;background:#fffdf8;outline:none}
.ee .suggest:disabled{opacity:.5;cursor:default}
.ee .chat-log{display:flex;flex-direction:column;gap:.7rem;margin-bottom:1rem}
.ee .bubble{max-width:88%;padding:.75rem 1rem;border-radius:13px;font-size:.92rem;line-height:1.65;white-space:pre-wrap;word-wrap:break-word}
.ee .bubble.user{align-self:flex-end;background:#f0ebdf;color:#2a2520;border-bottom-right-radius:4px}
.ee .bubble.assistant{align-self:flex-start;background:#fff;border:1px solid #e8e2d8;color:#3a352c;border-bottom-left-radius:4px}
.ee .bubble.pending{padding:.9rem 1rem}
.ee .dots span{display:inline-block;width:5px;height:5px;border-radius:50%;background:#b0a890;margin:0 2px;animation:eedot 1.2s infinite}
.ee .dots span:nth-child(2){animation-delay:.2s}
.ee .dots span:nth-child(3){animation-delay:.4s}
@keyframes eedot{0%,80%,100%{transform:scale(.6);opacity:.3}40%{transform:scale(1);opacity:1}}
.ee .chat-input-row{display:flex;gap:.6rem;align-items:flex-end}
.ee .chat-input{flex:1;font-family:Georgia,serif;font-size:.92rem;color:#2a2520;background:#fff;border:1px solid #e8e2d8;border-radius:10px;padding:.7rem .9rem;outline:none;resize:none;min-height:46px;max-height:160px;line-height:1.5;transition:border-color .15s}
.ee .chat-input:focus{border-color:#8b6f3a}
.ee .chat-input::placeholder{color:#b0a890;font-style:italic}
.ee .chat-send{font-family:'JetBrains Mono',monospace;font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;color:#faf8f4;background:#2a2520;border:none;border-radius:10px;padding:0 1.3rem;height:46px;cursor:pointer;transition:background .15s}
.ee .chat-send:hover:not(:disabled){background:#3d352a}
.ee .chat-send:disabled{background:#d0c8b8;cursor:default}
.ee .chat-note{font-family:'JetBrains Mono',monospace;font-size:.56rem;letter-spacing:.06em;color:#b0a890;margin-top:.6rem}
.ee .privacy{max-width:760px;margin:0 auto;padding:2.5rem 2rem 1rem;border-top:1px solid #e8e2d8}
.ee .privacy h3{font-family:'Cormorant Garamond',serif;font-weight:500;font-size:1.15rem;color:#2a2520;margin-bottom:.6rem}
.ee .privacy p{font-size:.88rem;color:#7a7060;max-width:620px}
.ee .footer{max-width:760px;margin:0 auto;padding:2rem;text-align:left}
.ee .footer p{font-size:.8rem;color:#8a8070;max-width:620px;margin-bottom:.6rem}
.ee .footer .legal{font-family:'JetBrains Mono',monospace;font-size:.56rem;letter-spacing:.12em;color:#b0a890}
@media(max-width:760px){
  .ee .hero{padding:3rem 1.3rem 2rem}
  .ee .hero h1{font-size:2.1rem}
  .ee .paths{grid-template-columns:1fr;padding:1rem 1.3rem}
  .ee .read,.ee .status{padding-left:1.3rem;padding-right:1.3rem}
  .ee .hdr{padding:.9rem 1.2rem}
}
`;
