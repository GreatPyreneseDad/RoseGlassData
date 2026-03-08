import { NextResponse } from "next/server";
import { Pool } from "pg";

export async function GET() {
  const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    const result = await db.query(`
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
  } finally {
    await db.end();
  }
}
