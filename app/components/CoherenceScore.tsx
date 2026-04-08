"use client";
import React, { useState, useEffect } from "react";

// ── Types ────────────────────────────────────────────────────────

interface SemanticColumn {
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

interface DatasetProfile {
  semantic_columns: SemanticColumn[];
  grain: string;
  dataset_class: string;
  analytical_scope: string;
  use_limitations: string[];
}

interface CoherenceAxis {
  label: string;
  key: string;
  score: number;        // 0–1
  explanation: string;  // one sentence
}

interface Props {
  profile: DatasetProfile;
  absences?: Array<{ domain: string; absence: string; significance: string }>;
  onCoachRequest?: (axes: CoherenceAxis[]) => void;
}

// ── Scoring engine ───────────────────────────────────────────────

function computeAxes(profile: DatasetProfile, absences?: Props["absences"]): CoherenceAxis[] {
  const cols = profile.semantic_columns || [];
  const n = cols.length || 1;

  // 1. Completeness — how much of reality does this schema represent?
  const unknownTypes = cols.filter(c => c.semantic_type === "unknown").length;
  const unknownMethods = cols.filter(c => c.collection_method === "unknown").length;
  const absenceCount = absences?.length || 0;
  const completeness = Math.max(0, Math.min(1,
    1 - (unknownTypes / n * 0.3) - (unknownMethods / n * 0.3) - (absenceCount * 0.07)
  ));

  // 2. Proxy Safety — how free is this schema from discriminatory proxy risk?
  const highProxy = cols.filter(c => c.proxy_risk === "high").length;
  const modProxy = cols.filter(c => c.proxy_risk === "moderate").length;
  const proxySafety = Math.max(0, Math.min(1,
    1 - (highProxy * 0.2) - (modProxy * 0.08)
  ));

  // 3. Lineage Clarity — can you trace where each field came from?
  const unclearLineage = cols.filter(c =>
    c.lineage_note.includes("unclear") || c.lineage_note.includes("unknown") || c.lineage_note.length < 10
  ).length;
  const lineageClarity = Math.max(0, Math.min(1, 1 - (unclearLineage / n)));

  // 4. Null Transparency — are missing values semantically understood?
  const ambiguousNulls = cols.filter(c => c.null_semantics === "ambiguous").length;
  const suppressedNulls = cols.filter(c => c.null_semantics === "suppressed").length;
  const nullTransparency = Math.max(0, Math.min(1,
    1 - (ambiguousNulls / n * 0.8) - (suppressedNulls / n * 0.3)
  ));

  // 5. Referential Integrity — does each field make sense in context?
  const orphans = cols.filter(c =>
    c.referential_dependencies.length > 0 &&
    c.referential_dependencies.some(dep => !cols.find(cc => cc.column === dep))
  ).length;
  const hasComposites = cols.filter(c => c.semantic_type === "composite").length;
  const refIntegrity = Math.max(0, Math.min(1,
    1 - (orphans / n * 0.5) - (hasComposites / n * 0.15)
  ));

  return [
    {
      label: "Completeness",
      key: "completeness",
      score: completeness,
      explanation: absenceCount > 2
        ? `${absenceCount} structural domains absent — the schema has significant blind spots`
        : unknownTypes > 0
        ? `${unknownTypes} column${unknownTypes > 1 ? "s" : ""} with unresolvable type`
        : "Schema covers its declared domain well",
    },
    {
      label: "Proxy Safety",
      key: "proxy_safety",
      score: proxySafety,
      explanation: highProxy > 0
        ? `${highProxy} column${highProxy > 1 ? "s" : ""} with high proxy risk for protected characteristics`
        : modProxy > 0
        ? `${modProxy} column${modProxy > 1 ? "s" : ""} with moderate proxy risk — monitor in modeling`
        : "No significant proxy risk detected",
    },
    {
      label: "Lineage Clarity",
      key: "lineage_clarity",
      score: lineageClarity,
      explanation: unclearLineage > 3
        ? `${unclearLineage} columns with untraceable origins — data provenance is weak`
        : unclearLineage > 0
        ? `${unclearLineage} column${unclearLineage > 1 ? "s" : ""} with unclear lineage`
        : "Every column has a traceable production mechanism",
    },
    {
      label: "Null Transparency",
      key: "null_transparency",
      score: nullTransparency,
      explanation: ambiguousNulls > 3
        ? `${ambiguousNulls} columns where null meaning is ambiguous — imputation will mislead`
        : suppressedNulls > 0
        ? `${suppressedNulls} column${suppressedNulls > 1 ? "s" : ""} with suppressed values`
        : "Null semantics are well-understood across the schema",
    },
    {
      label: "Referential Integrity",
      key: "referential_integrity",
      score: refIntegrity,
      explanation: hasComposites > 0
        ? `${hasComposites} composite field${hasComposites > 1 ? "s" : ""} encoding multiple concepts — consider decomposition`
        : orphans > 0
        ? `${orphans} column${orphans > 1 ? "s" : ""} with unresolvable dependencies`
        : "Fields are interpretable within the schema context",
    },
  ];
}

// ── Radar polygon SVG ────────────────────────────────────────────

function RadarPolygon({ axes, size = 200 }: { axes: CoherenceAxis[]; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;
  const n = axes.length;
  const angleStep = (Math.PI * 2) / n;
  const startAngle = -Math.PI / 2; // top

  function point(i: number, radius: number): [number, number] {
    const angle = startAngle + i * angleStep;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  }

  // Grid rings
  const rings = [0.25, 0.5, 0.75, 1.0];
  const ringPaths = rings.map(pct => {
    const pts = Array.from({ length: n }, (_, i) => point(i, r * pct));
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") + " Z";
  });

  // Axis lines
  const axisLines = Array.from({ length: n }, (_, i) => {
    const [x, y] = point(i, r);
    return { x1: cx, y1: cy, x2: x, y2: y };
  });

  // Data polygon
  const dataPoints = axes.map((a, i) => point(i, r * a.score));
  const dataPath = dataPoints.map((p, i) =>
    `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`
  ).join(" ") + " Z";

  // Label positions (pushed out past the polygon)
  const labelPoints = axes.map((a, i) => {
    const [x, y] = point(i, r + 24);
    return { x, y, label: a.label, score: a.score };
  });

  // Color based on overall score
  const avg = axes.reduce((s, a) => s + a.score, 0) / n;
  const fillColor = avg > 0.7 ? "rgba(120,160,100,0.15)"
    : avg > 0.45 ? "rgba(200,169,110,0.15)"
    : "rgba(180,80,80,0.15)";
  const strokeColor = avg > 0.7 ? "rgba(120,160,100,0.6)"
    : avg > 0.45 ? "rgba(200,169,110,0.6)"
    : "rgba(180,80,80,0.6)";

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block", margin: "0 auto" }}>
      {/* Grid rings */}
      {ringPaths.map((d, i) => (
        <path key={`ring-${i}`} d={d} fill="none" stroke="rgba(180,150,90,0.06)" strokeWidth={0.5} />
      ))}
      {/* Axis lines */}
      {axisLines.map((l, i) => (
        <line key={`axis-${i}`} {...l} stroke="rgba(180,150,90,0.08)" strokeWidth={0.5} />
      ))}
      {/* Data polygon */}
      <path d={dataPath} fill={fillColor} stroke={strokeColor} strokeWidth={1.5}
        style={{ transition: "d 0.4s ease, fill 0.4s, stroke 0.4s" }} />
      {/* Data points */}
      {dataPoints.map((p, i) => (
        <circle key={`pt-${i}`} cx={p[0]} cy={p[1]} r={2.5}
          fill={strokeColor} style={{ transition: "cx 0.4s, cy 0.4s" }} />
      ))}
      {/* Labels */}
      {labelPoints.map((lp, i) => (
        <text key={`lbl-${i}`} x={lp.x} y={lp.y}
          textAnchor="middle" dominantBaseline="central"
          fill={lp.score < 0.4 ? "rgba(180,80,80,0.7)" : "rgba(180,150,90,0.45)"}
          fontSize="7.5" fontFamily="'JetBrains Mono',monospace" letterSpacing="0.5">
          {lp.label}
        </text>
      ))}
    </svg>
  );
}

// ── Main component ───────────────────────────────────────────────

const CSS = `
  .cs-wrap{padding:0.8rem 0;font-size:0.75rem}
  .cs-title{font-family:'JetBrains Mono',monospace;font-size:0.55rem;letter-spacing:0.25em;color:#252a35;text-transform:uppercase;margin-bottom:0.7rem}
  .cs-overall{display:flex;align-items:baseline;gap:0.5rem;margin-bottom:0.9rem}
  .cs-number{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;line-height:1}
  .cs-number.good{color:#8aaa70}
  .cs-number.mid{color:#c8a96e}
  .cs-number.low{color:#b06060}
  .cs-label{font-family:'JetBrains Mono',monospace;font-size:0.55rem;color:#3a3f50;letter-spacing:0.15em}
  .cs-axis-list{margin-top:0.8rem;display:flex;flex-direction:column;gap:0.5rem}
  .cs-axis{padding:0.5rem 0;border-bottom:1px solid rgba(180,150,90,0.04)}
  .cs-axis-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem}
  .cs-axis-name{font-family:'JetBrains Mono',monospace;font-size:0.6rem;letter-spacing:0.1em}
  .cs-axis-name.good{color:#8aaa70}
  .cs-axis-name.mid{color:#9a9880}
  .cs-axis-name.low{color:#b06060}
  .cs-axis-score{font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#5a6070}
  .cs-axis-bar{height:2px;background:rgba(255,255,255,0.03);margin-bottom:0.3rem;position:relative;overflow:hidden}
  .cs-axis-fill{height:100%;position:absolute;left:0;top:0;transition:width 0.5s ease}
  .cs-axis-fill.good{background:#8aaa70}
  .cs-axis-fill.mid{background:#c8a96e}
  .cs-axis-fill.low{background:#b06060}
  .cs-axis-note{font-family:'Georgia',serif;font-size:0.72rem;color:#3a4050;line-height:1.5}
  .cs-coach-btn{margin-top:1rem;width:100%;padding:0.6rem;background:transparent;border:1px solid rgba(180,150,90,0.15);color:#5a6070;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:0.58rem;letter-spacing:0.15em;text-transform:uppercase;transition:all 0.2s}
  .cs-coach-btn:hover{border-color:rgba(200,169,110,0.35);color:#c8a96e}
`;

function scoreClass(s: number): string {
  return s > 0.7 ? "good" : s > 0.45 ? "mid" : "low";
}

export default function CoherenceScore({ profile, absences, onCoachRequest }: Props) {
  const [axes, setAxes] = useState<CoherenceAxis[]>([]);

  useEffect(() => {
    if (profile?.semantic_columns?.length > 0) {
      setAxes(computeAxes(profile, absences));
    }
  }, [profile, absences]);

  if (axes.length === 0) return null;

  const overall = axes.reduce((s, a) => s + a.score, 0) / axes.length;
  const pct = Math.round(overall * 100);

  return (
    <div className="cs-wrap">
      <style>{CSS}</style>
      <div className="cs-title">Schema Coherence</div>

      <div className="cs-overall">
        <span className={`cs-number ${scoreClass(overall)}`}>{pct}</span>
        <span className="cs-label">/ 100</span>
      </div>

      <RadarPolygon axes={axes} size={200} />

      <div className="cs-axis-list">
        {axes.map(a => (
          <div key={a.key} className="cs-axis">
            <div className="cs-axis-header">
              <span className={`cs-axis-name ${scoreClass(a.score)}`}>{a.label}</span>
              <span className="cs-axis-score">{Math.round(a.score * 100)}</span>
            </div>
            <div className="cs-axis-bar">
              <div className={`cs-axis-fill ${scoreClass(a.score)}`}
                style={{ width: `${a.score * 100}%` }} />
            </div>
            <div className="cs-axis-note">{a.explanation}</div>
          </div>
        ))}
      </div>

      {onCoachRequest && (
        <button className="cs-coach-btn" onClick={() => onCoachRequest(axes)}>
          Get coaching recommendations →
        </button>
      )}
    </div>
  );
}
