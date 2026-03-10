// lib/csv-profiler.ts
// Parse CSV uploads and run Rose Glass profiler against column structure

export interface CSVColumn {
  name: string;
  label: string;
  concept: string;
  predicate_type: string;
  has_moe: boolean;
  is_moe: boolean;
  sample_values: string[];
  null_rate: number;
  unique_count: number;
}

export interface CSVProfile {
  name: string;
  connector: "csv";
  variable_count: number;
  concept_count: number;
  row_count: number;
  columns: CSVColumn[];
  psi: number; rho: number; q: number; f: number; tau: number; lambda: number;
  moe_coverage: number;
  absences: Array<{ domain: string; absence: string; significance: string }>;
  lens_summary: string;
}

// Infer concept domain from column name
function inferConcept(colName: string): string {
  const n = colName.toLowerCase().replace(/[_\s-]+/g, " ");
  if (/age|dob|birth|born/.test(n)) return "AGE AND SEX";
  if (/income|revenue|salary|wage|earn|pay|compensation/.test(n)) return "INCOME";
  if (/race|ethnicity|hispanic|latino|asian|black|white|native/.test(n)) return "RACE AND ETHNICITY";
  if (/employ|job|occupation|work|labor|career/.test(n)) return "EMPLOYMENT STATUS";
  if (/education|school|degree|graduate|college|diploma/.test(n)) return "EDUCATIONAL ATTAINMENT";
  if (/house|home|rent|mortgage|property|dwelling|bedroom/.test(n)) return "HOUSING";
  if (/health|medical|hospital|insurance|disability|diagnosis/.test(n)) return "HEALTH AND DISABILITY";
  if (/family|household|spouse|married|divorced|single|child|parent/.test(n)) return "HOUSEHOLD AND FAMILY";
  if (/poverty|snap|welfare|benefit|assistance/.test(n)) return "POVERTY AND ASSISTANCE";
  if (/language|english|spanish|foreign|immigrant|citizen|visa/.test(n)) return "LANGUAGE AND CITIZENSHIP";
  if (/commute|transit|vehicle|car|transport|travel/.test(n)) return "COMMUTING";
  if (/veteran|military|service|army|navy|marine/.test(n)) return "VETERAN STATUS";
  if (/crime|arrest|conviction|incarcerat|prison|jail/.test(n)) return "CRIMINAL JUSTICE";
  if (/date|time|year|month|day|timestamp|created|updated/.test(n)) return "TEMPORAL";
  if (/id|key|code|number|num|count|total/.test(n)) return "IDENTIFIER";
  if (/address|city|state|zip|county|region|location|geo|lat|lon/.test(n)) return "GEOGRAPHY";
  if (/gender|sex/.test(n)) return "AGE AND SEX";
  if (/mental|anxiety|depression|substance|drug|alcohol|recovery/.test(n)) return "MENTAL HEALTH AND SUBSTANCE USE";
  if (/weight|height|bmi|exercise|diet|nutrition/.test(n)) return "PHYSICAL HEALTH";
  if (/score|rating|grade|rank|index|measure/.test(n)) return "ASSESSMENT AND SCORING";
  if (/note|comment|description|narrative|text|reason/.test(n)) return "QUALITATIVE";
  if (/status|type|category|class|tier|level/.test(n)) return "CLASSIFICATION";
  return "UNCATEGORIZED";
}

// Infer data type from sample values
function inferType(samples: string[]): string {
  const nonEmpty = samples.filter(v => v !== "" && v !== null && v !== undefined);
  if (nonEmpty.length === 0) return "string";
  const nums = nonEmpty.filter(v => !isNaN(Number(v)) && v.trim() !== "");
  if (nums.length / nonEmpty.length > 0.85) return "int";
  const dates = nonEmpty.filter(v => /^\d{4}-\d{2}-\d{2}/.test(v) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(v));
  if (dates.length / nonEmpty.length > 0.7) return "date";
  return "string";
}

export function profileCSV(
  filename: string,
  headers: string[],
  rows: string[][]
): CSVProfile {
  const rowCount = rows.length;
  const columns: CSVColumn[] = headers.map((header, colIdx) => {
    const values = rows.map(r => r[colIdx] ?? "");
    const nonEmpty = values.filter(v => v !== "" && v !== null);
    const nullRate = 1 - nonEmpty.length / Math.max(values.length, 1);
    const sample = nonEmpty.slice(0, 20);
    const unique = new Set(values).size;
    const concept = inferConcept(header);
    const predType = inferType(sample);

    return {
      name: header,
      label: header.replace(/[_-]/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      concept,
      predicate_type: predType,
      has_moe: false,
      is_moe: false,
      sample_values: sample.slice(0, 5),
      null_rate: Math.round(nullRate * 100) / 100,
      unique_count: unique,
    };
  });

  const conceptSet = new Set(columns.map(c => c.concept));
  const conceptList = Array.from(conceptSet);

  // Rose Glass dimensional scoring
  const contested = ["RACE AND ETHNICITY","POVERTY AND ASSISTANCE","LANGUAGE AND CITIZENSHIP",
    "CRIMINAL JUSTICE","MENTAL HEALTH AND SUBSTANCE USE","INCOME","EMPLOYMENT STATUS"];
  const contestedHits = contested.filter(t => conceptList.includes(t)).length;

  const avgNullRate = columns.reduce((s, c) => s + c.null_rate, 0) / columns.length;
  const psi = Math.max(0.2, Math.min(0.95, 0.8 - avgNullRate * 0.5));

  const hasTemporalDimension = conceptList.includes("TEMPORAL");
  const rho = hasTemporalDimension ? 0.7 : 0.5;

  const q = Math.min(0.95, 0.2 + contestedHits * 0.1);

  const hasHousehold = conceptList.includes("HOUSEHOLD AND FAMILY");
  const hasIndividual = conceptList.includes("AGE AND SEX") || conceptList.includes("ASSESSMENT AND SCORING");
  const f = hasHousehold && !hasIndividual ? 0.4 : hasIndividual ? 0.65 : 0.55;

  const tau = hasTemporalDimension ? 0.7 : 0.4;

  const highCardinality = columns.filter(c => c.unique_count / Math.max(rowCount, 1) > 0.8).length;
  const lambda = Math.min(0.9, 0.3 + contestedHits * 0.07 + (highCardinality > 3 ? 0.15 : 0));

  // Absence detection — what domains are missing given what's present
  const absences: Array<{ domain: string; absence: string; significance: string }> = [];
  if (conceptList.includes("INCOME") && !conceptList.includes("HOUSING"))
    absences.push({ domain: "Economic", absence: "Housing cost and stability", significance: "Income is tracked but not what it must cover — housing burden is invisible" });
  if (conceptList.includes("EMPLOYMENT STATUS") && !conceptList.includes("INCOME"))
    absences.push({ domain: "Economic", absence: "Compensation and wage levels", significance: "Employment status without earnings hides the working poor" });
  if (conceptList.includes("HEALTH AND DISABILITY") && !conceptList.includes("MENTAL HEALTH AND SUBSTANCE USE"))
    absences.push({ domain: "Health", absence: "Mental health and substance use", significance: "Physical health is tracked; psychological health is not — a structural blind spot in most clinical systems" });
  if (!conceptList.includes("QUALITATIVE"))
    absences.push({ domain: "Voice", absence: "Narrative and qualitative data", significance: "Every column is categorical or numeric — the person behind the row has no way to speak in their own terms" });
  if (conceptList.includes("RACE AND ETHNICITY") && !conceptList.includes("LANGUAGE AND CITIZENSHIP"))
    absences.push({ domain: "Identity", absence: "Language and origin context", significance: "Race is captured; the immigration and language context that shapes how race is experienced is not" });
  if (!conceptList.includes("TEMPORAL") && rowCount > 500)
    absences.push({ domain: "Time", absence: "Temporal dimension", significance: "No date or time variable — this data is a snapshot without memory. Trajectories and change are invisible." });
  if (conceptList.includes("ASSESSMENT AND SCORING") && !conceptList.includes("QUALITATIVE"))
    absences.push({ domain: "Measurement", absence: "Context for scores", significance: "Scores without narrative: the number exists, the conditions producing it do not" });

  // Lens summary — who built this and what were they trying to see
  const lensFragments: string[] = [];
  const name = filename.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
  lensFragments.push(`This dataset appears to be ${rowCount > 10000 ? "a large administrative record" : rowCount > 1000 ? "a mid-scale operational dataset" : "a small dataset, possibly a sample or pilot"}.`);
  if (contestedHits > 3)
    lensFragments.push("It captures multiple contested demographic categories — the builder was interested in who people are, not just what they do.");
  else if (conceptList.includes("ASSESSMENT AND SCORING"))
    lensFragments.push("The presence of scoring variables suggests an evaluative frame — the dataset was built to measure outcomes against a standard.");
  else if (conceptList.includes("CRIMINAL JUSTICE"))
    lensFragments.push("The criminal justice dimension encodes a particular lens: people appear here in relation to the state's enforcement apparatus.");
  else
    lensFragments.push("The column structure reveals a primarily operational frame — tracking transactions or states rather than understanding people.");

  const highNullCols = columns.filter(c => c.null_rate > 0.3).map(c => c.name);
  if (highNullCols.length > 0)
    lensFragments.push(`${highNullCols.length} column${highNullCols.length > 1 ? "s are" : " is"} more than 30% empty — either optionally collected, poorly enforced, or tracking something that rarely applies.`);

  const lens_summary = lensFragments.join(" ");

  return {
    name: name || filename,
    connector: "csv",
    variable_count: columns.length,
    concept_count: conceptList.length,
    row_count: rowCount,
    columns,
    psi, rho, q, f, tau, lambda,
    moe_coverage: 0,
    absences,
    lens_summary,
  };
}
