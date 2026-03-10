// lib/auth.ts
// API key validation + token metering middleware.
// Call checkAuth() at the top of every protected route.
// Token costs: upload=2000, chat=100, connect=500, db_connect=500

import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import crypto from "crypto";

export const TOKEN_COSTS = {
  upload:     2000,  // 7 agent calls at ingest
  chat:        100,  // one Opus call
  connect:     500,  // Census profiling
  db_connect:  500,  // Postgres introspection
} as const;

export type Operation = keyof typeof TOKEN_COSTS;

export interface AuthResult {
  api_key_id: string;
  email: string;
  plan: string;
  tokens_remaining: number;
}

// Generate a new API key — crypto-random, prefixed for recognizability
export function generateApiKey(): string {
  const bytes = crypto.randomBytes(24).toString("hex");
  return `rgd_${bytes}`;
}

// Validate key + deduct tokens in a single atomic transaction.
// Returns AuthResult on success, NextResponse on failure (caller should return it).
export async function checkAuth(
  request: NextRequest,
  operation: Operation
): Promise<AuthResult | NextResponse> {
  const key = request.headers.get("x-api-key") ||
               request.nextUrl.searchParams.get("api_key");

  if (!key) {
    return NextResponse.json(
      { error: "API key required. Pass X-Api-Key header or ?api_key= param." },
      { status: 401 }
    );
  }

  const db = getDB();
  const cost = TOKEN_COSTS[operation];

  // Atomic: validate, check balance, deduct, log — single transaction
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const keyRes = await client.query(
      `SELECT id, email, plan, tokens_remaining, is_active
       FROM api_keys WHERE key = $1 FOR UPDATE`,
      [key]
    );

    if (keyRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Invalid API key." },
        { status: 401 }
      );
    }

    const row = keyRes.rows[0];

    if (!row.is_active) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "API key is inactive." },
        { status: 403 }
      );
    }

    // -1 = unlimited (pro/enterprise)
    if (row.tokens_remaining !== -1 && row.tokens_remaining < cost) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "Trial token allocation exhausted.",
          tokens_remaining: row.tokens_remaining,
          cost_required: cost,
          upgrade_url: "https://rose-glass-data.vercel.app/upgrade",
        },
        {
          status: 402,
          headers: { "X-Tokens-Remaining": String(row.tokens_remaining) }
        }
      );
    }

    // Deduct tokens (skip for unlimited plan)
    if (row.tokens_remaining !== -1) {
      await client.query(
        `UPDATE api_keys
         SET tokens_remaining = tokens_remaining - $1,
             tokens_used = tokens_used + $1,
             last_used_at = NOW()
         WHERE id = $2`,
        [cost, row.id]
      );
    } else {
      await client.query(
        `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
        [row.id]
      );
    }

    // Log to ledger
    await client.query(
      `INSERT INTO token_ledger (api_key_id, operation, tokens_charged)
       VALUES ($1, $2, $3)`,
      [row.id, operation, cost]
    );

    await client.query("COMMIT");

    return {
      api_key_id: row.id,
      email: row.email,
      plan: row.plan,
      tokens_remaining: row.tokens_remaining === -1 ? -1 : row.tokens_remaining - cost,
    };

  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Add token info to any successful response
export function withTokenHeaders(
  response: NextResponse,
  auth: AuthResult
): NextResponse {
  response.headers.set("X-Tokens-Remaining", String(auth.tokens_remaining));
  response.headers.set("X-Plan", auth.plan);
  return response;
}
