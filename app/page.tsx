"use client";

import { useState } from "react";
import { SourceCard } from "./components/SourceCard";
import { SourceRadar } from "./components/SourceRadar";
import { DivergenceTable } from "./components/DivergenceTable";
import { TimelineChart } from "./components/TimelineChart";
import { TimelineHeatmap } from "./components/TimelineHeatmap";
import { TimelineChatPanel } from "./components/TimelineChatPanel";
import { ChatPanel } from "./components/ChatPanel";
import { TopicBrowser } from "./components/TopicBrowser";

type Tab = "snapshot" | "timeline";
type SnapshotView = "cards" | "radar";
type TimelineView = "chart" | "heatmap";

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
  const [loadingStage, setLoadingStage] = useState<"checking" | "fetching" | "scoring">("checking");
  const [error, setError] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);

  // View toggles
  const [snapshotView, setSnapshotView] = useState<SnapshotView>("cards");
  const [timelineView, setTimelineView] = useState<TimelineView>("chart");

  const [snapshotData, setSnapshotData] = useState<{
    sources: Array<{
      source_name: string;
      source_type: string;
      calibration: string;
      dimensions: Record<string, number>;
      coherence: number;
      veritas: { authenticity_score: number; flags: string[] } | null;
    }>;
    divergence: Record<string, { label: string; mean: number; std_dev: number; variance: number }>;
  } | null>(null);

  const [timelineData, setTimelineData] = useState<Array<{
    date: string; psi: number; rho: number; q: number;
    f: number; tau: number; lambda: number; coherence: number; sourceCount: number;
  }>>([]);

  const [timelineMeta, setTimelineMeta] = useState<{
    topic: string; startDate: string; endDate: string;
  } | null>(null);

  async function handleSnapshot() {
    if (!topic.trim()) return;
    setLoading(true);
    setLoadingStage("checking");
    setError(null);
    setSnapshotData(null);
    setAnalysisId(null);

    // Stage timer — if still loading after 3s, assume live fetch
    const stageTimer = setTimeout(() => setLoadingStage("fetching"), 3000);
    const scoreTimer = setTimeout(() => setLoadingStage("scoring"), 20000);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim().toUpperCase(), date }),
      });
      if (!res.ok) {
        const errData = await res.json();
        const msg = errData.error || `HTTP ${res.status}`;
        if (res.status === 404 || msg.includes("No articles")) {
          throw new Error("No international coverage found for this topic on this date. Rose Glass runs on GDELT, which indexes global news sources. Try a geopolitical topic (country, conflict, policy) or a different date.");
        }
        throw new Error(msg);
      }
      const data = await res.json();
      setSnapshotData(data);
      if (data.analysis_id) setAnalysisId(data.analysis_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      clearTimeout(stageTimer);
      clearTimeout(scoreTimer);
      setLoading(false);
    }
  }

  async function handleTimeline() {
    if (!topic.trim()) return;
    setLoading(true);
    setError(null);
    setTimelineData([]);
    setTimelineMeta(null);

    const normalizedTopic = topic.trim().toUpperCase();
    try {
      const res = await fetch("/api/timeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: normalizedTopic, startDate, endDate }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      const data = await res.json();
      setTimelineData(data.timeline || []);
      if (data.timeline?.length > 0) {
        setTimelineMeta({ topic: normalizedTopic, startDate, endDate });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Timeline failed");
    } finally {
      setLoading(false);
    }
  }

  function handleAnalyze() {
    tab === "snapshot" ? handleSnapshot() : handleTimeline();
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-teal-500" />
            <h1 className="text-lg font-semibold tracking-tight">Rose Glass News</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1 ml-6">IPAI Dimensional News Analysis</p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-900 rounded-lg p-1 w-fit">
          {(["snapshot", "timeline"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm rounded-md transition-colors capitalize ${
                tab === t ? "bg-teal-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Story {t === "snapshot" ? "Snapshot" : "Timeline"}
            </button>
          ))}
        </div>

        {/* Search row */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-slate-500 mb-1">Topic</label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Country, conflict, or policy topic..."
              onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-teal-500 transition-colors"
            />
          </div>

          {tab === "snapshot" ? (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 transition-colors" />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Start</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 transition-colors" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">End</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 transition-colors" />
              </div>
            </>
          )}

          <button onClick={handleAnalyze} disabled={loading || !topic.trim()}
            className="px-6 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-700 disabled:text-slate-500 text-sm font-medium rounded-lg transition-colors">
            {loading ? "Analyzing..." : "Analyze"}
          </button>
        </div>

        {/* Topic browser — pre-loaded from DB */}
        <TopicBrowser onSelect={(t) => { setTopic(t); }} />

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <div className="w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
            {tab === "timeline" ? "Building timeline across date range..." :
          loadingStage === "checking" ? "Checking cache..." :
          loadingStage === "fetching" ? "Querying GDELT for global coverage — first fetch takes ~30s..." :
          "Running Rose Glass dimensional analysis..."}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-950/50 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">{error}</div>
        )}

        {/* ── Snapshot Results ── */}
        {tab === "snapshot" && snapshotData && (
          <div className="space-y-6">
            {snapshotData.sources.length === 0 ? (
              <div className="text-sm text-slate-500">No sources found for this topic and date.</div>
            ) : (
              <>
                {/* View toggle */}
                <div className="flex gap-1 bg-slate-900 rounded-lg p-1 w-fit">
                  {(["cards", "radar"] as SnapshotView[]).map((v) => (
                    <button key={v} onClick={() => setSnapshotView(v)}
                      className={`px-3 py-1.5 text-xs rounded-md transition-colors capitalize ${
                        snapshotView === v ? "bg-teal-600 text-white" : "text-slate-400 hover:text-white"
                      }`}>
                      {v === "cards" ? "Source Cards" : "Radar Overlay"}
                    </button>
                  ))}
                </div>

                {snapshotView === "cards" ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {snapshotData.sources.map((source, i) => (
                      <SourceCard key={i} source={source} />
                    ))}
                  </div>
                ) : (
                  <SourceRadar sources={snapshotData.sources} />
                )}

                {Object.keys(snapshotData.divergence).length > 0 && (
                  <DivergenceTable divergence={snapshotData.divergence} />
                )}

                {analysisId && <ChatPanel analysisId={analysisId} />}
              </>
            )}
          </div>
        )}

        {/* ── Timeline Results ── */}
        {tab === "timeline" && timelineData.length > 0 && (
          <div className="space-y-6">
            {/* View toggle */}
            <div className="flex gap-1 bg-slate-900 rounded-lg p-1 w-fit">
              {(["chart", "heatmap"] as TimelineView[]).map((v) => (
                <button key={v} onClick={() => setTimelineView(v)}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors capitalize ${
                    timelineView === v ? "bg-teal-600 text-white" : "text-slate-400 hover:text-white"
                  }`}>
                  {v === "chart" ? "Line Chart" : "Heatmap"}
                </button>
              ))}
            </div>

            {timelineView === "chart" ? (
              <TimelineChart data={timelineData} />
            ) : (
              <TimelineHeatmap data={timelineData} />
            )}

            {timelineMeta && (
              <TimelineChatPanel
                topic={timelineMeta.topic}
                startDate={timelineMeta.startDate}
                endDate={timelineMeta.endDate}
                timeline={timelineData}
              />
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-slate-800 mt-16">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <p className="text-xs text-slate-600">
            Rose Glass translates dimensional emphasis — it does not judge. No source is ranked better or worse.
          </p>
        </div>
      </footer>
    </div>
  );
}
