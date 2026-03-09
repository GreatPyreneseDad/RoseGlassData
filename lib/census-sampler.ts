// lib/census-sampler.ts
// Shared Census API sampling logic — imported directly by chat route
// No HTTP round-trip needed

const CENSUS_BASE = "https://api.census.gov/data";
const CENSUS_KEY = process.env.CENSUS_API_KEY || "";

export const STATE_FIPS: Record<string, string> = {
  "alabama":"01","alaska":"02","arizona":"04","arkansas":"05","california":"06",
  "colorado":"08","connecticut":"09","delaware":"10","florida":"12","georgia":"13",
  "hawaii":"15","idaho":"16","illinois":"17","indiana":"18","iowa":"19",
  "kansas":"20","kentucky":"21","louisiana":"22","maine":"23","maryland":"24",
  "massachusetts":"25","michigan":"26","minnesota":"27","mississippi":"28","missouri":"29",
  "montana":"30","nebraska":"31","nevada":"32","new hampshire":"33","new jersey":"34",
  "new mexico":"35","new york":"36","north carolina":"37","north dakota":"38","ohio":"39",
  "oklahoma":"40","oregon":"41","pennsylvania":"42","rhode island":"44","south carolina":"45",
  "south dakota":"46","tennessee":"47","texas":"48","utah":"49","vermont":"50",
  "virginia":"51","washington":"53","west virginia":"54","wisconsin":"55","wyoming":"56",
};

export interface SampleResult {
  query_description: string;
  variables: string[];
  geography: string;
  rows: Array<Record<string, string>>;
  note?: string;
}

interface TopicMapping {
  vars: string[];
  label: string;
  geo: string;
  rate_numerator_vars?: string[];
  rate_denominator_var?: string;
  min_denominator?: number;
}

export const VARIABLE_MAP: Record<string, TopicMapping> = {
  youth_disconnected: {
    vars: [
      "B14005_001E",
      "B14005_010E","B14005_011E","B14005_014E","B14005_015E",
      "B14005_024E","B14005_025E","B14005_028E","B14005_029E",
    ],
    label: "Youth 16-19 NEET rate (not enrolled, not employed) by county",
    geo: "county",
    rate_numerator_vars: [
      "B14005_010E","B14005_011E","B14005_014E","B14005_015E",
      "B14005_024E","B14005_025E","B14005_028E","B14005_029E"
    ],
    rate_denominator_var: "B14005_001E",
    min_denominator: 500,
  },
  poverty_rate: {
    vars: ["B17001_001E","B17001_002E"],
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
    vars: ["B20017_001E","B20017_002E","B20017_003E"],
    label: "Median earnings by sex, full-time year-round workers by state",
    geo: "state",
  },
  commute_time: {
    vars: ["B08136_001E","B08136_002E","B08136_003E"],
    label: "Aggregate travel time to work by means (car vs transit) by county",
    geo: "county",
    min_denominator: 0,
  },
  foreign_born: {
    vars: ["B05001_001E","B05001_006E"],
    label: "Foreign-born population share by state",
    geo: "state",
    rate_numerator_vars: ["B05001_006E"],
    rate_denominator_var: "B05001_001E",
  },
  language_isolation: {
    vars: ["B16004_001E","B16004_067E"],
    label: "Linguistically isolated households by state",
    geo: "state",
    rate_numerator_vars: ["B16004_067E"],
    rate_denominator_var: "B16004_001E",
  },
  housing_cost_burden: {
    vars: ["B25070_001E","B25070_010E"],
    label: "Renter households paying 50%+ of income on rent by county",
    geo: "county",
    rate_numerator_vars: ["B25070_010E"],
    rate_denominator_var: "B25070_001E",
    min_denominator: 500,
  },
};

export function resolveStateFips(state: string): string | undefined {
  const lower = state.toLowerCase().trim();
  if (STATE_FIPS[lower]) return STATE_FIPS[lower];
  const key = Object.keys(STATE_FIPS).find(k => k.includes(lower));
  return key ? STATE_FIPS[key] : undefined;
}

export async function queryCensus(
  dataset_id: string,
  vintage: number,
  topic: string,
  stateFips?: string
): Promise<SampleResult | null> {
  const mapping = VARIABLE_MAP[topic];
  if (!mapping) return null;

  const { vars, label, geo } = mapping;
  const getParam = ["NAME", ...vars].join(",");

  let forClause = "";
  if (geo === "us") forClause = "for=us:1";
  else if (geo === "state") forClause = "for=state:*";
  else if (geo === "county") {
    forClause = stateFips
      ? `for=county:*&in=state:${stateFips}`
      : "for=county:*&in=state:*";
  }

  const keyParam = CENSUS_KEY ? `&key=${CENSUS_KEY}` : "";
  const url = `${CENSUS_BASE}/${vintage}/${dataset_id}?get=${getParam}&${forClause}${keyParam}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[census-sampler] ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }

    const raw: string[][] = await res.json();
    const headers = raw[0];
    const rows = raw.slice(1);

    const structured = rows.map(row => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });

    const minDenom = mapping.min_denominator ?? 0;

    const sortKey: (r: Record<string, string>) => number =
      mapping.rate_numerator_vars && mapping.rate_denominator_var
        ? (r) => {
            const denom = Number(r[mapping.rate_denominator_var!]);
            if (!denom || denom < minDenom) return -1;
            return mapping.rate_numerator_vars!.reduce((s, v) => s + (Number(r[v]) || 0), 0) / denom;
          }
        : (r) => Number(r[vars[0]]) || 0;

    const valid = structured.filter(r => {
      const denom = mapping.rate_denominator_var
        ? Number(r[mapping.rate_denominator_var])
        : Number(r[vars[0]]);
      return denom > minDenom
        && !Object.values(r).some(v => v === "-666666666" || v === "-888888888");
    });

    const sorted = valid.sort((a, b) => sortKey(b) - sortKey(a));

    if (mapping.rate_numerator_vars && mapping.rate_denominator_var) {
      const numVars = mapping.rate_numerator_vars;
      const denomVar = mapping.rate_denominator_var;
      sorted.forEach(r => {
        const denom = Number(r[denomVar]);
        const num = numVars.reduce((s, v) => s + (Number(r[v]) || 0), 0);
        r["_rate"] = denom > 0 ? (num / denom * 100).toFixed(1) + "%" : "N/A";
        r["_neet_count"] = String(num);
      });
    }

    const scopeLabel = stateFips ? `in state FIPS ${stateFips}` : "nationally";
    let combined = sorted;
    let note: string | undefined;

    if (geo === "county" && sorted.length > 15) {
      combined = sorted.slice(0, 15);
      note = `Top 15 of ${sorted.length} counties ${scopeLabel} by rate`;
    }

    return { query_description: label, variables: vars, geography: geo, rows: combined, note };

  } catch (err) {
    console.error("[census-sampler] fetch error:", err);
    return null;
  }
}
