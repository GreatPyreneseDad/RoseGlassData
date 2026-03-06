"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
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

const ALL_DIMS = ["psi", "rho", "q", "f", "tau", "lambda", "coherence"];
const COHERENCE_COLOR = "#94a3b8";

export function TimelineChart({ data }: { data: TimelinePoint[] }) {
  const [visible, setVisible] = useState<Record<string, boolean>>({
    psi: true,
    rho: true,
    q: true,
    f: true,
    tau: true,
    lambda: true,
    coherence: true,
  });

  const toggle = (dim: string) => {
    setVisible((prev) => ({ ...prev, [dim]: !prev[dim] }));
  };

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
        No timeline data available
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {ALL_DIMS.map((dim) => {
          const color =
            dim === "coherence"
              ? COHERENCE_COLOR
              : DIMENSION_COLORS[dim] || "#64748b";
          const label =
            dim === "coherence" ? "Coherence" : DIMENSION_LABELS[dim] || dim;
          return (
            <button
              key={dim}
              onClick={() => toggle(dim)}
              className={`px-3 py-1 text-xs rounded-full border transition-all ${
                visible[dim]
                  ? "border-transparent text-white"
                  : "border-slate-700 text-slate-500 bg-transparent"
              }`}
              style={
                visible[dim] ? { backgroundColor: color + "33", color } : {}
              }
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="date"
              tick={{ fill: "#64748b", fontSize: 11 }}
              tickLine={{ stroke: "#334155" }}
              axisLine={{ stroke: "#334155" }}
            />
            <YAxis
              domain={[0, 1]}
              tick={{ fill: "#64748b", fontSize: 11 }}
              tickLine={{ stroke: "#334155" }}
              axisLine={{ stroke: "#334155" }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0f172a",
                border: "1px solid #1e293b",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              labelStyle={{ color: "#94a3b8" }}
            />
            <Legend
              wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }}
            />
            {ALL_DIMS.map((dim) => {
              if (!visible[dim]) return null;
              const color =
                dim === "coherence"
                  ? COHERENCE_COLOR
                  : DIMENSION_COLORS[dim] || "#64748b";
              return (
                <Line
                  key={dim}
                  type="monotone"
                  dataKey={dim}
                  stroke={color}
                  strokeWidth={2}
                  dot={{ r: 3, fill: color }}
                  name={
                    dim === "coherence"
                      ? "Coherence"
                      : DIMENSION_LABELS[dim] || dim
                  }
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
