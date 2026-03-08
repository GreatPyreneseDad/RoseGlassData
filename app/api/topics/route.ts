import { NextResponse } from "next/server";
import { getDB } from "@/lib/db";

export async function GET() {
  try {
    const result = await getDB().query(`
      SELECT topic, MAX(date)::text AS latest_date, COUNT(*)::int AS count
      FROM analyses
      GROUP BY topic
      ORDER BY MAX(date) DESC, COUNT(*) DESC
      LIMIT 30
    `);
    return NextResponse.json({ topics: result.rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ topics: [], error: msg }, { status: 500 });
  }
}
