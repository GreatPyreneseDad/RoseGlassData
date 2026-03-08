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

function EntryGate({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="entry-gate">
      <div className="entry-inner">
        <div className="entry-emblem">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="22" stroke="#c8a96e" strokeWidth="1.5" opacity="0.6" />
            <circle cx="24" cy="24" r="14" stroke="#c8a96e" strokeWidth="1" opacity="0.4" />
            <circle cx="24" cy="24" r="4" fill="#c8a96e" opacity="0.8" />
            <line x1="24" y1="2" x2="24" y2="10" stroke="#c8a96e" strokeWidth="1.5" opacity="0.6" />
            <line x1="24" y1="38" x2="24" y2="46" stroke="#c8a96e" strokeWidth="1.5" opacity="0.6" />
            <line x1="2" y1="24" x2="10" y2="24" stroke="#c8a96e" strokeWidth="1.5" opacity="0.6" />
            <line x1="38" y1="24" x2="46" y2="24" stroke="#c8a96e" strokeWidth="1.5" opacity="0.6" />
          </svg>
        </div>

        <h1 className="entry-title">Rose Glass</h1>
        <p className="entry-subtitle">Dimensional News Analysis</p>

        <div className="entry-divider" />

        <div className="entry-body">
          <p>
            The same event, seen through a hundred lenses, tells a hundred truths.
            Rose Glass doesn&apos;t judge which source is right —
            it <em>translates</em> how each one sees.
          </p>
          <p>
            Every article is scored across six dimensions drawn from the Rose Glass framework:
            internal consistency, accumulated wisdom, moral activation, social belonging,
            temporal depth, and lens interference. Together they reveal not bias, but <em>emphasis</em>.
          </p>
          <p>
            Pick a topic. Pick a date. Watch the world tell itself differently.
          </p>
        </div>

        <div className="entry-dimensions">
          {[
            { sym: "Ψ", label: "Consistency" },
            { sym: "ρ", label: "Wisdom" },
            { sym: "q", label: "Activation" },
            { sym: "f", label: "Belonging" },
            { sym: "τ", label: "Temporal" },
            { sym: "λ", label: "Interference" },
          ].map((d) => (
            <div key={d.sym} className="entry-dim">
              <span className="entry-dim-sym">{d.sym}</span>
              <span className="entry-dim-label">{d.label}</span>
            </div>
          ))}
        </div>

        <button className="entry-btn" onClick={onEnter}>
          Enter the Observatory
          <span className="entry-btn-arrow">→</span>
        </button>

        <p className="entry-footnote">
          Powered by GDELT · Rose Glass v2 · IPAI Engine
        </p>
      </div>

      <style>{`
        .entry-gate {
          min-height: 100vh;
          background: #080c14;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          position: relative;
          overflow: hidden;
        }
        .entry-gate::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse 80% 60% at 50% 0%, rgba(200,169,110,0.08) 0%, transparent 60%),
            radial-gradient(ellipse 60% 40% at 80% 80%, rgba(41,65,110,0.15) 0%, transparent 50%);
          pointer-events: none;
        }
        .entry-gate::after {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(200,169,110,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(200,169,110,0.03) 1px, transparent 1px);
          background-size: 60px 60px;
          pointer-events: none;
        }
        .entry-inner {
          position: relative;
          z-index: 1;
          max-width: 560px;
          width: 100%;
          text-align: center;
          animation: fadeUp 0.8s ease forwards;
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .entry-emblem {
          display: flex;
          justify-content: center;
          margin-bottom: 1.5rem;
          animation: spinSlow 20s linear infinite;
        }
        @keyframes spinSlow {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        .entry-title {
          font-family: 'Georgia', 'Times New Roman', serif;
          font-size: 3rem;
          font-weight: 400;
          letter-spacing: 0.12em;
          color: #e8d9b8;
          margin: 0 0 0.25rem;
          text-transform: uppercase;
        }
        .entry-subtitle {
          font-family: 'Georgia', serif;
          font-size: 0.75rem;
          letter-spacing: 0.35em;
          color: #c8a96e;
          text-transform: uppercase;
          margin: 0 0 2rem;
          opacity: 0.8;
        }
        .entry-divider {
          width: 60px;
          height: 1px;
          background: linear-gradient(90deg, transparent, #c8a96e, transparent);
          margin: 0 auto 2rem;
        }
        .entry-body {
          text-align: left;
          margin-bottom: 2rem;
        }
        .entry-body p {
          font-family: 'Georgia', serif;
          font-size: 0.95rem;
          line-height: 1.8;
          color: #9aa3b5;
          margin: 0 0 1rem;
        }
        .entry-body em {
          color: #c8a96e;
          font-style: italic;
        }
        .entry-dimensions {
          display: flex;
          justify-content: center;
          gap: 1.5rem;
          margin-bottom: 2.5rem;
          flex-wrap: wrap;
        }
        .entry-dim {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.25rem;
        }
        .entry-dim-sym {
          font-family: 'Georgia', serif;
          font-size: 1.25rem;
          color: #c8a96e;
          opacity: 0.9;
        }
        .entry-dim-label {
          font-size: 0.6rem;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: #4a5568;
        }
        .entry-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.875rem 2.5rem;
          background: transparent;
          border: 1px solid #c8a96e;
          color: #c8a96e;
          font-family: 'Georgia', serif;
          font-size: 0.875rem;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.3s ease;
          margin-bottom: 2rem;
        }
        .entry-btn:hover {
          background: rgba(200,169,110,0.08);
          box-shadow: 0 0 30px rgba(200,169,110,0.15);
        }
        .entry-btn-arrow {
          transition: transform 0.3s ease;
        }
        .entry-btn:hover .entry-btn-arrow {
          transform: translateX(4px);
        }
        .entry-footnote {
          font-size: 0.65rem;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: #2d3748;
        }
      `}</style>
    </div>
  );
}

export default function Home() {
  const [entered, setEntered] = useState(false);
  const [tab, setTab] = useState<Tab>("snapshot");
  const [topic, setTopic] = useState("");
  const [date, setDate] = useState(todayString());
  const [startDate, setStartDate] = useState(weekAgoString());
  const [endDate, setEndDate] = useState(todayString());
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<"checking" | "fetching" | "scoring">("checking");
  const [error, setError] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);

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
    setLoadingStage("checking");
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

  if (!entered) return <EntryGate onEnter={() => setEntered(true)} />;

  return (
    <div className="obs-shell">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=JetBrains+Mono:wght@300;400&display=swap');

        .obs-shell {
          min-height: 100vh;
          background: #080c14;
          color: #c8c8d0;
          position: relative;
        }
        .obs-shell::before {
          content: '';
          position: fixed;
          inset: 0;
          background-image:
            linear-gradient(rgba(200,169,110,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(200,169,110,0.025) 1px, transparent 1px);
          background-size: 60px 60px;
          pointer-events: none;
          z-index: 0;
        }
        .obs-header {
          position: relative;
          z-index: 1;
          border-bottom: 1px solid rgba(200,169,110,0.12);
          background: rgba(8,12,20,0.95);
          backdrop-filter: blur(8px);
        }
        .obs-header-inner {
          max-width: 1100px;
          margin: 0 auto;
          padding: 1.25rem 2rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .obs-logo {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          cursor: pointer;
        }
        .obs-logo-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #c8a96e;
          box-shadow: 0 0 8px rgba(200,169,110,0.6);
          animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .obs-logo-name {
          font-family: 'EB Garamond', Georgia, serif;
          font-size: 1.2rem;
          font-weight: 400;
          letter-spacing: 0.1em;
          color: #e8d9b8;
          text-transform: uppercase;
        }
        .obs-logo-sub {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.6rem;
          color: #c8a96e;
          letter-spacing: 0.25em;
          text-transform: uppercase;
          opacity: 0.7;
        }
        .obs-main {
          position: relative;
          z-index: 1;
          max-width: 1100px;
          margin: 0 auto;
          padding: 2.5rem 2rem;
        }

        /* Tabs */
        .obs-tabs {
          display: flex;
          gap: 0;
          border: 1px solid rgba(200,169,110,0.15);
          width: fit-content;
          margin-bottom: 2rem;
        }
        .obs-tab {
          padding: 0.6rem 1.5rem;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.7rem;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
          background: transparent;
          color: #4a5568;
        }
        .obs-tab.active {
          background: rgba(200,169,110,0.1);
          color: #c8a96e;
        }
        .obs-tab:hover:not(.active) {
          color: #7a8494;
          background: rgba(255,255,255,0.02);
        }

        /* Search row */
        .obs-search-row {
          display: flex;
          gap: 1rem;
          align-items: flex-end;
          flex-wrap: wrap;
          margin-bottom: 1.5rem;
        }
        .obs-field {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }
        .obs-field.grow { flex: 1; min-width: 220px; }
        .obs-label {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.6rem;
          letter-spacing: 0.25em;
          text-transform: uppercase;
          color: #4a5568;
        }
        .obs-input {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(200,169,110,0.15);
          color: #e8d9b8;
          padding: 0.7rem 1rem;
          font-family: 'EB Garamond', Georgia, serif;
          font-size: 1rem;
          outline: none;
          transition: border-color 0.2s;
          width: 100%;
        }
        .obs-input::placeholder {
          color: #2d3748;
          font-style: italic;
        }
        .obs-input:focus {
          border-color: rgba(200,169,110,0.4);
          background: rgba(200,169,110,0.03);
        }
        .obs-input[type="date"] {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.8rem;
          color: #9aa3b5;
        }
        .obs-btn {
          padding: 0.7rem 2rem;
          background: transparent;
          border: 1px solid #c8a96e;
          color: #c8a96e;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.7rem;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }
        .obs-btn:hover:not(:disabled) {
          background: rgba(200,169,110,0.08);
          box-shadow: 0 0 20px rgba(200,169,110,0.1);
        }
        .obs-btn:disabled {
          border-color: #2d3748;
          color: #2d3748;
          cursor: not-allowed;
        }

        /* Loading */
        .obs-loading {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem 0;
        }
        .obs-spinner {
          width: 16px;
          height: 16px;
          border: 1px solid rgba(200,169,110,0.2);
          border-top-color: #c8a96e;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .obs-loading-text {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.7rem;
          letter-spacing: 0.15em;
          color: #c8a96e;
          opacity: 0.8;
        }

        /* Error */
        .obs-error {
          border: 1px solid rgba(180,60,60,0.3);
          background: rgba(180,60,60,0.05);
          padding: 1rem 1.25rem;
          font-family: 'EB Garamond', Georgia, serif;
          font-size: 0.9rem;
          color: #c87070;
          line-height: 1.6;
        }

        /* View toggles */
        .obs-view-toggle {
          display: flex;
          gap: 0;
          border: 1px solid rgba(200,169,110,0.12);
          width: fit-content;
          margin-bottom: 1.5rem;
        }
        .obs-view-btn {
          padding: 0.4rem 1rem;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.65rem;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          cursor: pointer;
          background: transparent;
          border: none;
          color: #4a5568;
          transition: all 0.2s;
        }
        .obs-view-btn.active {
          background: rgba(200,169,110,0.08);
          color: #c8a96e;
        }

        /* Footer */
        .obs-footer {
          position: relative;
          z-index: 1;
          border-top: 1px solid rgba(200,169,110,0.08);
          margin-top: 4rem;
          padding: 1.5rem 2rem;
          text-align: center;
        }
        .obs-footer p {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.6rem;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: #2d3748;
        }
        .obs-footer em {
          color: #3d4a5a;
          font-style: normal;
        }
      `}</style>

      <header className="obs-header">
        <div className="obs-header-inner">
          <div className="obs-logo" onClick={() => setEntered(false)}>
            <div className="obs-logo-dot" />
            <div>
              <div className="obs-logo-name">Rose Glass</div>
              <div className="obs-logo-sub">News Observatory</div>
            </div>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.6rem", letterSpacing: "0.2em", color: "#2d3748", textTransform: "uppercase" }}>
            Translation · Not Judgment
          </div>
        </div>
      </header>

      <main className="obs-main">

        {/* Tabs */}
        <div className="obs-tabs">
          {(["snapshot", "timeline"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`obs-tab ${tab === t ? "active" : ""}`}>
              {t === "snapshot" ? "Story Snapshot" : "Story Timeline"}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="obs-search-row">
          <div className="obs-field grow">
            <label className="obs-label">Topic</label>
            <input
              type="text"
              className="obs-input"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Country, conflict, or policy topic..."
              onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
            />
          </div>

          {tab === "snapshot" ? (
            <div className="obs-field">
              <label className="obs-label">Date</label>
              <input type="date" className="obs-input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          ) : (
            <>
              <div className="obs-field">
                <label className="obs-label">Start</label>
                <input type="date" className="obs-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="obs-field">
                <label className="obs-label">End</label>
                <input type="date" className="obs-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </>
          )}

          <div className="obs-field">
            <label className="obs-label">&nbsp;</label>
            <button className="obs-btn" onClick={handleAnalyze} disabled={loading || !topic.trim()}>
              {loading ? "Analyzing..." : "Analyze →"}
            </button>
          </div>
        </div>

        {/* Topic browser */}
        <TopicBrowser onSelect={(t) => setTopic(t)} />

        {/* Loading */}
        {loading && (
          <div className="obs-loading">
            <div className="obs-spinner" />
            <span className="obs-loading-text">
              {tab === "timeline" ? "Building timeline across date range..." :
                loadingStage === "checking" ? "Checking observatory cache..." :
                loadingStage === "fetching" ? "Querying GDELT — global coverage, first fetch ~30s..." :
                "Running Rose Glass dimensional analysis..."}
            </span>
          </div>
        )}

        {/* Error */}
        {error && <div className="obs-error">{error}</div>}

        {/* Snapshot results */}
        {tab === "snapshot" && snapshotData && (
          <div style={{ marginTop: "2rem" }}>
            {snapshotData.sources.length === 0 ? (
              <div className="obs-error">No sources found for this topic and date.</div>
            ) : (
              <>
                <div className="obs-view-toggle">
                  {(["cards", "radar"] as SnapshotView[]).map((v) => (
                    <button key={v} onClick={() => setSnapshotView(v)} className={`obs-view-btn ${snapshotView === v ? "active" : ""}`}>
                      {v === "cards" ? "Source Cards" : "Radar Overlay"}
                    </button>
                  ))}
                </div>

                {snapshotView === "cards" ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "1rem" }}>
                    {snapshotData.sources.map((source, i) => (
                      <SourceCard key={i} source={source} />
                    ))}
                  </div>
                ) : (
                  <SourceRadar sources={snapshotData.sources} />
                )}

                {Object.keys(snapshotData.divergence || {}).length > 0 && (
                  <div style={{ marginTop: "2rem" }}>
                    <DivergenceTable divergence={snapshotData.divergence} />
                  </div>
                )}

                {analysisId && (
                  <div style={{ marginTop: "2rem" }}>
                    <ChatPanel analysisId={analysisId} />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Timeline results */}
        {tab === "timeline" && timelineData.length > 0 && (
          <div style={{ marginTop: "2rem" }}>
            <div className="obs-view-toggle">
              {(["chart", "heatmap"] as TimelineView[]).map((v) => (
                <button key={v} onClick={() => setTimelineView(v)} className={`obs-view-btn ${timelineView === v ? "active" : ""}`}>
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
              <div style={{ marginTop: "2rem" }}>
                <TimelineChatPanel
                  topic={timelineMeta.topic}
                  startDate={timelineMeta.startDate}
                  endDate={timelineMeta.endDate}
                  timeline={timelineData}
                />
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="obs-footer">
        <p>
          Rose Glass translates dimensional emphasis — it does not judge. &nbsp;
          <em>No source is ranked better or worse.</em>
        </p>
      </footer>
    </div>
  );
}
