import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);
const HOME = process.env.HOME || "/Users/chris";
const PYTHON_PATH = path.join(HOME, "IPAI", ".venv", "bin", "python3");
const SCRIPT_PATH = path.join(HOME, "rose-glass-news", "scripts", "daily_ingest.py");

const CRON_SECRET = process.env.CRON_SECRET || "rose-glass-cron";

export async function POST(request: NextRequest) {
  const auth = request.headers.get("x-cron-secret");
  if (auth !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const date = body.date || new Date().toISOString().split("T")[0];
  const topics = body.topics || [];
  const discover = body.discover ?? true;

  const args = [SCRIPT_PATH, "--date", date];
  if (topics.length > 0) args.push("--topics", ...topics);
  if (discover) args.push("--discover");

  console.log("[cron/ingest] starting:", args.join(" "));

  try {
    const { stdout, stderr } = await execFileAsync(PYTHON_PATH, args, {
      timeout: 600_000,
      env: { ...process.env, PYTHONPATH: path.join(HOME, "IPAI") },
    });

    if (stderr) console.warn("[cron/ingest] stderr:", stderr.slice(0, 500));
    return NextResponse.json({ ok: true, date, output: stdout });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    console.error("[cron/ingest] failed:", e.message);
    return NextResponse.json({ error: e.message, output: e.stdout || "" }, { status: 500 });
  }
}
