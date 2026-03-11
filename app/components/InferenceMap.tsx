"use client";
import { useEffect, useRef, useState } from "react";

interface Absence {
  domain: string;
  absence: string;
  significance: string;
}

interface Props {
  absences: Absence[];
  lens_summary: string;
  datasetName: string;
}

interface Node {
  id: string;
  label: string;
  sub?: string;
  type: "source" | "decision" | "foreclosed";
  x: number;
  y: number;
}

interface Edge {
  from: string;
  to: string;
  label?: string;
}

// Maps absence domain to a collection decision
const DECISION_MAP: Record<string, { decision: string; mechanism: string }> = {
  "Economic":    { decision: "Administrative unit: household income", mechanism: "Tax/survey records → income only" },
  "Health":      { decision: "Physical disability as proxy for health", mechanism: "ADA compliance categories" },
  "Basic needs": { decision: "Housing cost burden as poverty signal", mechanism: "Housing survey methodology" },
  "Default":     { decision: "Administrative record collection", mechanism: "Agency reporting requirements" },
};

export default function InferenceMap({ absences, lens_summary, datasetName }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  // Build graph nodes and edges
  const W = 680;
  const ROW_H = 90;
  const H = Math.max(320, absences.length * ROW_H + 100);

  const sourceNode: Node = {
    id: "source",
    label: datasetName,
    sub: "Collection event",
    type: "source",
    x: 80, y: H / 2,
  };

  const decisionNodes: Node[] = absences.map((ab, i) => {
    const dm = DECISION_MAP[ab.domain] || DECISION_MAP["Default"];
    return {
      id: `dec_${i}`,
      label: dm.decision,
      sub: dm.mechanism,
      type: "decision",
      x: 290,
      y: 60 + i * ROW_H,
    };
  });

  const foreclosedNodes: Node[] = absences.map((ab, i) => ({
    id: `fc_${i}`,
    label: ab.absence,
    sub: ab.significance,
    type: "foreclosed",
    x: 530,
    y: 60 + i * ROW_H,
  }));

  const edges: Edge[] = [
    ...decisionNodes.map((d) => ({ from: "source", to: d.id })),
    ...decisionNodes.map((d, i) => ({ from: d.id, to: `fc_${i}`, label: "forecloses" })),
  ];

  const allNodes = [sourceNode, ...decisionNodes, ...foreclosedNodes];

  function nodeColor(type: Node["type"], isHovered: boolean) {
    if (type === "source")     return isHovered ? "#c8a96e" : "#9a7a40";
    if (type === "decision")   return isHovered ? "#c8a96e" : "#5a6478";
    if (type === "foreclosed") return isHovered ? "#c06060" : "#4a3838";
    return "#5a6478";
  }

  function nodeBorder(type: Node["type"]) {
    if (type === "source")     return "#c8a96e";
    if (type === "decision")   return "rgba(180,150,90,0.3)";
    if (type === "foreclosed") return "rgba(180,60,60,0.3)";
    return "rgba(180,150,90,0.2)";
  }

  function getEdgePath(from: Node, to: Node): string {
    const cx = (from.x + to.x) / 2;
    return `M ${from.x} ${from.y} C ${cx} ${from.y}, ${cx} ${to.y}, ${to.x} ${to.y}`;
  }

  const NODE_W = 160;
  const NODE_H = 52;

  return (
    <div style={{
      background: "rgba(7,9,15,0.97)",
      border: "1px solid rgba(180,150,90,0.1)",
      marginTop: "1.5rem",
      padding: "1.2rem",
    }}>
      <div style={{
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: "0.55rem",
        letterSpacing: "0.3em",
        color: "#3a3f50",
        textTransform: "uppercase",
        marginBottom: "0.8rem",
      }}>
        Inference Constraint Map
      </div>

      <div style={{ display: "flex", gap: "1.5rem", marginBottom: "0.7rem", alignItems: "center" }}>
        {[
          { color: "#9a7a40", border: "#c8a96e", label: "Collection event" },
          { color: "#5a6478", border: "rgba(180,150,90,0.3)", label: "Collection decision" },
          { color: "#4a3838", border: "rgba(180,60,60,0.3)", label: "Foreclosed inference" },
        ].map(l => (
          <div key={l.label} style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <div style={{
              width: 10, height: 10,
              background: l.color,
              border: `1px solid ${l.border}`,
            }} />
            <span style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: "0.52rem",
              color: "#2a2f3a",
              letterSpacing: "0.1em",
            }}>{l.label}</span>
          </div>
        ))}
      </div>

      <div style={{ overflowX: "auto" }}>
        <svg
          ref={svgRef}
          width={W}
          height={H}
          style={{ display: "block" }}
          onMouseLeave={() => { setHovered(null); setTooltip(null); }}
        >
          <defs>
            <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="rgba(180,150,90,0.25)" />
            </marker>
            <marker id="arrow-fc" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="rgba(180,60,60,0.25)" />
            </marker>
          </defs>

          {/* Edges */}
          {edges.map((e, i) => {
            const fromNode = allNodes.find(n => n.id === e.from)!;
            const toNode = allNodes.find(n => n.id === e.to)!;
            const isFc = e.label === "forecloses";
            const isActive = hovered === e.from || hovered === e.to;
            const fromX = fromNode.x + (fromNode.type === "source" ? NODE_W / 2 : NODE_W / 2);
            const toX = toNode.x - NODE_W / 2;
            const fromY = fromNode.y;
            const toY = toNode.y;

            return (
              <g key={i}>
                <path
                  d={getEdgePath({ ...fromNode, x: fromX, y: fromY }, { ...toNode, x: toX, y: toY })}
                  fill="none"
                  stroke={isFc
                    ? (isActive ? "rgba(180,60,60,0.5)" : "rgba(180,60,60,0.15)")
                    : (isActive ? "rgba(200,169,110,0.4)" : "rgba(200,169,110,0.1)")
                  }
                  strokeWidth={isActive ? 1.5 : 1}
                  markerEnd={isFc ? "url(#arrow-fc)" : "url(#arrow)"}
                  style={{ transition: "stroke 0.2s, stroke-width 0.2s" }}
                />
                {isFc && e.label && (
                  <text
                    x={(fromX + toX) / 2}
                    y={(fromY + toY) / 2 - 5}
                    textAnchor="middle"
                    fill={isActive ? "rgba(180,60,60,0.6)" : "rgba(180,60,60,0.2)"}
                    fontSize="8"
                    fontFamily="'JetBrains Mono',monospace"
                    letterSpacing="1"
                    style={{ transition: "fill 0.2s" }}
                  >
                    forecloses
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {allNodes.map((node) => {
            const isH = hovered === node.id;
            const x = node.x - NODE_W / 2;
            const y = node.y - NODE_H / 2;

            return (
              <g
                key={node.id}
                onMouseEnter={(evt) => {
                  setHovered(node.id);
                  if (node.sub) {
                    const rect = svgRef.current?.getBoundingClientRect();
                    setTooltip({
                      x: node.x,
                      y: node.y - NODE_H / 2 - 12,
                      text: node.sub,
                    });
                  }
                }}
                onMouseLeave={() => { setHovered(null); setTooltip(null); }}
                style={{ cursor: "default" }}
              >
                <rect
                  x={x} y={y}
                  width={NODE_W} height={NODE_H}
                  fill={nodeColor(node.type, isH)}
                  stroke={nodeBorder(node.type)}
                  strokeWidth={isH ? 1.5 : 1}
                  rx={1}
                  style={{ transition: "fill 0.2s, stroke-width 0.2s" }}
                />
                <foreignObject x={x + 6} y={y + 4} width={NODE_W - 12} height={NODE_H - 8}>
                  <div
                    style={{
                      fontFamily: "'Cormorant Garamond',serif",
                      fontSize: "11px",
                      color: node.type === "foreclosed"
                        ? (isH ? "#e8a0a0" : "#907070")
                        : (isH ? "#e8d8a8" : "#9a9880"),
                      lineHeight: 1.35,
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {node.label}
                  </div>
                </foreignObject>
              </g>
            );
          })}

          {/* Tooltip */}
          {tooltip && (
            <g>
              <rect
                x={tooltip.x - 120}
                y={tooltip.y - 28}
                width={240} height={26}
                fill="rgba(7,9,15,0.95)"
                stroke="rgba(180,150,90,0.2)"
                rx={1}
              />
              <text
                x={tooltip.x}
                y={tooltip.y - 12}
                textAnchor="middle"
                fill="#5a6070"
                fontSize="9"
                fontFamily="'JetBrains Mono',monospace"
                letterSpacing="0.5"
              >
                {tooltip.text.length > 48 ? tooltip.text.slice(0, 48) + "…" : tooltip.text}
              </text>
            </g>
          )}

          {/* Column labels */}
          {[
            { x: 80, label: "Dataset" },
            { x: 290, label: "Collection decision" },
            { x: 530, label: "Inference foreclosed" },
          ].map(col => (
            <text
              key={col.label}
              x={col.x}
              y={18}
              textAnchor="middle"
              fill="#252a35"
              fontSize="8"
              fontFamily="'JetBrains Mono',monospace"
              letterSpacing="1.5"
              textDecoration="none"
            >
              {col.label.toUpperCase()}
            </text>
          ))}
        </svg>
      </div>

      <div style={{
        marginTop: "0.8rem",
        fontFamily: "'Georgia',serif",
        fontSize: "0.75rem",
        color: "#3a4050",
        lineHeight: 1.7,
        borderTop: "1px solid rgba(180,150,90,0.07)",
        paddingTop: "0.7rem",
      }}>
        {lens_summary}
      </div>
    </div>
  );
}
