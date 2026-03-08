import { NextResponse } from "next/server";
import { getDB } from "@/lib/db";

export async function GET() {
  try {
    const db = getDB();
    const result = await db.query(`
      SELECT topic, MAX(date)::text AS latest_date, COUNT(*)::int AS count
      FROM analyses
      GROUP BY topic
      ORDER BY MAX(date) DESC, COUNT(*) DESC
      LIMIT 30
    `);
    return NextResponse.json({ topics: result.rows });
  } catch (err) {
    console.error("[topics]", err);
    return NextResponse.json({ topics: [] });
  }
}
