import { NextResponse } from "next/server";
import { getDB } from "@/lib/db";

export async function GET() {
  try {
    const db = getDB();
    const res = await db.query(
      `SELECT s.id, s.name, s.dataset_id, s.vintage, s.variable_count, s.concept_count, s.profiled_at,
              p.moe_coverage, p.lambda, p.q
       FROM db_sessions s
       LEFT JOIN rg_profiles p ON p.session_id = s.id
       ORDER BY s.created_at DESC`
    );
    return NextResponse.json({ sessions: res.rows });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
