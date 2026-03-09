import { NextRequest, NextResponse } from "next/server";

const CENSUS_BASE = "https://api.census.gov/data";
const CENSUS_KEY = process.env.CENSUS_API_KEY || "";

export interface SampleResult {
  query_description: string;
  variables: string[];
  geography: string;
  rows: Array<Record<string, string>>;
  note?: string;
}

// Curated variable mappings — grounded claims only where Census structure is known
const VARIABLE_MAP: Record<string, { vars: string[]; label: string; geo: string }> = {
  youth_disconnected: {
    vars: ["B14005_001E", "B14005_019E", "B14005_020E"],
    label: "Youth 16-19 not in school, not employed (male + female)",
    geo: "county"
  },
  poverty_rate: {
    vars: ["B17001_001E", "B17001_002E"],
    label: "Population below poverty level",
    geo: "county"
  },
  median_income: {
    vars: ["B19013_001E"],
    label: "Median household income",
    geo: "county"
  },
  earnings_sex: {
    vars: ["B20017_001E", "B20017_002E", "B20017_003E"],
    label: "Median earnings by sex, full-time year-round workers",
    geo: "state"
  },
  commute_time: {
    vars: ["B08136_001E", "B08136_002E", "B08136_003E"],
    label: "Aggregate travel time to work by means (car vs transit)",
    geo: "county"
  },
  foreign_born: {
    vars: ["B05001_001E", "B05001_006E"],
    label: "Foreign-born population share",
    geo: "state"
  },
  language_isolation: {
    vars: ["B16004_001E", "B16004_067E"],
    label: "Linguistically isolated households",
    geo: "state"
  },
  housing_cost_burden: {
    vars: ["B25070_001E", "B25070_010E"],
    label: "Renter households paying 50%+ of income on rent",
    geo: "county"
  },
};

export async function POST(request: NextRequest) {
  try {
    const { dataset_id, vintage, topic } = await request.json();
    if (!dataset_id || !vintage || !topic) {
      return NextResponse.json(
        { error: "dataset_id, vintage, topic required" },
        { status: 400 }
      );
    }

    const mapping = VARIABLE_MAP[topic];
    if (!mapping) {
      return NextResponse.json({
        error: `Unknown topic: ${topic}`,
        available: Object.keys(VARIABLE_MAP),
      }, { status: 400 });
    }

    const result = await queryCensus(dataset_id, vintage, mapping);
    return NextResponse.json(result);

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[sample]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function queryCensus(
  dataset_id: string,
  vintage: number,
  mapping: { vars: string[]; label: string; geo: string }
): Promise<SampleResult> {
  const { vars, label, geo } = mapping;
  const getParam = ["NAME", ...vars].join(",");

  let forClause = "";
  if (geo === "us") {
    forClause = "for=us:1";
  } else if (geo === "state") {
    forClause = "for=state:*";
  } else if (geo === "county") {
    forClause = "for=county:*&in=state:*";
  }

  const keyParam = CENSUS_KEY ? `&key=${CENSUS_KEY}` : "";
  const url = `${CENSUS_BASE}/${vintage}/${dataset_id}?get=${getParam}&${forClause}${keyParam}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Census API ${res.status}: ${text.slice(0, 300)}`);
  }

  const raw: string[][] = await res.json();
  const headers = raw[0];
  const rows = raw.slice(1);

  // Sort by first numeric variable descending; exclude suppressed values
  const firstVarIdx = headers.indexOf(vars[0]);
  const valid = rows.filter(r => {
    const v = r[firstVarIdx];
    return v && v !== "-666666666" && v !== "-888888888" && Number(v) > 0;
  });
  const sorted = valid.sort((a, b) => Number(b[firstVarIdx]) - Number(a[firstVarIdx]));

  let combined = sorted;
  let note: string | undefined;

  if (geo === "county" && sorted.length > 20) {
    const top10 = sorted.slice(0, 10);
    const bottom10 = sorted.slice(-10).reverse();
    combined = [...top10, ...bottom10];
    note = `Top 10 and bottom 10 of ${sorted.length} counties by ${vars[0]}`;
  } else if (geo === "state" && sorted.length > 30) {
    combined = sorted; // all states, manageable
  }

  const structured = combined.map(row => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });

  return {
    query_description: label,
    variables: vars,
    geography: geo,
    rows: structured,
    note,
  };
}
