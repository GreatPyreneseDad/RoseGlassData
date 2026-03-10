import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { checkAuth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await checkAuth(request, "chat");
    if (auth instanceof NextResponse) {
      // Unauthenticated — return empty list rather than 401
      // (home page loads sessions on mount, may not have key yet)
      return NextResponse.json({ sessions: [] });
    }

    const db = getDB();
    const res = await db.query(
      `SELECT s.id, s.name, s.dataset_id, s.vintage, s.variable_count,
              s.concept_count, s.profiled_at, s.connector,
              p.moe_coverage, p.lambda, p.q
       FROM db_sessions s
       LEFT JOIN rg_profiles p ON p.session_id = s.id
       WHERE s.api_key_id = $1
       ORDER BY s.created_at DESC`,
      [auth.api_key_id]
    );
    return NextResponse.json({ sessions: res.rows });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
