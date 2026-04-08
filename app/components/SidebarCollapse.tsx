"use client";
import React, { useState, type ReactNode } from "react";

interface Props {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  badge?: string;
}

const CSS = `
  .sc-header{display:flex;align-items:center;justify-content:space-between;
    cursor:pointer;padding:0.4rem 0;user-select:none;transition:opacity 0.15s}
  .sc-header:hover{opacity:0.85}
  .sc-title{font-family:'JetBrains Mono',monospace;font-size:0.55rem;
    letter-spacing:0.25em;color:#8a8070;text-transform:uppercase}
  .sc-badge{font-family:'JetBrains Mono',monospace;font-size:0.48rem;
    padding:0.1rem 0.35rem;border:1px solid #d0c8b8;
    color:#6b5d3e;letter-spacing:0.1em}
  .sc-chevron{font-size:0.55rem;color:#b0a890;transition:transform 0.2s}
  .sc-chevron.open{transform:rotate(90deg)}
  .sc-body{overflow:hidden;transition:max-height 0.25s ease,opacity 0.2s}
  .sc-body.closed{max-height:0;opacity:0;pointer-events:none}
  .sc-body.open{max-height:2000px;opacity:1}
`;

export default function SidebarCollapse({
  title, defaultOpen = true, children, badge,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <style>{CSS}</style>
      <div className="sc-header" onClick={() => setOpen(!open)}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span className="sc-title">{title}</span>
          {badge && <span className="sc-badge">{badge}</span>}
        </div>
        <span className={`sc-chevron ${open ? "open" : ""}`}>▸</span>
      </div>
      <div className={`sc-body ${open ? "open" : "closed"}`}>
        {children}
      </div>
    </div>
  );
}
