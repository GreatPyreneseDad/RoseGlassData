import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

const HOME = process.env.HOME || "/Users/chris";
const PYTHON_PATH = path.join(HOME, "IPAI", ".venv", "bin", "python3");
const SCRIPT_PATH = path.join(HOME, "rose-glass-news", "scripts", "run_analysis.py");

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

    // Run analyses sequentially to avoid overwhelming BigQuery
    const timeline: Array<{
      date: string;
      psi: number;
      rho: number;
      q: number;
      f: number;
      tau: number;
      lambda: number;
      coherence: number;
      sourceCount: number;
    }> = [];

    for (const date of dates) {
      try {
        let stdout: string;
        let stderr: string;
        try {
          const execResult = await execFileAsync(
            PYTHON_PATH,
            [SCRIPT_PATH, "--topic", topic, "--date", date, "--limit", "5"],
            {
              timeout: 180_000,
              env: {
                ...process.env,
                PYTHONPATH: path.join(HOME, "IPAI"),
              },
            }
          );
          stdout = execResult.stdout;
          stderr = execResult.stderr;
        } catch (execErr: unknown) {
          const e = execErr as { stdout?: string; stderr?: string; message?: string };
          stdout = e.stdout || "";
          stderr = e.stderr || "";
          console.warn(`[timeline] process exited non-zero for ${date}:`, e.message);
          console.log(`[timeline] stderr for ${date}:`, e.stderr?.slice(0, 500));
        }

        if (stderr) {
          console.error(`[timeline] stderr for ${date}:`, stderr);
        }

        const trimmed = stdout.trim();
        if (!trimmed) {
          console.warn(`[timeline] No output for ${date}, skipping`);
          continue;
        }

        const result = JSON.parse(trimmed);

        if (result.sources && result.sources.length > 0) {
          // Aggregate dimensions across all sources for this day
          const sources = result.sources;
          const avg = (key: string) =>
            sources.reduce(
              (sum: number, s: { dimensions: Record<string, number> }) =>
                sum + (s.dimensions[key] || 0),
              0
            ) / sources.length;

          timeline.push({
            date,
            psi: avg("psi"),
            rho: avg("rho"),
            q: avg("q"),
            f: avg("f"),
            tau: avg("tau"),
            lambda: avg("lambda"),
            coherence:
              sources.reduce(
                (sum: number, s: { coherence: number }) => sum + s.coherence,
                0
              ) / sources.length,
            sourceCount: sources.length,
          });
        }
      } catch (err) {
        console.error(`[timeline] Failed for date ${date}:`, err);
        // Skip dates that fail
      }
    }

    return NextResponse.json({ topic, startDate, endDate, timeline });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error("[timeline] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
