import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

async function sbFetch(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
  });
  return res.json();
}

export async function GET() {
  try {
    const data = await sbFetch("analyses?select=topic,date&order=date.desc");

    const topicMap: Record<string, { latest_date: string; count: number }> = {};
    for (const row of data || []) {
      if (!topicMap[row.topic]) {
        topicMap[row.topic] = { latest_date: row.date, count: 0 };
      }
      topicMap[row.topic].count++;
      if (row.date > topicMap[row.topic].latest_date) {
        topicMap[row.topic].latest_date = row.date;
      }
    }

    const topics = Object.entries(topicMap)
      .map(([topic, info]) => ({ topic, ...info }))
      .sort((a, b) => b.latest_date.localeCompare(a.latest_date));

    return NextResponse.json({ topics });
  } catch (err) {
    console.error("[topics]", err);
    return NextResponse.json({ topics: [] });
  }
}
