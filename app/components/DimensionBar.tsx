"use client";

const DIMENSION_COLORS: Record<string, string> = {
  psi: "#0d9488",
  rho: "#6366f1",
  q: "#f59e0b",
  f: "#ec4899",
  tau: "#8b5cf6",
  lambda: "#ef4444",
};

const DIMENSION_LABELS: Record<string, string> = {
  psi: "\u03A8 Consistency",
  rho: "\u03C1 Wisdom",
  q: "q Activation",
  f: "f Social",
  tau: "\u03C4 Temporal",
  lambda: "\u03BB Decay",
};

export function DimensionBar({
  dimension,
  value,
}: {
  dimension: string;
  value: number;
}) {
  const color = DIMENSION_COLORS[dimension] || "#64748b";
  const label = DIMENSION_LABELS[dimension] || dimension;
  const pct = Math.min(Math.max(value * 100, 0), 100);

  return (
    <div className="flex items-center gap-3">
      <span className="w-28 text-xs text-slate-400 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-12 text-xs text-slate-500 text-right tabular-nums">
        {value.toFixed(3)}
      </span>
    </div>
  );
}

export { DIMENSION_COLORS, DIMENSION_LABELS };
