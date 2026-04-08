"use client";
import React from "react";

export interface Recommendation {
  priority: "critical" | "important" | "suggested" | "info";
  axis: string;
  action: string;
  rationale: string;
}

interface Props {
  recommendations: Recommendation[];
  loading?: boolean;
}

const CSS = `
  .cp-wrap{padding:0.8rem 0}
  .cp-title{font-family:'JetBrains Mono',monospace;font-size:0.55rem;
    letter-spacing:0.25em;color:#d0c8b8;text-transform:uppercase;
    margin-bottom:0.7rem}
  .cp-list{display:flex;flex-direction:column;gap:0.6rem}
  .cp-rec{padding:0.65rem 0.75rem;border-left:2px solid;
    background:rgba(0,0,0,0.02)}
  .cp-rec.critical{border-color:#a04040;
    background:rgba(180,60,60,0.04)}
  .cp-rec.important{border-color:#8b6f3a;
    background:rgba(139,111,58,0.03)}
  .cp-rec.suggested{border-color:#d0c8b8;
    background:rgba(0,0,0,0.02)}
  .cp-rec.info{border-color:#e8e2d8}
  .cp-priority{font-family:'JetBrains Mono',monospace;font-size:0.5rem;
    letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.25rem}
  .cp-priority.critical{color:#a04040}
  .cp-priority.important{color:#8b6f3a}
  .cp-priority.suggested{color:#6b5d3e}
  .cp-priority.info{color:#8a8070}
  .cp-axis{font-family:'JetBrains Mono',monospace;font-size:0.5rem;
    color:#8a8070;letter-spacing:0.1em;margin-bottom:0.3rem}
  .cp-action{font-family:'Cormorant Garamond',serif;font-size:0.88rem;
    color:#4a4030;line-height:1.45;margin-bottom:0.2rem}
  .cp-rationale{font-family:'Georgia',serif;font-size:0.72rem;
    color:#4a5060;line-height:1.5}
  .cp-loading{font-family:'JetBrains Mono',monospace;font-size:0.6rem;
    color:#8a8070;letter-spacing:0.15em;animation:cpBlink 1.4s infinite}
  @keyframes cpBlink{0%,100%{opacity:1}50%{opacity:0.25}}
`;

export default function CoachPanel({ recommendations, loading }: Props) {
  if (loading) {
    return (
      <div className="cp-wrap">
        <style>{CSS}</style>
        <div className="cp-title">Schema Coach</div>
        <div className="cp-loading">
          analyzing coherence gaps…
        </div>
      </div>
    );
  }

  if (!recommendations || recommendations.length === 0) return null;

  // Sort: critical first, then important, then suggested
  const order = { critical: 0, important: 1, suggested: 2, info: 3 };
  const sorted = [...recommendations].sort(
    (a, b) =>
      (order[a.priority] ?? 3) - (order[b.priority] ?? 3)
  );

  return (
    <div className="cp-wrap">
      <style>{CSS}</style>
      <div className="cp-title">Schema Coach</div>
      <div className="cp-list">
        {sorted.map((rec, i) => (
          <div key={i} className={`cp-rec ${rec.priority}`}>
            <div className={`cp-priority ${rec.priority}`}>
              {rec.priority}
              {rec.axis !== "general" && ` · ${rec.axis.replace(/_/g, " ")}`}
            </div>
            <div className="cp-action">{rec.action}</div>
            {rec.rationale && (
              <div className="cp-rationale">{rec.rationale}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
