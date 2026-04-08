"use client";
import { useState, useEffect } from "react";

function getApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("rgd_api_key") || "";
}

export default function Home() {
  const [hasKey, setHasKey] = useState(false);

  useEffect(() => {
    const key = getApiKey();
    setHasKey(!!key);
    // If authenticated, redirect to the app
    if (key) {
      window.location.href = "/app";
    }
  }, []);

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=JetBrains+Mono:wght@300;400&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#faf8f4}
    .land{min-height:100vh;background:#faf8f4;color:#2a2520}
    .hdr{border-bottom:1px solid #e8e2d8;padding:1.1rem 2rem;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;background:rgba(250,248,244,0.97);backdrop-filter:blur(12px)}
    .mark{font-family:'Cormorant Garamond',serif;font-size:1.05rem;font-weight:400;letter-spacing:0.25em;text-transform:uppercase;color:#6b5d3e;display:flex;align-items:center;gap:12px}
    .nav{display:flex;align-items:center;gap:1.5rem}
    .nav a{font-family:'JetBrains Mono',monospace;font-size:0.6rem;letter-spacing:0.15em;color:#8a8070;text-decoration:none;transition:color 0.15s}
    .nav a:hover{color:#6b5d3e}
    .nav .cta{border:1px solid #8b6f3a;color:#8b6f3a;padding:0.35rem 1rem}
    .nav .cta:hover{background:rgba(139,111,58,0.06)}
    .hero{max-width:700px;margin:0 auto;padding:6rem 2rem 4rem;text-align:left}
    .hero h1{font-family:'Cormorant Garamond',serif;font-size:2.8rem;font-weight:300;line-height:1.25;color:#2a2520;margin-bottom:1.5rem;letter-spacing:0.01em;animation:fadeUp 0.5s ease both}
    .hero h1 em{color:#8b6f3a;font-style:italic}
    .hero p{font-size:0.95rem;line-height:1.9;color:#7a7060;max-width:540px;margin-bottom:2.5rem;font-family:'Georgia',serif;animation:fadeUp 0.5s ease 0.08s both}
    @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    .hero-cta{display:flex;gap:1rem;align-items:center;animation:fadeUp 0.5s ease 0.15s both;flex-wrap:wrap}
    .btn-primary{padding:0.85rem 2rem;background:#2a2520;border:none;color:#faf8f4;cursor:pointer;font-family:'Cormorant Garamond',serif;font-size:1.1rem;font-weight:400;letter-spacing:0.05em;transition:all 0.2s;text-decoration:none;display:inline-block}
    .btn-primary:hover{background:#3d352a}
    .btn-secondary{padding:0.85rem 2rem;background:transparent;border:1px solid #d0c8b8;color:#6b5d3e;cursor:pointer;font-family:'Cormorant Garamond',serif;font-size:1.1rem;font-weight:400;letter-spacing:0.05em;transition:all 0.2s;text-decoration:none;display:inline-block}
    .btn-secondary:hover{border-color:#8b6f3a}
    .problem{max-width:700px;margin:0 auto;padding:3rem 2rem 4rem;border-top:1px solid #e8e2d8}
    .problem h2{font-family:'Cormorant Garamond',serif;font-size:1.8rem;font-weight:300;color:#2a2520;margin-bottom:1.2rem}
    .problem p{font-family:'Georgia',serif;font-size:0.95rem;color:#7a7060;line-height:1.85;margin-bottom:1.2rem;max-width:560px}
    .problem .highlight{color:#2a2520;font-weight:600}
    .solution{max-width:700px;margin:0 auto;padding:3rem 2rem 4rem;border-top:1px solid #e8e2d8}
    .solution h2{font-family:'Cormorant Garamond',serif;font-size:1.8rem;font-weight:300;color:#2a2520;margin-bottom:1.2rem}
    .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:2rem;margin-top:2rem}
    .step-num{font-family:'JetBrains Mono',monospace;font-size:0.5rem;color:#b0a890;letter-spacing:0.2em;margin-bottom:0.4rem}
    .step-title{font-family:'Cormorant Garamond',serif;font-size:1.1rem;color:#2a2520;margin-bottom:0.35rem}
    .step-desc{font-family:'Georgia',serif;font-size:0.85rem;color:#8a8070;line-height:1.65}
    .cta-section{max-width:700px;margin:0 auto;padding:4rem 2rem 5rem;border-top:1px solid #e8e2d8;text-align:center}
    .cta-section h2{font-family:'Cormorant Garamond',serif;font-size:1.8rem;font-weight:300;color:#2a2520;margin-bottom:0.8rem}
    .cta-section p{font-family:'Georgia',serif;font-size:0.92rem;color:#8a8070;margin-bottom:2rem}
    .footer{border-top:1px solid #e8e2d8;padding:2rem;text-align:center}
    .footer span{font-family:'JetBrains Mono',monospace;font-size:0.55rem;color:#b0a890;letter-spacing:0.15em}
    @media(max-width:768px){
      .hero h1{font-size:2rem}
      .hero{padding:3rem 1.5rem 3rem}
      .steps{grid-template-columns:1fr;gap:1.5rem}
      .hdr{padding:0.8rem 1rem}
      .hero-cta{flex-direction:column;align-items:stretch}
    }
  `;

  return (
    <div className="land">
      <style>{CSS}</style>
      <header className="hdr">
        <div className="mark">
          <img src="/logo.png" alt="" style={{height:36,width:36,borderRadius:6}} />
          Rose Glass Data
        </div>
        <nav className="nav">
          <a href="/login">Sign in</a>
          <a href="/login?tab=signup" className="cta">Get started free</a>
        </nav>
      </header>

      <section className="hero">
        <h1>What does your data <em>believe</em> about the world it measures?</h1>
        <p>Every dataset encodes assumptions — what it tracks, what it ignores, whose reality it centers. Rose Glass Data reads the structure of any dataset and surfaces what's visible, what's absent, and what worldview is baked into how it counts.</p>
        <div className="hero-cta">
          <a href="/login?tab=signup" className="btn-primary">Start free — 10,000 tokens</a>
          <a href="/login" className="btn-secondary">Sign in</a>
        </div>
      </section>

      <section className="problem">
        <h2>The problem no one talks about</h2>
        <p>Your data pipeline can tell you that a column has 12% null values. It cannot tell you <span className="highlight">whether those nulls mean "not collected," "not applicable," or "suppressed for privacy."</span> The difference changes every downstream decision.</p>
        <p>Your model card flags proxy risk. It cannot tell you <span className="highlight">that a ZIP code column correlates with racial segregation patterns</span> in this specific dataset, or that a drug type field encodes enforcement bias.</p>
        <p>Standard profiling tools count. Rose Glass Data <em>translates</em> — surfacing the assumptions, absences, and worldview embedded in your schema before they become invisible errors in production.</p>
      </section>

      <section className="solution">
        <h2>How it works</h2>
        <div className="steps">
          <div>
            <div className="step-num">01</div>
            <div className="step-title">Connect</div>
            <div className="step-desc">Upload a CSV, connect a PostgreSQL database, or try a public Census dataset. We read the schema, not the rows.</div>
          </div>
          <div>
            <div className="step-num">02</div>
            <div className="step-title">Profile</div>
            <div className="step-desc">Seven AI agents classify every column — semantic type, collection method, proxy risk, null semantics, lineage, and dependencies.</div>
          </div>
          <div>
            <div className="step-num">03</div>
            <div className="step-title">Interrogate</div>
            <div className="step-desc">Ask what the data believes, where its structure fails, and get coaching recommendations to improve schema coherence.</div>
          </div>
        </div>
      </section>

      <section className="cta-section">
        <h2>Translation, not judgment</h2>
        <p>Free tier includes 10,000 tokens. No credit card required. Pro is $4/month unlimited.</p>
        <a href="/login?tab=signup" className="btn-primary">Get started free</a>
      </section>

      <footer className="footer">
        <span>ROSE Corp. · Service-Disabled Veteran-Owned Small Business · roseglass.dev</span>
      </footer>
    </div>
  );
}
