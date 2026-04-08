"use client";
import { useState, useRef, useEffect } from "react";
import InferenceMap from "./components/InferenceMap";
import SemanticProfile from "./components/SemanticProfile";
import CoherenceScore from "./components/CoherenceScore";
import CoachPanel, { type Recommendation } from "./components/CoachPanel";
import SidebarCollapse from "./components/SidebarCollapse";

function getApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("rgd_api_key") || "";
}
function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  const key = getApiKey();
  return { ...(key ? { "X-Api-Key": key } : {}), ...extra };
}

function renderMarkdown(text: string): string {
  // Code blocks
  let html = text.replace(/```[\s\S]*?```/g, (match) => {
    const inner = match.slice(3, -3).replace(/^\w*\n/, "");
    return `<pre style="background:rgba(255,255,255,0.03);border:1px solid rgba(180,150,90,0.08);padding:0.6rem 0.8rem;font-family:'JetBrains Mono',monospace;font-size:0.72rem;overflow-x:auto;margin:0.5rem 0;color:#8a8f9a;line-height:1.6">${inner.replace(/</g,"&lt;")}</pre>`;
  });
  // Inline code
  html = html.replace(/`([^`]+)`/g,
    '<code style="background:rgba(255,255,255,0.04);padding:0.1rem 0.35rem;font-family:\'JetBrains Mono\',monospace;font-size:0.82em;color:#c8a96e">$1</code>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Bullet lists
  html = html.replace(/^[-•]\s+(.+)$/gm,
    '<div style="padding-left:1rem;margin:0.15rem 0;position:relative"><span style="position:absolute;left:0.2rem;color:#5a6070">·</span>$1</div>');
  // Numbered lists
  html = html.replace(/^(\d+)\.\s+(.+)$/gm,
    '<div style="padding-left:1.2rem;margin:0.15rem 0;position:relative"><span style="position:absolute;left:0;color:#5a6070;font-size:0.85em">$1.</span>$2</div>');
  // Line breaks (double newline = paragraph, single = br)
  html = html.replace(/\n\n+/g, '<div style="height:0.6rem"></div>');
  html = html.replace(/\n/g, "<br/>");
  return html;
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
  const [dragOver, setDragOver] = useState(false);
  const [coachRecs, setCoachRecs] = useState<Recommendation[]>([]);
  const [coachLoading, setCoachLoading] = useState(false);
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
    setCoachRecs([]);
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
      setCoachRecs([]);
      setStage("chat");
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Failed to load session");
    }
  }

  async function requestCoaching(axes: Array<{ label: string; key: string; score: number; explanation: string }>) {
    if (!activeSession || coachLoading) return;
    setCoachLoading(true);
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: apiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ session_id: activeSession.session_id, axes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Coach failed");
      setCoachRecs(data.recommendations || []);
    } catch (err) {
      console.error("Coach error:", err);
    } finally { setCoachLoading(false); }
  }

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=JetBrains+Mono:wght@300;400&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#faf8f4}
    .rg-header{border-bottom:1px solid #e8e2d8;padding:1.1rem 2rem;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;background:rgba(250,248,244,0.97);backdrop-filter:blur(12px)}
    .rg-mark{font-family:'Cormorant Garamond',serif;font-size:1.05rem;font-weight:400;letter-spacing:0.25em;text-transform:uppercase;color:#6b5d3e}
    .rg-tag{font-family:'JetBrains Mono',monospace;font-size:0.55rem;letter-spacing:0.25em;color:#b0a890;text-transform:uppercase}
    .home{max-width:720px;margin:0 auto;padding:6rem 2rem 4rem}
    .home-lede{font-family:'Cormorant Garamond',serif;font-size:2.8rem;font-weight:300;line-height:1.25;color:#2a2520;margin-bottom:1.5rem;letter-spacing:0.01em;animation:fadeUp 0.5s ease both}
    .home-lede em{color:#8b6f3a;font-style:italic}
    .home-sub{font-size:0.95rem;line-height:1.9;color:#7a7060;max-width:520px;margin-bottom:3.5rem;font-family:'Georgia',serif;animation:fadeUp 0.5s ease 0.08s both}
    @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    .home-actions{display:flex;flex-direction:column;gap:2.5rem;animation:fadeUp 0.5s ease 0.15s both}
    .demo-btn{padding:1rem 2rem;background:#2a2520;border:none;color:#faf8f4;cursor:pointer;font-family:'Cormorant Garamond',serif;font-size:1.15rem;font-weight:400;letter-spacing:0.05em;transition:all 0.2s;text-align:left;display:flex;align-items:center;justify-content:space-between}
    .demo-btn:hover{background:#3d352a}
    .demo-btn:disabled{opacity:0.4;cursor:not-allowed}
    .demo-btn span{font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#b0a890;letter-spacing:0.15em}
    .or-divider{display:flex;align-items:center;gap:1rem}
    .or-divider hr{flex:1;border:none;border-top:1px solid #e0d8c8}
    .or-divider span{font-family:'JetBrains Mono',monospace;font-size:0.55rem;color:#b0a890;letter-spacing:0.2em;text-transform:uppercase}
    .upload-zone{border:1px dashed #d0c8b8;padding:2rem;text-align:center;cursor:pointer;transition:all 0.2s;background:transparent}
    .upload-zone:hover{border-color:#8b6f3a;background:rgba(139,111,58,0.02)}
    .upload-zone.has-file{border-color:#8b6f3a;border-style:solid;background:rgba(139,111,58,0.03)}
    .uz-label{font-family:'Cormorant Garamond',serif;font-size:1.05rem;color:#6b5d3e;margin-bottom:0.25rem}
    .uz-sub{font-family:'JetBrains Mono',monospace;font-size:0.58rem;color:#b0a890;letter-spacing:0.08em}
    .uz-filename{font-family:'JetBrains Mono',monospace;font-size:0.72rem;color:#8b6f3a;margin-top:0.4rem}
    .rg-btn{padding:0.65rem 1.5rem;background:transparent;border:1px solid #8b6f3a;color:#8b6f3a;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;transition:all 0.2s;white-space:nowrap}
    .rg-btn:hover:not(:disabled){background:rgba(139,111,58,0.06)}
    .rg-btn:disabled{border-color:#d0c8b8;color:#d0c8b8;cursor:not-allowed}
    .upload-row{display:flex;gap:0.75rem;align-items:center;margin-top:0.75rem}
    .field-label{font-family:'JetBrains Mono',monospace;font-size:0.58rem;letter-spacing:0.2em;color:#b0a890;text-transform:uppercase;display:block;margin-bottom:0.35rem}
    .field-input{background:#fff;border:1px solid #e0d8c8;color:#2a2520;padding:0.65rem 0.9rem;font-family:'JetBrains Mono',monospace;font-size:0.72rem;outline:none;width:260px;transition:border-color 0.2s}
    .field-input:focus{border-color:#8b6f3a}
    .field-input.short{width:100px}
    .field-input.wide{width:100%}
    .how-row{display:grid;grid-template-columns:repeat(3,1fr);gap:2rem;margin-top:4rem;padding-top:3rem;border-top:1px solid #e8e2d8}
    .how-card{text-align:left}
    .how-num{font-family:'JetBrains Mono',monospace;font-size:0.5rem;color:#b0a890;letter-spacing:0.2em;margin-bottom:0.4rem}
    .how-title{font-family:'Cormorant Garamond',serif;font-size:1.05rem;color:#2a2520;margin-bottom:0.3rem}
    .how-desc{font-family:'Georgia',serif;font-size:0.82rem;color:#8a8070;line-height:1.65}
    .prior-section{margin-top:3rem;padding-top:2rem;border-top:1px solid #e8e2d8}
    .prior-title{font-family:'JetBrains Mono',monospace;font-size:0.58rem;letter-spacing:0.25em;color:#b0a890;text-transform:uppercase;margin-bottom:0.9rem}
    .prior-list{display:flex;flex-direction:column;gap:2px}
    .prior-item{display:flex;align-items:center;justify-content:space-between;padding:0.6rem 0.8rem;background:#fff;border:1px solid #ede8df;cursor:pointer;transition:all 0.15s}
    .prior-item:hover{border-color:#8b6f3a}
    .prior-name{font-family:'Cormorant Garamond',serif;font-size:0.92rem;color:#4a4030}
    .prior-meta{font-family:'JetBrains Mono',monospace;font-size:0.55rem;color:#b0a890;letter-spacing:0.08em}
    .connector-badge{font-size:0.48rem;padding:0.12rem 0.35rem;border:1px solid #e0d8c8;color:#8a8070;font-family:'JetBrains Mono',monospace;letter-spacing:0.12em;text-transform:uppercase;margin-right:0.4rem}
    .connecting{max-width:600px;margin:0 auto;padding:7rem 2rem;text-align:center}
    .conn-title{font-family:'Cormorant Garamond',serif;font-size:1.6rem;color:#6b5d3e;margin-bottom:1rem;font-weight:300}
    .conn-sub{font-family:'JetBrains Mono',monospace;font-size:0.62rem;color:#b0a890;letter-spacing:0.2em;animation:blink 1.4s infinite}
    .conn-steps{margin-top:2rem;display:flex;flex-direction:column;gap:0.5rem;text-align:left;max-width:340px;margin-left:auto;margin-right:auto}
    .conn-step{font-family:'JetBrains Mono',monospace;font-size:0.58rem;color:#b0a890;letter-spacing:0.1em;padding:0.35rem 0;border-bottom:1px solid #ede8df}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:0.25}}
    .err{background:rgba(180,60,60,0.04);border:1px solid rgba(180,60,60,0.15);padding:0.7rem 1rem;margin-bottom:1.5rem;font-family:'JetBrains Mono',monospace;font-size:0.67rem;color:#a04040}
    .chat-wrap{display:flex;height:calc(100vh - 54px)}
    .sidebar{width:280px;flex-shrink:0;border-right:1px solid #e8e2d8;padding:1.5rem 1.25rem;overflow-y:auto;background:#f5f2ed;scrollbar-width:thin;scrollbar-color:rgba(139,111,58,0.15) transparent}
    .sidebar::-webkit-scrollbar{width:4px}
    .sidebar::-webkit-scrollbar-track{background:transparent}
    .sidebar::-webkit-scrollbar-thumb{background:rgba(139,111,58,0.2);border-radius:2px}
    .sb-name{font-family:'Cormorant Garamond',serif;font-size:1rem;color:#4a4030;margin-bottom:0.4rem}
    .sb-meta{font-family:'JetBrains Mono',monospace;font-size:0.58rem;color:#8a8070;letter-spacing:0.08em;line-height:1.9}
    .sb-hr{border:none;border-top:1px solid #e0d8c8;margin:1.2rem 0}
    .starter{display:block;width:100%;text-align:left;padding:0.55rem 0.7rem;margin-bottom:3px;background:#fff;border:1px solid #ede8df;color:#6b5d3e;cursor:pointer;font-family:'Georgia',serif;font-size:0.78rem;line-height:1.4;transition:all 0.15s}
    .starter:hover{border-color:#8b6f3a;color:#4a4030}
    .back{margin-top:1.2rem;padding:0.4rem 0;background:none;border:none;color:#b0a890;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:0.58rem;letter-spacing:0.15em;text-transform:uppercase;transition:color 0.15s}
    .back:hover{color:#8b6f3a}
    .chat-main{flex:1;display:flex;flex-direction:column;min-width:0;background:#faf8f4}
    .messages{flex:1;overflow-y:auto;padding:2rem;display:flex;flex-direction:column;gap:1.5rem}
    .msg{max-width:740px;line-height:1.75}
    .msg-user{align-self:flex-end;background:#fff;border:1px solid #e0d8c8;padding:0.7rem 1.2rem;font-size:0.95rem;color:#2a2520;font-family:'Georgia',serif}
    .msg-assistant{align-self:flex-start;font-family:'Cormorant Garamond',serif;font-size:1.05rem;color:#4a4030}
    .msg-assistant strong{color:#2a2520;font-weight:500}
    .msg-assistant em{color:#8b6f3a;font-style:italic}
    .input-row{border-top:1px solid #e8e2d8;padding:1.2rem 2rem;display:flex;gap:0.75rem;align-items:flex-end;background:#faf8f4}
    .chat-input{flex:1;background:#fff;border:1px solid #e0d8c8;color:#2a2520;padding:0.7rem 1rem;font-family:'Georgia',serif;font-size:0.93rem;outline:none;resize:none;min-height:46px;max-height:160px;line-height:1.5;transition:border-color 0.2s}
    .chat-input:focus{border-color:#8b6f3a}
    .chat-input::placeholder{color:#c0b8a8;font-style:italic}
    .dots span{display:inline-block;width:4px;height:4px;border-radius:50%;background:#8b6f3a;margin:0 2px;animation:dot 1.2s infinite}
    .dots span:nth-child(2){animation-delay:0.2s}.dots span:nth-child(3){animation-delay:0.4s}
    @keyframes dot{0%,80%,100%{transform:scale(0.6);opacity:0.3}40%{transform:scale(1);opacity:1}}
    @media(max-width:768px){
      .chat-wrap{flex-direction:column}
      .sidebar{width:100%;max-height:40vh;border-right:none;border-bottom:1px solid #e8e2d8}
      .home-lede{font-size:1.8rem}
      .how-row{grid-template-columns:1fr;gap:1.5rem}
      .home{padding:3rem 1.5rem 3rem}
      .rg-header{padding:0.8rem 1rem}
    }
  `;

  const connectingLabel = uploadFile && stage === "connecting"
    ? "Reading your CSV" : homeTab === "postgres"
    ? "Introspecting database schema" : "Reading dataset structure";

  const connectingSub = uploadFile && stage === "connecting"
    ? "parsing columns · inferring types · detecting absences"
    : homeTab === "postgres"
    ? "connecting · reading schema · profiling tables"
    : "fetching variable manifest · profiling concepts · detecting absences";

  return (
    <div style={{ minHeight: "100vh", background: "#faf8f4", color: "#2a2520" }}>
      <style>{CSS}</style>
      <header className="rg-header">
        <div className="rg-mark" style={{display:"flex",alignItems:"center",gap:"12px"}}><img src="/logo.png" alt="Rose Glass Data" style={{height:"40px",width:"40px",borderRadius:"6px"}} />Rose Glass Data</div>
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
          <div className="rg-tag">Translation · Not Judgment</div>
          <a href="/login" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "0.58rem", letterSpacing: "0.15em", color: hasKey ? "#8a8070" : "#8b6f3a", textDecoration: "none", border: hasKey ? "none" : "1px solid #8b6f3a", padding: hasKey ? "0" : "0.3rem 0.8rem", transition: "color 0.15s" }}>
            {hasKey ? "Account" : "Sign In"}
          </a>
        </div>
      </header>

      {stage === "home" && (
        <div className="home">
          <h1 className="home-lede">What does this data <em>believe</em><br />about the world it measures?</h1>
          <p className="home-sub">Upload a dataset or try the demo. Rose Glass reads its structure — what it tracks, what it avoids, and what worldview is baked into how it counts.</p>

          {connectError && <div className="err">{connectError}</div>}

          <div className="home-actions">
            <button className="demo-btn" onClick={() => connectDataset("acs/acs5", 2023, "ACS 5-Year 2023")} disabled={connecting}>
              Try the demo — ACS 5-Year 2023
              <span>20,000+ variables · social, economic, housing</span>
            </button>

            <div className="or-divider"><hr /><span>or</span><hr /></div>

            <div>
              <div className={`upload-zone ${uploadFile ? "has-file" : ""} ${dragOver ? "has-file" : ""}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault(); setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f && f.name.endsWith(".csv")) setUploadFile(f);
                }}>
                <div className="uz-label">{uploadFile ? uploadFile.name : "Drop a CSV here, or click to browse"}</div>
                <div className="uz-sub">{uploadFile ? `${(uploadFile.size / 1024).toFixed(0)} KB · ready to profile` : "CSV files up to 50MB"}</div>
              </div>
              <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }}
                onChange={e => { if (e.target.files?.[0]) setUploadFile(e.target.files[0]); }} />
              {uploadFile && (
                <div className="upload-row">
                  <button className="rg-btn" onClick={uploadCSV} disabled={uploading}>
                    {uploading ? "Profiling…" : "Profile this dataset →"}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="how-row">
            <div className="how-card">
              <div className="how-num">01</div>
              <div className="how-title">Connect</div>
              <div className="how-desc">Upload a CSV or connect a public dataset. We read the schema, not the rows.</div>
            </div>
            <div className="how-card">
              <div className="how-num">02</div>
              <div className="how-title">Profile</div>
              <div className="how-desc">Seven AI agents classify every column — type, lineage, proxy risk, null semantics.</div>
            </div>
            <div className="how-card">
              <div className="how-num">03</div>
              <div className="how-title">Interrogate</div>
              <div className="how-desc">Ask what the data believes, what it hides, and where its structure fails.</div>
            </div>
          </div>

          {sessions.length > 0 && (
            <div className="prior-section">
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
          <div className="conn-steps">
            {uploadFile ? (<>
              <div className="conn-step">↳ parsing column headers and sample values</div>
              <div className="conn-step">↳ inferring concept domains and data types</div>
              <div className="conn-step">↳ running 6 classification agents in parallel</div>
              <div className="conn-step">↳ synthesizing dataset-level profile</div>
              <div className="conn-step">↳ detecting structural absences</div>
            </>) : (<>
              <div className="conn-step">↳ fetching variable manifest from Census API</div>
              <div className="conn-step">↳ profiling concept domains</div>
              <div className="conn-step">↳ computing dimensional scores</div>
              <div className="conn-step">↳ detecting structural absences</div>
            </>)}
          </div>
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
            <SidebarCollapse title="Ask about" defaultOpen={true}>
              {STARTERS.map(q => (
                <button key={q} className="starter" onClick={() => setInput(q)}>{q}</button>
              ))}
            </SidebarCollapse>
            <hr className="sb-hr" />
            {activeSession.semantic_profile && (
              <SidebarCollapse title="Schema Coherence" defaultOpen={true}
                badge={(() => {
                  const cols = activeSession.semantic_profile?.semantic_columns || [];
                  if (cols.length === 0) return undefined;
                  const hp = cols.filter((c: SemanticColumn) => c.proxy_risk === "high" || c.proxy_risk === "moderate").length;
                  return hp > 0 ? `${hp} risk` : undefined;
                })()}>
                <CoherenceScore
                  profile={activeSession.semantic_profile}
                  absences={activeSession.profile?.absences}
                  onCoachRequest={requestCoaching}
                />
              </SidebarCollapse>
            )}
            {(coachLoading || coachRecs.length > 0) && (
              <>
                <hr className="sb-hr" />
                <SidebarCollapse title="Schema Coach" defaultOpen={true}>
                  <CoachPanel recommendations={coachRecs} loading={coachLoading} />
                </SidebarCollapse>
              </>
            )}
            {activeSession.semantic_profile && (
              <>
                <hr className="sb-hr" />
                <SidebarCollapse title="Semantic Profile" defaultOpen={false}
                  badge={`${activeSession.semantic_profile.semantic_columns?.length || 0} cols`}>
                  <SemanticProfile profile={activeSession.semantic_profile} />
                </SidebarCollapse>
              </>
            )}
            {activeSession.profile?.absences?.length > 0 && (
              <>
                <hr className="sb-hr" />
                <SidebarCollapse title="Inference Map" defaultOpen={false}
                  badge={`${activeSession.profile.absences.length} gaps`}>
                  <InferenceMap
                    absences={activeSession.profile.absences}
                    lens_summary={activeSession.profile.lens_summary}
                    datasetName={activeSession.name}
                  />
                </SidebarCollapse>
              </>
            )}
            <hr className="sb-hr" />
            <button className="back" onClick={() => setStage("home")}>← New dataset</button>
          </aside>
          <div className="chat-main">
            <div className="messages">
              {messages.map((m, i) => (
                <div key={i} className={`msg msg-${m.role}`}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
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
