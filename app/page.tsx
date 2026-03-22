"use client";
import { useState, useRef, useEffect } from "react";
import InferenceMap from "./components/InferenceMap";
import SemanticProfile from "./components/SemanticProfile";

function getApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("rgd_api_key") || "";
}
function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  const key = getApiKey();
  return { ...(key ? { "X-Api-Key": key } : {}), ...extra };
}

type Session = {
  id: string; name: string; dataset_id: string; vintage: number;
  variable_count: number; concept_count: number; moe_coverage: number;
  connector?: string;
};
type SemanticColumn = {
  column: string;
  semantic_type: string;
  collection_method: string;
  null_semantics: string;
  cardinality_class: string;
  referential_dependencies: string[];
  proxy_risk: string;
  proxy_risk_note: string;
  lineage_note: string;
};
type DatasetProfile = {
  semantic_columns: SemanticColumn[];
  grain: string;
  dataset_class: string;
  analytical_scope: string;
  use_limitations: string[];
};
type ConnectResult = {
  session_id: string; name: string; variable_count: number;
  concept_count: number; moe_coverage: number; geographies: string[];
  profile: { absences: Array<{ domain: string; absence: string; significance: string }>; lens_summary: string };
  semantic_profile?: DatasetProfile;
  row_count?: number; tables?: string[];
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
  const [hasKey, setHasKey] = useState<boolean>(true);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ConnectResult | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [customDataset, setCustomDataset] = useState("");
  const [customVintage, setCustomVintage] = useState("2023");
  const [dbString, setDbString] = useState("");
  const [dbName, setDbName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [homeTab, setHomeTab] = useState<"census"|"upload"|"postgres">("census");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const key = getApiKey();
    setHasKey(!!key);
    if (!key) return;
    fetch("/api/sessions", { headers: apiHeaders() }).then(r => r.json()).then(d => setSessions(d.sessions || []));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function connectDataset(dataset_id: string, vintage: number, name: string) {
    setConnecting(true); setConnectError(null); setStage("connecting");
    try {
      const res = await fetch("/api/connect", {
        method: "POST", headers: apiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ dataset_id, vintage, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection failed");
      openSession(data, name);
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Failed"); setStage("home");
    } finally { setConnecting(false); }
  }

  async function uploadCSV() {
    if (!uploadFile) return;
    setUploading(true); setConnectError(null); setStage("connecting");
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      const res = await fetch("/api/upload", { method: "POST", headers: apiHeaders(), body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      openSession(data, uploadFile.name.replace(/\.[^.]+$/, ""));
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Upload failed"); setStage("home");
    } finally { setUploading(false); }
  }

  async function connectPostgres() {
    if (!dbString.trim()) return;
    setConnecting(true); setConnectError(null); setStage("connecting");
    try {
      const res = await fetch("/api/db-connect", {
        method: "POST", headers: apiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ connection_string: dbString, name: dbName || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection failed");
      openSession(data, dbName || "PostgreSQL database");
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Connection failed"); setStage("home");
    } finally { setConnecting(false); }
  }

  function openSession(data: ConnectResult, name: string) {
    setActiveSession(data);
    const rowNote = data.row_count ? ` across ${data.row_count.toLocaleString()} rows` : "";
    const tableNote = data.tables ? ` in ${data.tables.length} table${data.tables.length > 1 ? "s" : ""}` : "";
    setMessages([{ role: "assistant", content: `I've read the structure of **${data.name || name}**.\n\n${data.variable_count.toLocaleString()} variables across ${data.concept_count} concept domains${rowNote}${tableNote}. What do you want to understand about it?` }]);
    setStage("chat");
    fetch("/api/sessions", { headers: apiHeaders() }).then(r => r.json()).then(d => setSessions(d.sessions || []));
  }

  async function sendMessage() {
    if (!input.trim() || !activeSession || sending) return;
    const userMsg = input.trim(); setInput("");
    setMessages(m => [...m, { role: "user", content: userMsg }]);
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: apiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ session_id: activeSession.session_id, message: userMsg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessages(m => [...m, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setMessages(m => [...m, { role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Unknown"}` }]);
    } finally { setSending(false); }
  }

  async function resumeSession(s: Session) {
    try {
      const res = await fetch(`/api/session?session_id=${s.id}`, { headers: apiHeaders() });
      if (!res.ok) throw new Error("Failed to load session");
      const data = await res.json() as ConnectResult;
      setActiveSession(data);
      setMessages([{ role: "assistant", content: `Resuming **${s.name}**. What do you want to understand about it?` }]);
      setStage("chat");
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Failed to load session");
    }
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
    .home-sub{font-size:0.95rem;line-height:1.85;color:#5a6070;max-width:560px;margin-bottom:2.5rem;font-family:'Georgia',serif}
    .tab-row{display:flex;gap:0;margin-bottom:2rem;border-bottom:1px solid rgba(180,150,90,0.1)}
    .tab{padding:0.6rem 1.4rem;background:none;border:none;border-bottom:2px solid transparent;color:#3a3f50;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;transition:all 0.15s;margin-bottom:-1px}
    .tab:hover{color:#7a7f8a}
    .tab.active{color:#c8a96e;border-bottom-color:#c8a96e}
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
    .field-input.wide{width:480px}
    .rg-btn{padding:0.65rem 1.5rem;background:transparent;border:1px solid #c8a96e;color:#c8a96e;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;transition:all 0.2s;white-space:nowrap}
    .rg-btn:hover:not(:disabled){background:rgba(200,169,110,0.07)}
    .rg-btn:disabled{border-color:#252a35;color:#252a35;cursor:not-allowed}
    .upload-zone{border:1px dashed rgba(180,150,90,0.2);padding:2.5rem;text-align:center;cursor:pointer;transition:all 0.2s;margin-bottom:1.5rem;background:rgba(255,255,255,0.01)}
    .upload-zone:hover{border-color:rgba(200,169,110,0.4);background:rgba(200,169,110,0.02)}
    .upload-zone.has-file{border-color:rgba(200,169,110,0.35);background:rgba(200,169,110,0.03)}
    .uz-icon{font-size:1.8rem;margin-bottom:0.6rem;opacity:0.4}
    .uz-label{font-family:'Cormorant Garamond',serif;font-size:1rem;color:#9a9880;margin-bottom:0.3rem}
    .uz-sub{font-family:'JetBrains Mono',monospace;font-size:0.58rem;color:#3a3f50;letter-spacing:0.1em}
    .uz-filename{font-family:'JetBrains Mono',monospace;font-size:0.7rem;color:#c8a96e;margin-top:0.5rem}
    .pg-form{display:flex;flex-direction:column;gap:1rem;max-width:560px;margin-bottom:2rem}
    .pg-note{font-family:'JetBrains Mono',monospace;font-size:0.58rem;color:#252a35;letter-spacing:0.08em;line-height:1.7;margin-top:-0.3rem}
    .prior-title{font-family:'JetBrains Mono',monospace;font-size:0.58rem;letter-spacing:0.25em;color:#252a35;text-transform:uppercase;margin-bottom:0.9rem}
    .prior-list{display:flex;flex-direction:column;gap:1px}
    .prior-item{display:flex;align-items:center;justify-content:space-between;padding:0.7rem 1rem;background:rgba(255,255,255,0.01);border:1px solid rgba(180,150,90,0.06);cursor:pointer;transition:background 0.15s}
    .prior-item:hover{background:rgba(200,169,110,0.03)}
    .prior-name{font-family:'Cormorant Garamond',serif;font-size:0.95rem;color:#9a9880}
    .prior-meta{font-family:'JetBrains Mono',monospace;font-size:0.58rem;color:#252a35;letter-spacing:0.08em}
    .connector-badge{font-size:0.5rem;padding:0.15rem 0.4rem;border:1px solid rgba(180,150,90,0.15);color:#3a4050;font-family:'JetBrains Mono',monospace;letter-spacing:0.15em;text-transform:uppercase;margin-right:0.5rem}
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
    .dots span:nth-child(2){animation-delay:0.2s}.dots span:nth-child(3){animation-delay:0.4s}
    @keyframes dot{0%,80%,100%{transform:scale(0.6);opacity:0.3}40%{transform:scale(1);opacity:1}}
  `;

  const connectingLabel = homeTab === "upload"
    ? "Reading your CSV" : homeTab === "postgres"
    ? "Introspecting database schema" : "Reading dataset structure";

  const connectingSub = homeTab === "upload"
    ? "parsing columns · inferring types · detecting absences"
    : homeTab === "postgres"
    ? "connecting · reading schema · profiling tables"
    : "fetching variable manifest · profiling concepts · detecting absences";

  return (
    <div style={{ minHeight: "100vh", background: "#07090f", color: "#c4c8d4" }}>
      <style>{CSS}</style>
      <header className="rg-header">
        <div className="rg-mark">Rose Glass</div>
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
          <div className="rg-tag">Translation · Not Judgment</div>
          <a href="/login" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "0.58rem", letterSpacing: "0.15em", color: hasKey ? "#3a3f50" : "#c8a96e", textDecoration: "none", border: hasKey ? "none" : "1px solid rgba(200,169,110,0.35)", padding: hasKey ? "0" : "0.3rem 0.8rem", transition: "color 0.15s" }}>
            {hasKey ? "Account" : "Sign In · Register"}
          </a>
        </div>
      </header>

      {stage === "home" && (
        <div className="home">
          <h1 className="home-lede">What does this database <em>believe</em><br />about the world it measures?</h1>
          <p className="home-sub">Connect a public dataset or upload your own. Rose Glass reads its structure — what it tracks, what it avoids, and what worldview is baked into how it counts.</p>
          {!hasKey && (
            <div style={{ background: "rgba(200,169,110,0.04)", border: "1px solid rgba(200,169,110,0.2)", padding: "1.5rem 2rem", marginBottom: "2.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
              <div>
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "1.1rem", color: "#d4c8a0", marginBottom: "0.3rem" }}>Create a free account to get started</div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "0.6rem", color: "#3a3f50", letterSpacing: "0.1em", lineHeight: 1.7 }}>10,000 free tokens · no credit card required · upgrade anytime</div>
              </div>
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <a href="/login?tab=signup" style={{ padding: "0.6rem 1.4rem", background: "transparent", border: "1px solid #c8a96e", color: "#c8a96e", fontFamily: "'JetBrains Mono',monospace", fontSize: "0.62rem", letterSpacing: "0.18em", textTransform: "uppercase", textDecoration: "none", whiteSpace: "nowrap" }}>Create account</a>
                <a href="/login" style={{ padding: "0.6rem 1.4rem", background: "transparent", border: "1px solid rgba(180,150,90,0.2)", color: "#5a6070", fontFamily: "'JetBrains Mono',monospace", fontSize: "0.62rem", letterSpacing: "0.18em", textTransform: "uppercase", textDecoration: "none", whiteSpace: "nowrap" }}>Sign in</a>
              </div>
            </div>
          )}
          {connectError && <div className="err">{connectError}</div>}

          <div className="tab-row">
            {(["census","upload","postgres"] as const).map(t => (
              <button key={t} className={`tab ${homeTab === t ? "active" : ""}`} onClick={() => setHomeTab(t)}>
                {t === "census" ? "Public Data" : t === "upload" ? "Upload CSV" : "PostgreSQL"}
              </button>
            ))}
          </div>

          {homeTab === "census" && (<>
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
              <div><label className="field-label">Custom dataset ID</label>
                <input className="field-input" value={customDataset} onChange={e => setCustomDataset(e.target.value)} placeholder="e.g. acs/acs5" /></div>
              <div><label className="field-label">Vintage</label>
                <input className="field-input short" value={customVintage} onChange={e => setCustomVintage(e.target.value)} placeholder="2023" /></div>
              <button className="rg-btn" onClick={() => connectDataset(customDataset, parseInt(customVintage), `${customDataset} ${customVintage}`)} disabled={connecting || !customDataset.trim()}>Connect</button>
            </div>
          </>)}

          {homeTab === "upload" && (
            <div style={{ maxWidth: 560, marginBottom: "3rem" }}>
              <div className="upload-zone has-file" onClick={() => fileInputRef.current?.click()}>
                <div className="uz-icon">⬆</div>
                <div className="uz-label">{uploadFile ? uploadFile.name : "Drop a CSV or click to browse"}</div>
                <div className="uz-sub">{uploadFile ? `${(uploadFile.size / 1024).toFixed(0)} KB` : "CSV files up to 50MB"}</div>
                {uploadFile && <div className="uz-filename">Ready to profile</div>}
              </div>
              <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }}
                onChange={e => { if (e.target.files?.[0]) setUploadFile(e.target.files[0]); }} />
              <button className="rg-btn" onClick={uploadCSV} disabled={!uploadFile || uploading}>
                {uploading ? "Profiling…" : "Profile this dataset →"}
              </button>
              <p style={{ marginTop: "1rem", fontFamily: "'JetBrains Mono',monospace", fontSize: "0.6rem", color: "#252a35", lineHeight: 1.7 }}>
                Rose Glass will read your column structure, infer what domains are present, detect what is absent, and open a conversation about what the dataset believes about the world it measures.
              </p>
            </div>
          )}

          {homeTab === "postgres" && (
            <div className="pg-form">
              <div>
                <label className="field-label">Connection string</label>
                <input className="field-input wide" type="password" value={dbString}
                  onChange={e => setDbString(e.target.value)}
                  placeholder="postgresql://user:password@host:5432/dbname" />
                <div className="pg-note" style={{ marginTop: "0.4rem" }}>Connection used in-flight only. Never stored. Public schema introspected.</div>
              </div>
              <div>
                <label className="field-label">Dataset name (optional)</label>
                <input className="field-input" value={dbName} onChange={e => setDbName(e.target.value)} placeholder="e.g. Recovery App Database" />
              </div>
              <button className="rg-btn" onClick={connectPostgres} disabled={connecting || !dbString.trim()}>
                {connecting ? "Connecting…" : "Connect →"}
              </button>
            </div>
          )}

          {sessions.length > 0 && (
            <div>
              <div className="prior-title">Prior sessions</div>
              <div className="prior-list">
                {sessions.map(s => (
                  <div key={s.id} className="prior-item" onClick={() => resumeSession(s)}>
                    <span className="prior-name">
                      <span className="connector-badge">{s.connector || "census"}</span>
                      {s.name}
                    </span>
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
          <div className="conn-title">{connectingLabel}</div>
          <div className="conn-sub">{connectingSub}</div>
        </div>
      )}

      {stage === "chat" && activeSession && (
        <div className="chat-wrap">
          <aside className="sidebar">
            <div className="sb-name">{activeSession.name}</div>
            <div className="sb-meta">
              {activeSession.variable_count?.toLocaleString()} variables<br />
              {activeSession.concept_count} concept domains<br />
              {activeSession.moe_coverage > 0 ? `${activeSession.moe_coverage}% error margin coverage` : ""}
            </div>
            <hr className="sb-hr" />
            <div className="sb-section">Ask about</div>
            {STARTERS.map(q => (
              <button key={q} className="starter" onClick={() => setInput(q)}>{q}</button>
            ))}
            <hr className="sb-hr" />
            {activeSession.semantic_profile && (
              <SemanticProfile profile={activeSession.semantic_profile} />
            )}
            {activeSession.semantic_profile && <hr className="sb-hr" />}
            {activeSession.profile?.absences?.length > 0 && (
              <InferenceMap
                absences={activeSession.profile.absences}
                lens_summary={activeSession.profile.lens_summary}
                datasetName={activeSession.name}
              />
            )}
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
              <textarea className="chat-input" value={input} onChange={e => setInput(e.target.value)}
                placeholder="Ask anything about this dataset…"
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                rows={1} />
              <button className="rg-btn" onClick={sendMessage} disabled={sending || !input.trim()}>Send</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
