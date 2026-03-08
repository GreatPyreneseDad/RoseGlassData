import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { initDB, getCachedAnalysis, saveAnalysis } from "@/lib/db";

const execFileAsync = promisify(execFile);

const HOME = process.env.HOME || "/Users/chris";
const PYTHON_PATH = path.join(HOME, "IPAI", ".venv", "bin", "python3");
const SCRIPT_PATH = path.join(HOME, "rose-glass-news", "scripts", "run_analysis.py");

// Max parallel Python processes — enough to saturate without hammering GDELT
const MAX_CONCURRENT = 4;

let dbReady = false;
async function ensureDB() {
  if (!dbReady) {
    await initDB();
    dbReady = true;
  }
}

function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  while (current <= end) {
    dates.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

async function analyzeDate(topic: string, date: string): Promise<{
  date: string;
  psi: number; rho: number; q: number; f: number;
  tau: number; lambda: number; coherence: number;
  sourceCount: number;
} | null> {
  // Cache check first — free and instant
  try {
    const cached = await getCachedAnalysis(topic, date);
    if (cached && cached.sources.length > 0) {
      console.log(`[timeline] cache hit: ${date}`);
      const sources = cached.sources;
      const avg = (key: string) =>
        sources.reduce((sum: number, s: { dimensions: Record<string, number> }) =>
          sum + (s.dimensions[key] || 0), 0) / sources.length;

      return {
        date,
        psi: avg("psi"), rho: avg("rho"), q: avg("q"),
        f: avg("f"), tau: avg("tau"), lambda: avg("lambda"),
        coherence: sources.reduce((sum: number, s: { coherence: number }) =>
          sum + s.coherence, 0) / sources.length,
        sourceCount: sources.length,
      };
    }
  } catch (err) {
    console.warn(`[timeline] cache check failed for ${date}:`, err);
  }

  // Cache miss — run Python
  console.log(`[timeline] fetching: ${date}`);
  try {
    let stdout = "";
    try {
      const result = await execFileAsync(
        PYTHON_PATH,
        [SCRIPT_PATH, "--topic", topic, "--date", date, "--limit", "5"],
        {
          timeout: 120_000,
          env: { ...process.env, PYTHONPATH: path.join(HOME, "IPAI") },
        }
      );
      stdout = result.stdout;
    } catch (execErr: unknown) {
      const e = execErr as { stdout?: string; message?: string };
      stdout = e.stdout || "";
      console.warn(`[timeline] process non-zero for ${date}:`, e.message);
    }

    const trimmed = stdout.trim();
    if (!trimmed) return null;

    const result = JSON.parse(trimmed);
    if (!result.sources || result.sources.length === 0) return null;

    // Persist to DB so future timeline/snapshot hits are instant
    try {
      await saveAnalysis(topic, date, result.sources, result.divergence || {});
    } catch (dbErr) {
      console.warn(`[timeline] failed to save ${date}:`, dbErr);
    }

    const sources = result.sources;
    const avg = (key: string) =>
      sources.reduce((sum: number, s: { dimensions: Record<string, number> }) =>
        sum + (s.dimensions[key] || 0), 0) / sources.length;

    return {
      date,
      psi: avg("psi"), rho: avg("rho"), q: avg("q"),
      f: avg("f"), tau: avg("tau"), lambda: avg("lambda"),
      coherence: sources.reduce((sum: number, s: { coherence: number }) =>
        sum + s.coherence, 0) / sources.length,
      sourceCount: sources.length,
    };
  } catch (err) {
    console.error(`[timeline] failed for ${date}:`, err);
    return null;
  }
}

// Run tasks with bounded concurrency
async function runConcurrent<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { topic, startDate, endDate } = body;

    if (!topic || !startDate || !endDate) {
      return NextResponse.json(
        { error: "topic, startDate, and endDate are required" },
        { status: 400 }
      );
    }

    const dates = getDateRange(startDate, endDate);

    if (dates.length > 30) {
      return NextResponse.json(
        { error: "Date range cannot exceed 30 days" },
        { status: 400 }
      );
    }

    await ensureDB();

    const normalizedTopic = topic.trim().toUpperCase();

    // Build tasks — cache hits resolve instantly, misses run Python
    const tasks = dates.map((date) => () => analyzeDate(normalizedTopic, date));

    // Run with bounded concurrency — parallel but not a stampede
    const results = await runConcurrent(tasks, MAX_CONCURRENT);

    const timeline = results.filter(Boolean) as NonNullable<Awaited<ReturnType<typeof analyzeDate>>>[];

    // Sort by date ascending (parallel execution may scramble order)
    timeline.sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({ topic: normalizedTopic, startDate, endDate, timeline });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    console.error("[timeline] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
