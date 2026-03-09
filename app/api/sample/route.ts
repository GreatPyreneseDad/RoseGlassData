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

// rate_numerator_vars: summed and divided by rate_denominator_var to sort by derived rate
// min_denominator: exclude counties too small to be meaningful
interface TopicMapping {
  vars: string[];
  label: string;
  geo: string;
  rate_numerator_vars?: string[];
  rate_denominator_var?: string;
  min_denominator?: number;
}

const VARIABLE_MAP: Record<string, TopicMapping> = {
  youth_disconnected: {
    // B14005: Sex by School Enrollment by Employment Status, 16-19 years
    // NEET = not enrolled + (unemployed OR not in labor force), HS grad + non-HS grad, male + female
    vars: [
      "B14005_001E",  // Total 16-19
      "B14005_010E",  // Male: Not enrolled, HS grad, Unemployed
      "B14005_011E",  // Male: Not enrolled, HS grad, Not in labor force
      "B14005_014E",  // Male: Not enrolled, <HS, Unemployed
      "B14005_015E",  // Male: Not enrolled, <HS, Not in labor force
      "B14005_024E",  // Female: Not enrolled, HS grad, Unemployed
      "B14005_025E",  // Female: Not enrolled, HS grad, Not in labor force
      "B14005_028E",  // Female: Not enrolled, <HS, Unemployed
      "B14005_029E",  // Female: Not enrolled, <HS, Not in labor force
    ],
    label: "Youth 16-19 NEET rate (not enrolled, not employed) by county",
    geo: "county",
    rate_numerator_vars: [
      "B14005_010E","B14005_011E","B14005_014E","B14005_015E",
      "B14005_024E","B14005_025E","B14005_028E","B14005_029E"
    ],
    rate_denominator_var: "B14005_001E",
    min_denominator: 200,
  },
  poverty_rate: {
    vars: ["B17001_001E", "B17001_002E"],
    label: "Population below poverty level by county",
    geo: "county",
    rate_numerator_vars: ["B17001_002E"],
    rate_denominator_var: "B17001_001E",
    min_denominator: 1000,
  },
  median_income: {
    vars: ["B19013_001E"],
    label: "Median household income by county",
    geo: "county",
    min_denominator: 0,
  },
  earnings_sex: {
    vars: ["B20017_001E", "B20017_002E", "B20017_003E"],
    label: "Median earnings by sex, full-time year-round workers by state",
    geo: "state",
  },
  commute_time: {
    vars: ["B08136_001E", "B08136_002E", "B08136_003E"],
    label: "Aggregate travel time to work by means (car vs transit) by county",
    geo: "county",
    min_denominator: 0,
  },
  foreign_born: {
    vars: ["B05001_001E", "B05001_006E"],
    label: "Foreign-born population share by state",
    geo: "state",
    rate_numerator_vars: ["B05001_006E"],
    rate_denominator_var: "B05001_001E",
  },
  language_isolation: {
    vars: ["B16004_001E", "B16004_067E"],
    label: "Linguistically isolated households by state",
    geo: "state",
    rate_numerator_vars: ["B16004_067E"],
    rate_denominator_var: "B16004_001E",
  },
  housing_cost_burden: {
    vars: ["B25070_001E", "B25070_010E"],
    label: "Renter households paying 50%+ of income on rent by county",
    geo: "county",
    rate_numerator_vars: ["B25070_010E"],
    rate_denominator_var: "B25070_001E",
    min_denominator: 500,
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
  mapping: TopicMapping
): Promise<SampleResult> {
  const { vars, label, geo } = mapping;
  const getParam = ["NAME", ...vars].join(",");

  let forClause = "";
  if (geo === "us") forClause = "for=us:1";
  else if (geo === "state") forClause = "for=state:*";
  else if (geo === "county") forClause = "for=county:*&in=state:*";

  const keyParam = CENSUS_KEY ? `&key=${CENSUS_KEY}` : "";
  const url = `${CENSUS_BASE}/${vintage}/${dataset_id}?get=${getParam}&${forClause}${keyParam}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Census API ${res.status}: ${text.slice(0, 300)}`);
  }

  const raw: string[][] = await res.json();
  const headers = raw[0];
  const rows = raw.slice(1);

  // Build structured rows
  const structured = rows.map(row => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });

  // Compute derived rate if configured, else sort by first var
  const minDenom = mapping.min_denominator ?? 0;
  let sortKey: (r: Record<string, string>) => number;

  if (mapping.rate_numerator_vars && mapping.rate_denominator_var) {
    const numVars = mapping.rate_numerator_vars;
    const denomVar = mapping.rate_denominator_var;
    sortKey = (r) => {
      const denom = Number(r[denomVar]);
      if (!denom || denom < minDenom) return -1;
      const num = numVars.reduce((sum, v) => sum + (Number(r[v]) || 0), 0);
      return num / denom;
    };
  } else {
    const firstVar = vars[0];
    sortKey = (r) => Number(r[firstVar]) || 0;
  }

  // Filter suppressed/invalid, sort descending
  const valid = structured.filter(r => {
    const denom = mapping.rate_denominator_var
      ? Number(r[mapping.rate_denominator_var])
      : Number(r[vars[0]]);
    return denom > (minDenom ?? 0)
      && !Object.values(r).some(v => v === "-666666666" || v === "-888888888");
  });

  const sorted = valid.sort((a, b) => sortKey(b) - sortKey(a));

  // Annotate with computed rate
  if (mapping.rate_numerator_vars && mapping.rate_denominator_var) {
    const numVars = mapping.rate_numerator_vars;
    const denomVar = mapping.rate_denominator_var;
    sorted.forEach(r => {
      const denom = Number(r[denomVar]);
      const num = numVars.reduce((sum, v) => sum + (Number(r[v]) || 0), 0);
      r["_rate"] = denom > 0 ? (num / denom * 100).toFixed(1) + "%" : "N/A";
      r["_neet_count"] = String(num);
    });
  }

  let combined = sorted;
  let note: string | undefined;

  if (geo === "county" && sorted.length > 20) {
    const top10 = sorted.slice(0, 10);
    const bottom10 = sorted.slice(-10).reverse();
    combined = [...top10, ...bottom10];
    note = `Top 10 highest and bottom 10 lowest of ${sorted.length} counties by rate`;
  }

  return {
    query_description: label,
    variables: vars,
    geography: geo,
    rows: combined,
    note,
  };
}
