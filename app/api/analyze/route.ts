import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

const HOME = process.env.HOME || "/Users/chris";
const PYTHON_PATH = path.join(HOME, "IPAI", ".venv", "bin", "python3");
const SCRIPT_PATH = path.join(HOME, "rose-glass-news", "scripts", "run_analysis.py");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { topic, date } = body;

    if (!topic || !date) {
      return NextResponse.json(
        { error: "topic and date are required" },
        { status: 400 }
      );
    }

    const args = [SCRIPT_PATH, "--topic", topic, "--date", date, "--limit", "5"];
    console.log("[analyze] cmd:", PYTHON_PATH, args.join(" "));
    console.log("[analyze] cwd:", process.cwd());

    let stdout: string;
    let stderr: string;
    let exitCode: number | null = null;
    try {
      const result = await execFileAsync(
        PYTHON_PATH,
        args,
        {
          timeout: 180_000,
          env: {
            ...process.env,
            PYTHONPATH: path.join(HOME, "IPAI"),
          },
        }
      );
      stdout = result.stdout;
      stderr = result.stderr;
      exitCode = 0;
    } catch (execErr: unknown) {
      const e = execErr as { stdout?: string; stderr?: string; message?: string; code?: number };
      stdout = e.stdout || "";
      stderr = e.stderr || "";
      exitCode = e.code ?? null;
      console.warn("[analyze] process exited non-zero, code:", exitCode, "message:", e.message);
      console.log("[analyze] stderr:", e.stderr?.slice(0, 500));
    }

    console.log("[analyze] exit code:", exitCode);
    console.log("[analyze] stdout length:", stdout.length, "first 200:", stdout.slice(0, 200));
    if (stderr) {
      console.error("[analyze] stderr:", stderr.slice(0, 500));
    }

    const trimmed = stdout.trim();
    if (!trimmed) {
      return NextResponse.json(
        { error: "Analysis script returned no output" },
        { status: 500 }
      );
    }

    const result = JSON.parse(trimmed);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error("[analyze] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
