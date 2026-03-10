"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=JetBrains+Mono:wght@300;400&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#07090f}
  .page{min-height:100vh;background:#07090f;color:#c4c8d4}
  .header{border-bottom:1px solid rgba(180,150,90,0.12);padding:1.1rem 2rem;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;background:rgba(7,9,15,0.96);backdrop-filter:blur(12px)}
  .mark{font-family:'Cormorant Garamond',serif;font-size:1rem;font-weight:300;letter-spacing:0.3em;text-transform:uppercase;color:#c8a96e}
  .nav-links{display:flex;gap:1.5rem;align-items:center}
  .nav-link{font-family:'JetBrains Mono',monospace;font-size:0.6rem;letter-spacing:0.15em;color:#3a3f50;text-decoration:none;cursor:pointer;background:none;border:none;transition:color 0.15s}
  .nav-link:hover{color:#c8a96e}
  .main{max-width:780px;margin:0 auto;padding:3rem 2rem}
  .section-title{font-family:'JetBrains Mono',monospace;font-size:0.58rem;letter-spacing:0.25em;color:#252a35;text-transform:uppercase;margin-bottom:1rem}
  .card{border:1px solid rgba(180,150,90,0.1);padding:1.75rem;margin-bottom:1.5rem;background:rgba(255,255,255,0.01)}
  .card-title{font-family:'Cormorant Garamond',serif;font-size:1.2rem;color:#d0c898;margin-bottom:0.4rem}
  .card-meta{font-family:'JetBrains Mono',monospace;font-size:0.62rem;color:#3a3f50;letter-spacing:0.08em;line-height:1.9;margin-bottom:1.2rem}
  .key-box{background:rgba(200,169,110,0.04);border:1px solid rgba(200,169,110,0.15);padding:0.75rem 1rem;font-family:'JetBrains Mono',monospace;font-size:0.72rem;color:#c8a96e;letter-spacing:0.05em;display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:0.75rem;word-break:break-all}
  .copy-btn{background:none;border:1px solid rgba(200,169,110,0.2);color:#c8a96e;padding:0.3rem 0.7rem;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:0.55rem;letter-spacing:0.15em;white-space:nowrap;flex-shrink:0;transition:all 0.15s}
  .copy-btn:hover{background:rgba(200,169,110,0.07)}
  .key-note{font-family:'JetBrains Mono',monospace;font-size:0.58rem;color:#252a35;letter-spacing:0.08em;line-height:1.7}
  .token-bar-wrap{height:4px;background:rgba(255,255,255,0.04);margin:1rem 0;border-radius:2px;overflow:hidden}
  .token-bar{height:100%;background:#c8a96e;border-radius:2px;transition:width 0.5s}
  .token-bar.unlimited{width:100%;background:rgba(200,169,110,0.4)}
  .plan-badge{display:inline-block;padding:0.2rem 0.6rem;border:1px solid rgba(200,169,110,0.25);font-family:'JetBrains Mono',monospace;font-size:0.55rem;letter-spacing:0.2em;text-transform:uppercase;color:#c8a96e;margin-left:0.5rem}
  .plan-badge.trial{border-color:rgba(180,150,90,0.15);color:#5a6070}
  .rg-btn{padding:0.65rem 1.5rem;background:transparent;border:1px solid #c8a96e;color:#c8a96e;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;transition:all 0.2s}
  .rg-btn:hover:not(:disabled){background:rgba(200,169,110,0.07)}
  .rg-btn:disabled{border-color:#252a35;color:#252a35;cursor:not-allowed}
  .btn-row{display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;margin-top:1rem}
  .msg{padding:0.5rem 0.75rem;margin-top:0.75rem;font-family:'JetBrains Mono',monospace;font-size:0.62rem;line-height:1.6}
  .msg.ok{background:rgba(60,120,60,0.06);border:1px solid rgba(60,120,60,0.2);color:#70a870}
  .msg.err{background:rgba(180,60,60,0.06);border:1px solid rgba(180,60,60,0.18);color:#b06060}
  .cost-table{width:100%;border-collapse:collapse;margin-top:0.5rem}
  .cost-table td{font-family:'JetBrains Mono',monospace;font-size:0.62rem;color:#5a6070;padding:0.45rem 0;border-bottom:1px solid rgba(180,150,90,0.05);letter-spacing:0.05em}
  .cost-table td:first-child{color:#9a9880;width:40%}
  .loading{font-family:'JetBrains Mono',monospace;font-size:0.62rem;color:#252a35;letter-spacing:0.15em;padding:3rem 2rem}
`;

type AccountData = {
  api_key: string;
  plan: string;
  tokens_remaining: number;
  email: string;
};

export default function DashboardPage() {
  const [account, setAccount] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { window.location.href = "/login"; return; }

      // Check URL params for upgrade result
      const params = new URLSearchParams(window.location.search);
      if (params.get("upgrade") === "success") setMsg({ text: "Upgrade successful. Plan updated.", ok: true });
      if (params.get("upgrade") === "canceled") setMsg({ text: "Upgrade canceled.", ok: false });

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (data.api_key) {
        setAccount({
          api_key: data.api_key,
          plan: data.plan,
          tokens_remaining: data.tokens_remaining,
          email: session.user.email || "",
        });
      }
      setLoading(false);
    })();
  }, []);

  async function handleUpgrade() {
    if (!account) return;
    setUpgrading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: account.email, plan: "pro" }),
      });
      const data = await res.json();
      if (data.checkout_url) window.location.href = data.checkout_url;
      else setMsg({ text: data.error || "Checkout failed", ok: false });
    } catch { setMsg({ text: "Network error", ok: false }); }
    finally { setUpgrading(false); }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    localStorage.removeItem("rgd_api_key");
    window.location.href = "/login";
  }

  function copyKey() {
    if (!account) return;
    navigator.clipboard.writeText(account.api_key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isPro = account?.plan === "pro" || account?.plan === "enterprise";
  const tokenPct = isPro ? 100 : Math.min(100, ((account?.tokens_remaining || 0) / 10000) * 100);

  if (loading) return <div className="page"><style>{CSS}</style><div className="loading">Loading…</div></div>;

  return (
    <div className="page">
      <style>{CSS}</style>
      <header className="header">
        <div className="mark">Rose Glass</div>
        <nav className="nav-links">
          <a className="nav-link" href="/">Analyze</a>
          <button className="nav-link" onClick={handleSignOut}>Sign out</button>
        </nav>
      </header>

      <main className="main">
        <div className="section-title">Account</div>

        {account && (<>
          <div className="card">
            <div className="card-title">
              API Key
              <span className={`plan-badge ${account.plan}`}>{account.plan}</span>
            </div>
            <div className="card-meta">{account.email}</div>
            <div className="key-box">
              <span>{account.api_key}</span>
              <button className="copy-btn" onClick={copyKey}>{copied ? "Copied" : "Copy"}</button>
            </div>
            <div className="key-note">
              Pass this key as the <code>X-Api-Key</code> header on every API request.<br />
              Keep it secret — it controls your token balance.
            </div>
          </div>

          <div className="card">
            <div className="card-title">Tokens</div>
            <div className="card-meta">
              {isPro
                ? "Unlimited — pro plan"
                : `${(account.tokens_remaining).toLocaleString()} remaining of 10,000 trial tokens`}
            </div>
            <div className="token-bar-wrap">
              <div className={`token-bar ${isPro ? "unlimited" : ""}`} style={{ width: `${tokenPct}%` }} />
            </div>

            {!isPro && (
              <>
                <table className="cost-table">
                  <tbody>
                    <tr><td>Upload CSV</td><td>2,000 tokens — 7-agent semantic profile</td></tr>
                    <tr><td>Chat</td><td>100 tokens per message</td></tr>
                    <tr><td>Connect dataset</td><td>500 tokens</td></tr>
                    <tr><td>Connect PostgreSQL</td><td>500 tokens</td></tr>
                  </tbody>
                </table>
                <div className="btn-row">
                  <button className="rg-btn" onClick={handleUpgrade} disabled={upgrading}>
                    {upgrading ? "Redirecting…" : "Upgrade to Pro →"}
                  </button>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "0.6rem", color: "#3a3f50" }}>
                    Unlimited tokens · $4/month
                  </span>
                </div>
              </>
            )}

            {isPro && (
              <div className="btn-row">
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "0.62rem", color: "#5a6070" }}>
                  Pro plan active. Unlimited API access.
                </span>
              </div>
            )}

            {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
          </div>

          <div className="card">
            <div className="card-title">API Usage</div>
            <div className="card-meta">
              Pass your key as a header on any request:
            </div>
            <div className="key-box" style={{ fontSize: "0.65rem" }}>
              <span>{`curl -X POST https://rose-glass-data.vercel.app/api/connect \\
  -H "X-Api-Key: ${account.api_key.slice(0,20)}..." \\
  -H "Content-Type: application/json" \\
  -d '{"dataset_id":"acs/acs5","vintage":2023}'`}</span>
            </div>
          </div>
        </>)}
      </main>
    </div>
  );
}
