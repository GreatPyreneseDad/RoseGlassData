"use client";
import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=JetBrains+Mono:wght@300;400&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#07090f}
  .wrap{min-height:100vh;background:#07090f;color:#c4c8d4;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem}
  .card{width:100%;max-width:420px;border:1px solid rgba(180,150,90,0.12);padding:2.5rem;background:#07090f}
  .mark{font-family:'Cormorant Garamond',serif;font-size:1rem;font-weight:300;letter-spacing:0.3em;text-transform:uppercase;color:#c8a96e;margin-bottom:2rem;display:block}
  .title{font-family:'Cormorant Garamond',serif;font-size:1.8rem;font-weight:300;color:#e8dfc8;margin-bottom:0.5rem}
  .sub{font-family:'JetBrains Mono',monospace;font-size:0.62rem;color:#3a3f50;letter-spacing:0.12em;margin-bottom:2rem;line-height:1.7}
  .tabs{display:flex;border-bottom:1px solid rgba(180,150,90,0.1);margin-bottom:1.8rem}
  .tab{padding:0.5rem 1rem;background:none;border:none;border-bottom:2px solid transparent;color:#3a3f50;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:0.6rem;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:-1px;transition:all 0.15s}
  .tab.active{color:#c8a96e;border-bottom-color:#c8a96e}
  .label{font-family:'JetBrains Mono',monospace;font-size:0.58rem;letter-spacing:0.2em;color:#2a2f3a;text-transform:uppercase;display:block;margin-bottom:0.35rem}
  .input{width:100%;background:rgba(255,255,255,0.02);border:1px solid rgba(180,150,90,0.12);color:#c4c8d4;padding:0.65rem 0.9rem;font-family:'JetBrains Mono',monospace;font-size:0.75rem;outline:none;margin-bottom:1rem;transition:border-color 0.2s}
  .input:focus{border-color:rgba(200,169,110,0.35)}
  .btn{width:100%;padding:0.7rem;background:transparent;border:1px solid #c8a96e;color:#c8a96e;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;transition:all 0.2s;margin-top:0.25rem}
  .btn:hover:not(:disabled){background:rgba(200,169,110,0.07)}
  .btn:disabled{border-color:#252a35;color:#252a35;cursor:not-allowed}
  .msg{padding:0.7rem;margin-top:1rem;font-family:'JetBrains Mono',monospace;font-size:0.67rem;line-height:1.7}
  .msg.ok{background:rgba(60,120,60,0.06);border:1px solid rgba(60,120,60,0.2);color:#70a870}
  .msg.err{background:rgba(180,60,60,0.06);border:1px solid rgba(180,60,60,0.18);color:#b06060}
`;

export default function LoginPage() {
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function handleSubmit() {
    if (!email || !password) return;
    setLoading(true); setMsg(null);
    try {
      if (tab === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/api/auth/callback` },
        });
        if (error) throw error;
        setMsg({ text: "Check your email to confirm your account.", ok: true });
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Get api_key for this session
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { Authorization: `Bearer ${data.session?.access_token}` },
        });
        const keyData = await res.json();
        if (keyData.api_key) {
          localStorage.setItem("rgd_api_key", keyData.api_key);
          localStorage.setItem("rgd_plan", keyData.plan);
          localStorage.setItem("rgd_tokens", String(keyData.tokens_remaining));
        }
        window.location.href = "/dashboard";
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error";
      setMsg({ text: message, ok: false });
    } finally { setLoading(false); }
  }

  return (
    <div className="wrap">
      <style>{CSS}</style>
      <div className="card">
        <span className="mark">Rose Glass</span>
        <h1 className="title">{tab === "login" ? "Welcome back" : "Create account"}</h1>
        <p className="sub">Translation, not judgment.</p>
        <div className="tabs">
          <button className={`tab ${tab === "login" ? "active" : ""}`} onClick={() => setTab("login")}>Sign in</button>
          <button className={`tab ${tab === "signup" ? "active" : ""}`} onClick={() => setTab("signup")}>Create account</button>
        </div>
        <label className="label">Email</label>
        <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
        <label className="label">Password</label>
        <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)}
          placeholder="••••••••"
          onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }} />
        <button className="btn" onClick={handleSubmit} disabled={loading || !email || !password}>
          {loading ? "…" : tab === "login" ? "Sign in →" : "Create account →"}
        </button>
        {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
      </div>
    </div>
  );
}
