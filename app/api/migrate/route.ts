// TEMPORARY — delete after running once
// POST with header x-migrate-secret: rgd_migrate_2026
import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (request.headers.get("x-migrate-secret") !== "rgd_migrate_2026")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDB();
  const results: string[] = [];

  const statements = [
    `CREATE TABLE IF NOT EXISTS api_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'trial',
      tokens_remaining INTEGER NOT NULL DEFAULT 10000,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ
    )`,
    `ALTER TABLE db_sessions ADD COLUMN IF NOT EXISTS api_key_id UUID REFERENCES api_keys(id)`,
    `CREATE TABLE IF NOT EXISTS token_ledger (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      api_key_id UUID NOT NULL REFERENCES api_keys(id),
      operation TEXT NOT NULL,
      tokens_charged INTEGER NOT NULL,
      session_id UUID REFERENCES db_sessions(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key)`,
    `CREATE INDEX IF NOT EXISTS idx_token_ledger_key ON token_ledger(api_key_id, created_at)`,
    `COMMENT ON TABLE api_keys IS 'API key registry. trial=10000 tokens, pro=-1 unlimited.'`,
    `COMMENT ON TABLE token_ledger IS 'Immutable token deduction log.'`,
  ];

  for (const sql of statements) {
    try {
      await db.query(sql);
      results.push(`OK: ${sql.slice(0, 60).replace(/\s+/g, " ")}...`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push(`ERR: ${msg}`);
    }
  }

  return NextResponse.json({ results });
}
