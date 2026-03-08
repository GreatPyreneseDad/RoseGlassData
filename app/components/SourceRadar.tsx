"use client";

import { useState, useCallback } from "react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { DIMENSION_COLORS } from "./DimensionBar";

interface SourceData {
  source_name: string;
  source_type: string;
  calibration: string;
  dimensions: Record<string, number>;
  coherence: number;
  veritas: { authenticity_score: number; flags: string[] } | null;
}

// I(d) = σ²(source₁(d), source₂(d), ... sourceₙ(d)), normalized to 0-1
function computeInterferencePolygon(
  sources: SourceData[],
  dims: { key: string }[]
): Record<string, number> {
  if (sources.length < 2) return {};

  const result: Record<string, number> = {};

  for (const { key } of dims) {
    const values = sources.map((s) => s.dimensions[key] ?? 0);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    // Variance of values in [0,1] has max theoretical value of 0.25 (binary split)
    // Normalize to 0-1: multiply by 4
    result[key] = Math.min(variance * 4, 1);
  }

  return result;
}

// Per-dimension: which sources are high vs low (for hover attribution)
function getDimensionAttribution(
  sources: SourceData[],
  dimKey: string
): { high: string[]; low: string[]; spread: number } {
  const vals = sources.map((s) => ({
    name: s.source_name.split(" ")[0],
    v: s.dimensions[dimKey] ?? 0,
  }));
  const mean = vals.reduce((a, b) => a + b.v, 0) / vals.length;
  const spread = Math.max(...vals.map((v) => v.v)) - Math.min(...vals.map((v) => v.v));
  return {
    high: vals.filter((v) => v.v > mean + 0.05).map((v) => v.name),
    low: vals.filter((v) => v.v < mean - 0.05).map((v) => v.name),
    spread,
  };
}

const DIMS = [
  { key: "psi", label: "Ψ Consistency" },
  { key: "rho", label: "ρ Wisdom" },
  { key: "q", label: "q Activation" },
  { key: "f", label: "f Social" },
  { key: "tau", label: "τ Temporal" },
  { key: "lambda", label: "λ Pressure" },
];

// What high interference on each dimension means
const INTERFERENCE_MEANINGS: Record<string, string> = {
  psi: "Sources contradict each other on internal logic — someone is being inconsistent",
  rho: "Depth of knowledge varies dramatically — credibility is contested",
  q: "Emotional framing of the story is being fought over",
  f: "Who this story is for is being contested — audience positioning conflict",
  tau: "Sources disagree on when this matters — temporal framing divergence",
  lambda: "The cultural lens conflict is itself the story — meta-level interference",
};

const SOURCE_COLORS = [
  "#0d9488", "#6366f1", "#f59e0b", "#ec4899", "#8b5cf6", "#ef4444",
  "#14b8a6", "#a855f7", "#fb923c", "#34d399",
];

// Interference polygon color — belongs to no source
const INTERFERENCE_COLOR = "#ffffff";

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  sources: SourceData[];
  showInterference: boolean;
  interferenceThreshold: number;
  interferencePolygon: Record<string, number>;
}

function CustomTooltip({
  active, payload, label, sources, showInterference, interferenceThreshold, interferencePolygon,
}: CustomTooltipProps) {
  if (!active || !payload || !label) return null;

  const dimKey = DIMS.find((d) => d.label === label)?.key;
  if (!dimKey) return null;

  const iVal = interferencePolygon[dimKey] ?? 0;
  const attribution = getDimensionAttribution(sources, dimKey);

  return (
    <div className="bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs max-w-xs shadow-xl">
      <div className="font-semibold text-white mb-2">{label}</div>

      {/* Source values */}
      {payload
        .filter((p) => p.name !== "Interference")
        .map((p) => (
          <div key={p.name} className="flex justify-between gap-4 mb-0.5">
            <span style={{ color: p.color }}>{p.name.split(" ")[0]}</span>
            <span className="text-slate-300 tabular-nums">{p.value}%</span>
          </div>
        ))}

      {/* Interference section */}
      {showInterference && iVal >= interferenceThreshold && (
        <div className="mt-2 pt-2 border-t border-slate-700">
          <div className="flex justify-between gap-4 mb-1">
            <span className="text-white font-medium">Interference</span>
            <span className="text-white tabular-nums">{Math.round(iVal * 100)}%</span>
          </div>
          <p className="text-slate-400 mb-1.5 leading-snug">{INTERFERENCE_MEANINGS[dimKey]}</p>
          {attribution.high.length > 0 && (
            <div className="text-slate-400">
              <span className="text-teal-400">↑ high: </span>{attribution.high.join(", ")}
            </div>
          )}
          {attribution.low.length > 0 && (
            <div className="text-slate-400">
              <span className="text-red-400">↓ low: </span>{attribution.low.join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SourceRadar({ sources }: { sources: SourceData[] }) {
  const [showInterference, setShowInterference] = useState(true);
  const [showSources, setShowSources] = useState(true);
  const [threshold, setThreshold] = useState(0.1); // 10% minimum variance to show

  const interferencePolygon = computeInterferencePolygon(sources, DIMS);

  // Find highest interference dimension
  const maxInterferenceDim = Object.entries(interferencePolygon).sort(
    ([, a], [, b]) => b - a
  )[0];

  // Build radar data
  const data = DIMS.map(({ key, label }) => {
    const entry: Record<string, number | string> = { dim: label };

    if (showSources) {
      sources.forEach((s) => {
        entry[s.source_name] = Math.round((s.dimensions[key] ?? 0) * 100);
      });
    }

    if (showInterference) {
      const iVal = interferencePolygon[key] ?? 0;
      entry["Interference"] = iVal >= threshold ? Math.round(iVal * 100) : 0;
    }

    return entry;
  });

  const tooltipRenderer = useCallback(
    (props: object) => (
      <CustomTooltip
        {...(props as CustomTooltipProps)}
        sources={sources}
        showInterference={showInterference}
        interferenceThreshold={threshold}
        interferencePolygon={interferencePolygon}
      />
    ),
    [sources, showInterference, threshold, interferencePolygon]
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Source Profiles + Interference Polygon</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            White shape = variance across sources. Where they diverge: signal.
          </p>
        </div>

        {/* Highest interference callout */}
        {maxInterferenceDim && (interferencePolygon[maxInterferenceDim[0]] ?? 0) > 0.15 && (
          <div className="text-right shrink-0">
            <div className="text-xs text-slate-500">Most contested</div>
            <div className="text-xs font-medium text-white">
              {DIMS.find((d) => d.key === maxInterferenceDim[0])?.label}
            </div>
            <div className="text-xs text-amber-400">
              {Math.round((interferencePolygon[maxInterferenceDim[0]] ?? 0) * 100)}% variance
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">

        {/* Layer toggles */}
        <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
          <button
            onClick={() => setShowSources((v) => !v)}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              showSources ? "bg-teal-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Sources
          </button>
          <button
            onClick={() => setShowInterference((v) => !v)}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              showInterference ? "bg-slate-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Interference
          </button>
        </div>

        {/* Threshold slider */}
        {showInterference && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>threshold</span>
            <input
              type="range"
              min={0}
              max={50}
              value={Math.round(threshold * 100)}
              onChange={(e) => setThreshold(Number(e.target.value) / 100)}
              className="w-20 accent-teal-500"
            />
            <span className="tabular-nums w-8">{Math.round(threshold * 100)}%</span>
          </div>
        )}

        {/* Source legend */}
        {showSources && (
          <div className="flex flex-wrap gap-1.5 ml-auto">
            {sources.map((s, i) => (
              <span
                key={s.source_name}
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: SOURCE_COLORS[i % SOURCE_COLORS.length] + "22",
                  color: SOURCE_COLORS[i % SOURCE_COLORS.length],
                }}
              >
                {s.source_name.split(" ")[0]}
              </span>
            ))}
            {showInterference && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white">
                ◇ interference
              </span>
            )}
          </div>
        )}
      </div>

      {/* Radar chart */}
      <ResponsiveContainer width="100%" height={320}>
        <RadarChart data={data}>
          <PolarGrid stroke="#1e293b" />
          <PolarAngleAxis
            dataKey="dim"
            tick={{ fill: "#64748b", fontSize: 11 }}
          />
          <Tooltip content={tooltipRenderer} />

          {/* Source profiles */}
          {showSources &&
            sources.map((s, i) => (
              <Radar
                key={s.source_name}
                name={s.source_name}
                dataKey={s.source_name}
                stroke={SOURCE_COLORS[i % SOURCE_COLORS.length]}
                fill={SOURCE_COLORS[i % SOURCE_COLORS.length]}
                fillOpacity={0.07}
                strokeWidth={1.5}
              />
            ))}

          {/* Interference Polygon — belongs to no source */}
          {showInterference && (
            <Radar
              name="Interference"
              dataKey="Interference"
              stroke={INTERFERENCE_COLOR}
              fill={INTERFERENCE_COLOR}
              fillOpacity={0.12}
              strokeWidth={2}
              strokeDasharray="4 2"
            />
          )}
        </RadarChart>
      </ResponsiveContainer>

      {/* Interference dimension breakdown */}
      {showInterference && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-2 border-t border-slate-800">
          {DIMS.map(({ key, label }) => {
            const iVal = interferencePolygon[key] ?? 0;
            if (iVal < threshold) return null;
            const isHot = iVal > 0.3;
            return (
              <div
                key={key}
                className={`rounded-lg p-2.5 border ${
                  isHot
                    ? "border-amber-800/50 bg-amber-950/30"
                    : "border-slate-700 bg-slate-800/50"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className="text-xs font-medium"
                    style={{ color: DIMENSION_COLORS[key] }}
                  >
                    {label}
                  </span>
                  <span
                    className={`text-xs tabular-nums font-mono ${
                      isHot ? "text-amber-400" : "text-slate-400"
                    }`}
                  >
                    {Math.round(iVal * 100)}%
                  </span>
                </div>
                <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${iVal * 100}%`,
                      backgroundColor: isHot ? "#f59e0b" : DIMENSION_COLORS[key],
                    }}
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1.5 leading-snug line-clamp-2">
                  {INTERFERENCE_MEANINGS[key]}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
