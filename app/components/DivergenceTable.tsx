"use client";

import { DIMENSION_LABELS } from "./DimensionBar";

interface DivergenceData {
  [dim: string]: {
    label: string;
    mean: number;
    std_dev: number;
    variance: number;
  };
}

export function DivergenceTable({
  divergence,
}: {
  divergence: DivergenceData;
}) {
  const sorted = Object.entries(divergence).sort(
    ([, a], [, b]) => b.std_dev - a.std_dev
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-800">
        <h3 className="text-sm font-semibold text-white">
          Divergence Analysis
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          High variance = most contested across sources
        </p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500 border-b border-slate-800">
            <th className="text-left px-5 py-2 font-medium">Dimension</th>
            <th className="text-right px-5 py-2 font-medium">Std Dev</th>
            <th className="text-right px-5 py-2 font-medium">Mean</th>
            <th className="px-5 py-2 font-medium text-left">Spread</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(([dim, info]) => {
            const barWidth = Math.min(info.std_dev * 200, 100);
            const isTop = sorted[0][0] === dim;
            return (
              <tr
                key={dim}
                className="border-b border-slate-800/50 last:border-0"
              >
                <td className="px-5 py-2 text-slate-300">
                  {DIMENSION_LABELS[dim] || info.label}
                </td>
                <td
                  className={`px-5 py-2 text-right font-mono ${
                    isTop ? "text-amber-400" : "text-slate-400"
                  }`}
                >
                  {info.std_dev.toFixed(4)}
                </td>
                <td className="px-5 py-2 text-right font-mono text-slate-400">
                  {info.mean.toFixed(4)}
                </td>
                <td className="px-5 py-2">
                  <div className="h-2 bg-slate-800 rounded-full w-24">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${barWidth}%`,
                        backgroundColor: isTop ? "#f59e0b" : "#0d9488",
                      }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
