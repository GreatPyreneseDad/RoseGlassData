import { NextResponse } from "next/server";
import { Pool } from "pg";

export async function GET() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://localhost/rose_glass_news",
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  });
  try {
    const result = await pool.query(`
      SELECT
        topic,
        MAX(date)::text AS latest_date,
        COUNT(*)::int AS count
      FROM analyses
      GROUP BY topic
      ORDER BY MAX(date) DESC, COUNT(*) DESC
      LIMIT 30
    `);
    return NextResponse.json({ topics: result.rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[topics error]", msg);
    return NextResponse.json({ topics: [], error: msg }, { status: 500 });
  } finally {
    await pool.end();
  }
}
