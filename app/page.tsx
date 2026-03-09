"use client";
import { useState, useRef, useEffect } from "react";

type Session = {
  id: string; name: string; dataset_id: string; vintage: number;
  variable_count: number; concept_count: number; moe_coverage: number;
};
type ConnectResult = {
  session_id: string; name: string; variable_count: number;
  concept_count: number; moe_coverage: number; geographies: string[];
  profile: { absences: Array<{ domain: string; absence: string; significance: string }>; lens_summary: string };
};
type Message = { role: "user" | "assistant"; content: string };

const PRESETS = [
  { label: "ACS 5-Year 2023", dataset_id: "acs/acs5", vintage: 2023, desc: "Social, economic, housing — 20,000+ variables across all geographies" },
  { label: "ACS 1-Year 2023", dataset_id: "acs/acs1", vintage: 2023, desc: "Annual estimates for large populations (65,000+)" },
  { label: "Decennial Census 2020", dataset_id: "dec/dhc", vintage: 2020, desc: "Full enumeration — race, age, household structure" },
  { label: "Population Estimates 2023", dataset_id: "pep/charv", vintage: 2023, desc: "Births, deaths, migration — demographic change tracking" },
];

const STARTERS = [
  "What does this data not measure?",
  "What assumptions are baked into how it counts?",
  "Where would you not trust this data?",
  "Whose reality is most visible here?",
  "What would a skeptic say about how this was built?",
  "What's the most politically charged thing this dataset does?",
];

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stage, setStage] = useState<"home" | "connecting" | "chat">("home");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ConnectResult | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [customDataset, setCustomDataset] = useState("");
  const [customVintage, setCustomVintage] = useState("2023");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/sessions").then(r => r.json()).then(d => setSessions(d.sessions || []));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function connectDataset(dataset_id: string, vintage: number, name: string) {
    setConnecting(true); setConnectError(null); setStage("connecting");
    try {
      const res = await fetch("/api/connect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset_id, vintage, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection failed");
      setActiveSession(data);
      setMessages([{ role: "assistant", content: `I've read the structure of **${data.name}**.\n\n${data.variable_count.toLocaleString()} variables across ${data.concept_count} concept domains. What do you want to understand about it?` }]);
      setStage("chat");
      fetch("/api/sessions").then(r => r.json()).then(d => setSessions(d.sessions || []));
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Failed"); setStage("home");
    } finally { setConnecting(false); }
  }

  async function sendMessage() {
    if (!input.trim() || !activeSession || sending) return;
    const userMsg = input.trim(); setInput("");
    setMessages(m => [...m, { role: "user", content: userMsg }]);
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: activeSession.session_id, message: userMsg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessages(m => [...m, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setMessages(m => [...m, { role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Unknown"}` }]);
    } finally { setSending(false); }
  }

  function resumeSession(s: Session) {
    setActiveSession({ session_id: s.id, name: s.name, variable_count: s.variable_count, concept_count: s.concept_count, moe_coverage: s.moe_coverage, geographies: [], profile: { absences: [], lens_summary: "" } });
    setMessages([{ role: "assistant", content: `Resuming **${s.name}**. What do you want to understand about it?` }]);
    setStage("chat");
  }

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=JetBrains+Mono:wght@300;400&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#07090f}
    .rg-header{border-bottom:1px solid rgba(180,150,90,0.12);padding:1.1rem 2rem;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;background:rgba(7,9,15,0.96);backdrop-filter:blur(12px)}
    .rg-mark{font-family:'Cormorant Garamond',serif;font-size:1.05rem;font-weight:300;letter-spacing:0.3em;text-transform:uppercase;color:#c8a96e}
    .rg-tag{font-family:'JetBrains Mono',monospace;font-size:0.55rem;letter-spacing:0.3em;color:#2a2f3a;text-transform:uppercase}
    .home{max-width:880px;margin:0 auto;padding:4rem 2rem}
    .home-lede{font-family:'Cormorant Garamond',serif;font-size:2.5rem;font-weight:300;line-height:1.3;color:#e8dfc8;margin-bottom:1.5rem;letter-spacing:0.02em}
    .home-lede em{color:#c8a96e;font-style:italic}
    .home-sub{font-size:0.95rem;line-height:1.85;color:#5a6070;max-width:560px;margin-bottom:3.5rem;font-family:'Georgia',serif}
    .preset-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:1px;background:rgba(180,150,90,0.08);border:1px solid rgba(180,150,90,0.08);margin-bottom:2.5rem}
    .preset-card{background:#07090f;padding:1.5rem;cursor:pointer;transition:background 0.2s;border:none;text-align:left;color:inherit;width:100%}
    .preset-card:hover{background:rgba(200,169,110,0.04)}
    .preset-card:disabled{opacity:0.35;cursor:not-allowed}
    .pc-label{font-family:'Cormorant Garamond',serif;font-size:1.1rem;color:#d4c8a0;margin-bottom:0.4rem}
    .pc-desc{font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#3a3f50;letter-spacing:0.08em;line-height:1.6}
    .pc-cta{font-size:0.75rem;color:#c8a96e;opacity:0;transition:opacity 0.2s;margin-top:0.6rem;display:block;font-family:'JetBrains Mono',monospace;letter-spacing:0.1em}
    .preset-card:hover .pc-cta{opacity:1}
    .custom-row{display:flex;gap:0.75rem;align-items:flex-end;flex-wrap:wrap;margin-bottom:3rem}
    .field-label{font-family:'JetBrains Mono',monospace;font-size:0.58rem;letter-spacing:0.2em;color:#2a2f3a;text-transform:uppercase;display:block;margin-bottom:0.35rem}
    .field-input{background:rgba(255,255,255,0.02);border:1px solid rgba(180,150,90,0.12);color:#c4c8d4;padding:0.65rem 0.9rem;font-family:'JetBrains Mono',monospace;font-size:0.72rem;outline:none;width:260px;transition:border-color 0.2s}
    .field-input:focus{border-color:rgba(200,169,110,0.35)}
    .field-input.short{width:100px}
    .rg-btn{padding:0.65rem 1.5rem;background:transparent;border:1px solid #c8a96e;color:#c8a96e;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;transition:all 0.2s;white-space:nowrap}
    .rg-btn:hover:not(:disabled){background:rgba(200,169,110,0.07)}
    .rg-btn:disabled{border-color:#252a35;color:#252a35;cursor:not-allowed}
    .prior-title{font-family:'JetBrains Mono',monospace;font-size:0.58rem;letter-spacing:0.25em;color:#252a35;text-transform:uppercase;margin-bottom:0.9rem}
    .prior-list{display:flex;flex-direction:column;gap:1px}
    .prior-item{display:flex;align-items:center;justify-content:space-between;padding:0.7rem 1rem;background:rgba(255,255,255,0.01);border:1px solid rgba(180,150,90,0.06);cursor:pointer;transition:background 0.15s}
    .prior-item:hover{background:rgba(200,169,110,0.03)}
    .prior-name{font-family:'Cormorant Garamond',serif;font-size:0.95rem;color:#9a9880}
    .prior-meta{font-family:'JetBrains Mono',monospace;font-size:0.58rem;color:#252a35;letter-spacing:0.08em}
    .connecting{max-width:600px;margin:0 auto;padding:7rem 2rem;text-align:center}
    .conn-title{font-family:'Cormorant Garamond',serif;font-size:1.6rem;color:#c8a96e;margin-bottom:1rem;font-weight:300}
    .conn-sub{font-family:'JetBrains Mono',monospace;font-size:0.62rem;color:#3a3f50;letter-spacing:0.2em;animation:blink 1.4s infinite}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:0.25}}
    .chat-wrap{display:flex;height:calc(100vh - 54px)}
    .sidebar{width:255px;flex-shrink:0;border-right:1px solid rgba(180,150,90,0.08);padding:1.5rem 1.25rem;overflow-y:auto;background:#07090f}
    .sb-name{font-family:'Cormorant Garamond',serif;font-size:1rem;color:#d0c898;margin-bottom:0.4rem}
    .sb-meta{font-family:'JetBrains Mono',monospace;font-size:0.58rem;color:#2a2f3a;letter-spacing:0.08em;line-height:1.9}
    .sb-hr{border:none;border-top:1px solid rgba(180,150,90,0.07);margin:1.2rem 0}
    .sb-section{font-family:'JetBrains Mono',monospace;font-size:0.55rem;letter-spacing:0.25em;color:#252a35;text-transform:uppercase;margin-bottom:0.7rem}
    .starter{display:block;width:100%;text-align:left;padding:0.55rem 0.7rem;margin-bottom:3px;background:rgba(255,255,255,0.01);border:1px solid rgba(180,150,90,0.05);color:#5a6070;cursor:pointer;font-family:'Georgia',serif;font-size:0.78rem;line-height:1.4;transition:all 0.15s}
    .starter:hover{border-color:rgba(200,169,110,0.15);color:#9a9880}
    .back{margin-top:1.2rem;padding:0.4rem 0;background:none;border:none;color:#252a35;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:0.58rem;letter-spacing:0.15em;text-transform:uppercase;transition:color 0.15s}
    .back:hover{color:#c8a96e}
    .chat-main{flex:1;display:flex;flex-direction:column;min-width:0}
    .messages{flex:1;overflow-y:auto;padding:2rem;display:flex;flex-direction:column;gap:1.5rem}
    .msg{max-width:740px;line-height:1.75}
    .msg-user{align-self:flex-end;background:rgba(200,169,110,0.05);border:1px solid rgba(200,169,110,0.1);padding:0.7rem 1.2rem;font-size:0.95rem;color:#c4c8d4;font-family:'Georgia',serif}
    .msg-assistant{align-self:flex-start;font-family:'Cormorant Garamond',serif;font-size:1.05rem;color:#a8acb8}
    .msg-assistant strong{color:#d0c898;font-weight:500}
    .msg-assistant em{color:#c8a96e;font-style:italic}
    .input-row{border-top:1px solid rgba(180,150,90,0.08);padding:1.2rem 2rem;display:flex;gap:0.75rem;align-items:flex-end;background:rgba(7,9,15,0.97)}
    .chat-input{flex:1;background:rgba(255,255,255,0.02);border:1px solid rgba(180,150,90,0.12);color:#c4c8d4;padding:0.7rem 1rem;font-family:'Georgia',serif;font-size:0.93rem;outline:none;resize:none;min-height:46px;max-height:160px;line-height:1.5;transition:border-color 0.2s}
    .chat-input:focus{border-color:rgba(200,169,110,0.3)}
    .chat-input::placeholder{color:#252a35;font-style:italic}
    .err{background:rgba(180,60,60,0.06);border:1px solid rgba(180,60,60,0.18);padding:0.7rem 1rem;margin-bottom:1.5rem;font-family:'JetBrains Mono',monospace;font-size:0.67rem;color:#b06060}
    .dots span{display:inline-block;width:4px;height:4px;border-radius:50%;background:#c8a96e;margin:0 2px;animation:dot 1.2s infinite}
    .dots span:nth-child(2){animation-delay:0.2s}
    .dots span:nth-child(3){animation-delay:0.4s}
    @keyframes dot{0%,80%,100%{transform:scale(0.6);opacity:0.3}40%{transform:scale(1);opacity:1}}
  `;

  return (
    <div style={{ minHeight: "100vh", background: "#07090f", color: "#c4c8d4", fontFamily: "'Georgia',serif" }}>
      <style>{CSS}</style>
      <header className="rg-header">
        <div className="rg-mark">Rose Glass</div>
        <div className="rg-tag">Translation · Not Judgment</div>
      </header>

      {stage === "home" && (
        <div className="home">
          <h1 className="home-lede">What does this database <em>believe</em><br />about the world it measures?</h1>
          <p className="home-sub">Connect a public dataset. Rose Glass reads its structure — what it tracks, what it avoids, and what worldview is baked into how it counts. Then talk to it.</p>
          {connectError && <div className="err">{connectError}</div>}
          <div className="preset-grid">
            {PRESETS.map(ds => (
              <button key={ds.dataset_id} className="preset-card" onClick={() => connectDataset(ds.dataset_id, ds.vintage, ds.label)} disabled={connecting}>
                <div className="pc-label">{ds.label}</div>
                <div className="pc-desc">{ds.desc}</div>
                <span className="pc-cta">Connect →</span>
              </button>
            ))}
          </div>
          <div className="custom-row">
            <div>
              <label className="field-label">Custom dataset ID</label>
              <input className="field-input" value={customDataset} onChange={e => setCustomDataset(e.target.value)} placeholder="e.g. acs/acs5" />
            </div>
            <div>
              <label className="field-label">Vintage</label>
              <input className="field-input short" value={customVintage} onChange={e => setCustomVintage(e.target.value)} placeholder="2023" />
            </div>
            <button className="rg-btn" onClick={() => connectDataset(customDataset, parseInt(customVintage), `${customDataset} ${customVintage}`)} disabled={connecting || !customDataset.trim()}>Connect</button>
          </div>
          {sessions.length > 0 && (
            <div>
              <div className="prior-title">Prior sessions</div>
              <div className="prior-list">
                {sessions.map(s => (
                  <div key={s.id} className="prior-item" onClick={() => resumeSession(s)}>
                    <span className="prior-name">{s.name}</span>
                    <span className="prior-meta">{s.variable_count?.toLocaleString()} vars · {s.vintage}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {stage === "connecting" && (
        <div className="connecting">
          <div className="conn-title">Reading dataset structure</div>
          <div className="conn-sub">fetching variable manifest · profiling concepts · detecting absences</div>
        </div>
      )}

      {stage === "chat" && activeSession && (
        <div className="chat-wrap">
          <aside className="sidebar">
            <div className="sb-name">{activeSession.name}</div>
            <div className="sb-meta">
              {activeSession.variable_count?.toLocaleString()} variables<br />
              {activeSession.concept_count} concept domains<br />
              {activeSession.moe_coverage}% error margin coverage
            </div>
            <hr className="sb-hr" />
            <div className="sb-section">Ask about</div>
            {STARTERS.map(q => (
              <button key={q} className="starter" onClick={() => setInput(q)}>{q}</button>
            ))}
            <hr className="sb-hr" />
            <button className="back" onClick={() => setStage("home")}>← New dataset</button>
          </aside>
          <div className="chat-main">
            <div className="messages">
              {messages.map((m, i) => (
                <div key={i} className={`msg msg-${m.role}`}>
                  {m.content.split("\n").map((line, j) => (
                    <span key={j} dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>") }} style={{ display: "block" }} />
                  ))}
                </div>
              ))}
              {sending && <div className="msg msg-assistant"><div className="dots"><span/><span/><span/></div></div>}
              <div ref={chatEndRef} />
            </div>
            <div className="input-row">
              <textarea className="chat-input" value={input} onChange={e => setInput(e.target.value)} placeholder="Ask anything about this dataset…" onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} rows={1} />
              <button className="rg-btn" onClick={sendMessage} disabled={sending || !input.trim()}>Send</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
