// app/api/auth/callback/route.ts
// Supabase Auth OAuth/magic-link callback.
// After email confirmation, exchanges code for session,
// then ensures the user has an api_key row.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getDB } from "@/lib/db";
import { generateApiKey } from "@/lib/auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://rose-glass-data.vercel.app";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next") || "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${BASE_URL}/login?error=missing_code`);
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    console.error("[auth/callback]", error?.message);
    return NextResponse.redirect(`${BASE_URL}/login?error=auth_failed`);
  }

  const user = data.user;

  // Ensure api_key exists for this user
  const db = getDB();
  const existing = await db.query(
    `SELECT id FROM api_keys WHERE user_id = $1 AND is_active = TRUE LIMIT 1`,
    [user.id]
  );

  if (existing.rows.length === 0) {
    // First login — issue a trial key linked to this user
    const email = user.email?.toLowerCase().trim() || "";
    const key = generateApiKey();
    await db.query(
      `INSERT INTO api_keys (key, email, plan, tokens_remaining, user_id)
       VALUES ($1, $2, 'trial', 10000, $3)
       ON CONFLICT DO NOTHING`,
      [key, email, user.id]
    );
  }

  const response = NextResponse.redirect(`${BASE_URL}${next}`);
  return response;
}
