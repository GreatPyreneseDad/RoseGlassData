// app/api/auth/register/route.ts
// Called after Supabase Auth confirms email.
// Returns the api_key for the authenticated user.
// POST with Supabase session token → { api_key, tokens_remaining, plan }

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getDB } from "@/lib/db";
import { generateApiKey } from "@/lib/auth";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    // Validate Supabase session token from Authorization header
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) {
      return NextResponse.json({ error: "Authorization required" }, { status: 401 });
    }

    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const db = getDB();
    const email = user.email?.toLowerCase().trim() || "";

    // Return existing key if present
    const existing = await db.query(
      `SELECT key, tokens_remaining, plan FROM api_keys
       WHERE user_id = $1 AND is_active = TRUE
       ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      return NextResponse.json({
        api_key: row.key,
        tokens_remaining: row.tokens_remaining,
        plan: row.plan,
      });
    }

    // Issue new trial key
    const key = generateApiKey();
    await db.query(
      `INSERT INTO api_keys (key, email, plan, tokens_remaining, user_id)
       VALUES ($1, $2, 'trial', 10000, $3)`,
      [key, email, user.id]
    );

    return NextResponse.json({
      api_key: key,
      tokens_remaining: 10000,
      plan: "trial",
      token_costs: {
        upload: "2,000 tokens",
        chat: "100 tokens per message",
        connect: "500 tokens",
        db_connect: "500 tokens",
      },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[register]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
