"use client";

import { DIMENSION_COLORS, DIMENSION_LABELS } from "./DimensionBar";

interface TimelinePoint {
  date: string;
  psi: number;
  rho: number;
  q: number;
  f: number;
  tau: number;
  lambda: number;
  coherence: number;
  sourceCount: number;
}

const DIMS = ["psi", "rho", "q", "f", "tau", "lambda"] as const;

function cellColor(value: number, dim: string): string {
  const base = DIMENSION_COLORS[dim] || "#64748b";
  const opacity = Math.round(Math.min(Math.max(value, 0), 1) * 200 + 30);
  const hex = opacity.toString(16).padStart(2, "0");
  return base + hex;
}

function textColor(value: number): string {
  return value > 0.6 ? "#ffffff" : "#94a3b8";
}

export function TimelineHeatmap({ data }: { data: TimelinePoint[] }) {
  if (data.length === 0) return null;

  // Detect inflection points: value change > 0.15 from previous day
  function isInflection(i: number, dim: typeof DIMS[number]): boolean {
    if (i === 0) return false;
    return Math.abs(data[i][dim] - data[i - 1][dim]) > 0.15;
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-800">
        <h3 className="text-sm font-semibold text-white">Dimensional Heatmap</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Color intensity = value · <span className="text-amber-400">●</span> = inflection (&gt;0.15 shift)
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left px-4 py-2 text-slate-500 font-medium w-28">Dim</th>
              {data.map((d) => (
                <th key={d.date} className="text-center px-2 py-2 text-slate-500 font-medium min-w-[60px]">
                  {d.date.slice(5)} {/* MM-DD */}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DIMS.map((dim) => (
              <tr key={dim} className="border-b border-slate-800/50 last:border-0">
                <td className="px-4 py-2 font-medium" style={{ color: DIMENSION_COLORS[dim] }}>
                  {DIMENSION_LABELS[dim]}
                </td>
                {data.map((d, i) => {
                  const val = d[dim] ?? 0;
                  const inflect = isInflection(i, dim);
                  return (
                    <td
                      key={d.date}
                      className="text-center px-2 py-2 relative"
                      style={{
                        backgroundColor: cellColor(val, dim),
                        color: textColor(val),
                      }}
                      title={`${dim} = ${val.toFixed(3)}`}
                    >
                      {val.toFixed(2)}
                      {inflect && (
                        <span className="absolute top-0.5 right-0.5 text-amber-400 text-[8px]">●</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-t border-slate-700">
              <td className="px-4 py-2 text-slate-500 font-medium">sources</td>
              {data.map((d) => (
                <td key={d.date} className="text-center px-2 py-2 text-slate-500">
                  {d.sourceCount}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
