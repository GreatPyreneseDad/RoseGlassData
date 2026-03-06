"use client";

import { DimensionBar } from "./DimensionBar";

interface SourceData {
  source_name: string;
  source_type: string;
  calibration: string;
  dimensions: Record<string, number>;
  coherence: number;
  veritas: {
    authenticity_score: number;
    flags: string[];
  } | null;
}

export function SourceCard({ source }: { source: SourceData }) {
  const dims = ["psi", "rho", "q", "f", "tau", "lambda"] as const;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white truncate">
          {source.source_name}
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          {source.source_type} &middot; {source.calibration}
        </p>
      </div>

      <div className="space-y-2">
        {dims.map((dim) => (
          <DimensionBar
            key={dim}
            dimension={dim}
            value={source.dimensions[dim] ?? 0}
          />
        ))}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-slate-800">
        <div>
          <span className="text-xs text-slate-500">Coherence</span>
          <span className="ml-2 text-sm font-mono text-teal-400">
            {source.coherence.toFixed(3)}
          </span>
        </div>
        {source.veritas && (
          <div>
            <span className="text-xs text-slate-500">Veritas</span>
            <span className="ml-2 text-sm font-mono text-teal-400">
              {source.veritas.authenticity_score.toFixed(2)}
            </span>
            {source.veritas.flags.length > 0 && (
              <span className="ml-2 text-xs text-amber-400">
                {source.veritas.flags.join(", ")}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
