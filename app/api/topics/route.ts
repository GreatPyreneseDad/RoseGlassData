import { NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://localhost/rose_glass_news",
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

export async function GET() {
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
  } catch (err) {
    console.error("[topics]", err);
    return NextResponse.json({ topics: [] });
  }
}
