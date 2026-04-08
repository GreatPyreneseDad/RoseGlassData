import React, { useState } from "react";

export interface SemanticColumn {
  column: string;
  semantic_type: string;
  collection_method: string;
  null_semantics: string;
  cardinality_class: string;
  referential_dependencies: string[];
  proxy_risk: string;
  proxy_risk_note: string;
  lineage_note: string;
}

export interface DatasetProfile {
  semantic_columns: SemanticColumn[];
  grain: string;
  dataset_class: string;
  analytical_scope: string;
  use_limitations: string[];
}

interface SemanticProfileProps {
  profile: DatasetProfile;
}

const CSS = `
  .sp-container{padding:1rem 0;font-size:0.75rem}
  .sp-title{font-family:'JetBrains Mono',monospace;font-size:0.55rem;letter-spacing:0.25em;color:#d0c8b8;text-transform:uppercase;margin-bottom:0.7rem;display:block;margin-top:0.9rem;margin-bottom:0.5rem}
  .sp-title:first-child{margin-top:0}
  .sp-grain{font-family:'Cormorant Garamond',serif;font-size:0.85rem;color:#6b5d3e;line-height:1.5;margin-bottom:1rem}
  .sp-class{font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#6b5d3e;letter-spacing:0.08em;margin-bottom:1rem;padding:0.5rem 0.7rem;background:rgba(0,0,0,0.02);border:1px solid #ede8df;display:inline-block}
  .sp-scope{font-family:'Georgia',serif;font-size:0.78rem;color:#6b5d3e;line-height:1.5;margin-bottom:1rem}
  .sp-limit{font-family:'Georgia',serif;font-size:0.75rem;color:#8a8070;line-height:1.6;margin-bottom:0.4rem;padding-left:0.8rem;border-left:1px solid #d0c8b8}
  .sp-col-table{width:100%;border-collapse:collapse;margin-top:0.5rem}
  .sp-col-row{border-bottom:1px solid #ede8df;font-size:0.68rem}
  .sp-col-name{padding:0.4rem 0.5rem;font-family:'JetBrains Mono',monospace;color:#6b5d3e;font-weight:500;max-width:120px;overflow:hidden;text-overflow:ellipsis;word-break:break-word}
  .sp-col-type{padding:0.4rem 0.5rem;font-family:'JetBrains Mono',monospace;font-size:0.65rem;color:#6b5d3e;letter-spacing:0.05em}
  .sp-col-risk{padding:0.4rem 0.5rem;font-family:'JetBrains Mono',monospace;font-size:0.65rem}
  .sp-col-risk.none{color:#6b5d3e}
  .sp-col-risk.low{color:#7a9070}
  .sp-col-risk.moderate{color:#8b6f3a;font-weight:500}
  .sp-col-risk.high{color:#a04040;font-weight:500}
  .sp-col-lineage{padding:0.4rem 0.5rem;font-family:'Georgia',serif;font-size:0.68rem;color:#8a8070;max-width:200px}
`;

export default function SemanticProfile({ profile }: SemanticProfileProps) {
  const [expandedCol, setExpandedCol] = useState<string | null>(null);

  if (!profile || !profile.grain) return null;

  const proxyRiskCols = profile.semantic_columns.filter(c =>
    c.proxy_risk === "moderate" || c.proxy_risk === "high"
  );
  const compositeCols = profile.semantic_columns.filter(c =>
    c.semantic_type === "composite"
  );

  return (
    <div className="sp-container">
      <style>{CSS}</style>

      <span className="sp-title">Dataset Profile</span>

      <div className="sp-grain">
        <strong style={{ color: "#4a4030" }}>Grain:</strong> {profile.grain}
      </div>

      <div className="sp-class">
        {profile.dataset_class.replace(/_/g, " ")}
      </div>

      <span className="sp-title" style={{ marginTop: "0.8rem" }}>Scope</span>
      <div className="sp-scope">{profile.analytical_scope}</div>

      <span className="sp-title">Limitations</span>
      {profile.use_limitations?.length > 0 ? (
        profile.use_limitations.map((lim, i) => (
          <div key={i} className="sp-limit">{lim}</div>
        ))
      ) : (
        <div className="sp-limit">None documented</div>
      )}

      {proxyRiskCols.length > 0 && (
        <>
          <span className="sp-title" style={{ marginTop: "0.8rem", color: "#a04040" }}>⚠ Proxy Risk (Moderate/High)</span>
          <table className="sp-col-table">
            <tbody>
              {proxyRiskCols.map(col => (
                <tr key={col.column} className="sp-col-row" onClick={() => setExpandedCol(expandedCol === col.column ? null : col.column)} style={{ cursor: "pointer" }}>
                  <td className="sp-col-name">{col.column}</td>
                  <td className={`sp-col-risk ${col.proxy_risk}`}>{col.proxy_risk}</td>
                  <td className="sp-col-lineage">{col.proxy_risk_note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {compositeCols.length > 0 && (
        <>
          <span className="sp-title" style={{ marginTop: "0.8rem" }}>Composite Fields</span>
          {compositeCols.map(col => (
            <div key={col.column} className="sp-limit" style={{ borderLeftColor: "#d0c8b8" }}>
              <strong style={{ color: "#6b5d3e" }}>{col.column}:</strong> {col.lineage_note}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
