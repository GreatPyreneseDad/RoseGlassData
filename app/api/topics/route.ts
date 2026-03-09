import { NextResponse } from "next/server";
import { getDB } from "@/lib/db";

export async function GET() {
  try {
    const result = await getDB().query(`
      SELECT n.label AS topic, MAX(a.date)::text AS latest_date, COUNT(*)::int AS count
      FROM analyses a
      JOIN entity_nodes n ON n.id = a.entity_node_id
      GROUP BY n.label
      ORDER BY MAX(a.date) DESC, COUNT(*) DESC
      LIMIT 30
    `);
    return NextResponse.json({ topics: result.rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ topics: [], error: msg }, { status: 500 });
  }
}
