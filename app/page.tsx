"use client";

import { useState } from "react";
import { SourceCard } from "./components/SourceCard";
import { DivergenceTable } from "./components/DivergenceTable";
import { TimelineChart } from "./components/TimelineChart";

type Tab = "snapshot" | "timeline";

function todayString() {
  return new Date().toISOString().split("T")[0];
}

function weekAgoString() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().split("T")[0];
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("snapshot");
  const [topic, setTopic] = useState("");
  const [date, setDate] = useState(todayString());
  const [startDate, setStartDate] = useState(weekAgoString());
  const [endDate, setEndDate] = useState(todayString());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Snapshot state
  const [snapshotData, setSnapshotData] = useState<{
    sources: Array<{
      source_name: string;
      source_type: string;
      calibration: string;
      dimensions: Record<string, number>;
      coherence: number;
      veritas: { authenticity_score: number; flags: string[] } | null;
    }>;
    divergence: Record<
      string,
      { label: string; mean: number; std_dev: number; variance: number }
    >;
  } | null>(null);

  // Timeline state
  const [timelineData, setTimelineData] = useState<
    Array<{
      date: string;
      psi: number;
      rho: number;
      q: number;
      f: number;
      tau: number;
      lambda: number;
      coherence: number;
      sourceCount: number;
    }>
  >([]);

  async function handleSnapshot() {
    if (!topic.trim()) return;
    setLoading(true);
    setError(null);
    setSnapshotData(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim().toUpperCase(), date }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setSnapshotData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleTimeline() {
    if (!topic.trim()) return;
    setLoading(true);
    setError(null);
    setTimelineData([]);

    try {
      const res = await fetch("/api/timeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim().toUpperCase(),
          startDate,
          endDate,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setTimelineData(data.timeline || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Timeline failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-teal-500" />
            <h1 className="text-lg font-semibold tracking-tight">
              Rose Glass News
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1 ml-6">
            IPAI Dimensional News Analysis
          </p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Tabs */}
        <div className="flex gap-1 bg-slate-900 rounded-lg p-1 w-fit">
          <button
            onClick={() => setTab("snapshot")}
            className={`px-4 py-2 text-sm rounded-md transition-colors ${
              tab === "snapshot"
                ? "bg-teal-600 text-white"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Story Snapshot
          </button>
          <button
            onClick={() => setTab("timeline")}
            className={`px-4 py-2 text-sm rounded-md transition-colors ${
              tab === "timeline"
                ? "bg-teal-600 text-white"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Story Timeline
          </button>
        </div>

        {/* Search */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-slate-500 mb-1">Topic</label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="IRAN, CLIMATE, ELECTION..."
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  tab === "snapshot" ? handleSnapshot() : handleTimeline();
                }
              }}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-teal-500 transition-colors"
            />
          </div>

          {tab === "snapshot" ? (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 transition-colors"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Start
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  End
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 transition-colors"
                />
              </div>
            </>
          )}

          <button
            onClick={tab === "snapshot" ? handleSnapshot : handleTimeline}
            disabled={loading || !topic.trim()}
            className="px-6 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-700 disabled:text-slate-500 text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? "Analyzing..." : "Analyze"}
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <div className="w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
            {tab === "snapshot"
              ? "Querying GDELT and running Rose Glass analysis..."
              : "Building timeline across date range..."}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-950/50 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Snapshot Results */}
        {tab === "snapshot" && snapshotData && (
          <div className="space-y-8">
            {snapshotData.sources.length === 0 ? (
              <div className="text-sm text-slate-500">
                No sources found for this topic and date.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {snapshotData.sources.map((source, i) => (
                    <SourceCard key={i} source={source} />
                  ))}
                </div>

                {Object.keys(snapshotData.divergence).length > 0 && (
                  <DivergenceTable divergence={snapshotData.divergence} />
                )}
              </>
            )}
          </div>
        )}

        {/* Timeline Results */}
        {tab === "timeline" && timelineData.length > 0 && (
          <TimelineChart data={timelineData} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 mt-16">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <p className="text-xs text-slate-600">
            Rose Glass translates dimensional emphasis — it does not judge.
            No source is ranked better or worse.
          </p>
        </div>
      </footer>
    </div>
  );
}
