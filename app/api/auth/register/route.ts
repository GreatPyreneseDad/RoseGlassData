// app/api/auth/register/route.ts
// Generate a trial API key for a new user.
// POST { email } → { api_key, tokens_remaining, plan }
// No password — key IS the credential. User stores it.

import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { generateApiKey } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "Valid email required." },
        { status: 400 }
      );
    }

    const db = getDB();

    // Check if email already has an active key
    const existing = await db.query(
      `SELECT key, tokens_remaining, plan FROM api_keys
       WHERE email = $1 AND is_active = TRUE
       ORDER BY created_at DESC LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      return NextResponse.json({
        api_key: row.key,
        tokens_remaining: row.tokens_remaining,
        plan: row.plan,
        note: "Existing key returned. Store it — we don't show it again.",
      });
    }

    // Issue new trial key
    const key = generateApiKey();
    const TRIAL_TOKENS = 10000;

    await db.query(
      `INSERT INTO api_keys (key, email, plan, tokens_remaining)
       VALUES ($1, $2, 'trial', $3)`,
      [key, email.toLowerCase().trim(), TRIAL_TOKENS]
    );

    return NextResponse.json({
      api_key: key,
      tokens_remaining: TRIAL_TOKENS,
      plan: "trial",
      token_costs: {
        upload: "2,000 tokens — full 7-agent semantic profile",
        chat: "100 tokens — per message",
        connect: "500 tokens — Census or Postgres schema profiling",
      },
      note: "Store this key — it will not be shown again.",
      docs: "https://rose-glass-data.vercel.app/docs",
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[register]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
