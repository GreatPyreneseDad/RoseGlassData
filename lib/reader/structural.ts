// lib/reader/structural.ts
// Deterministic "structural pre-layer" for the EE26 schema read.
//
// This is NOT a new reader. It is an added deterministic lens that runs over the
// raw rows BEFORE/ALONGSIDE the existing profileCSV + Claude translateColumns
// pipeline, and surfaces structure those two cannot see from 5 sample values and a
// mean: the *kind* of each coded null, raw->derived shadow pairs, design weights,
// and the "absence wearing a large number" arithmetic (a naive mean vs the mean of
// only valid values).
//
// Vocabulary is fixed to what the read is allowed to say (Two Hands / Hand 1):
// semantic type, collection method, proxy risk, null semantics (which KIND),
// structural absence, raw-vs-derived dependency. No score, no grade, no advice.
//
// It is generic first (works on any survey-style CSV via numeric sentinel
// detection) and pattern-aware second (a small, documented BRFSS map enriches the
// raw->derived partners and the policy-deleted note when the file is recognisably
// BRFSS). Where it cannot verify, it stays silent — it returns null/empty, never a
// guess.

export type NullKind =
  | "absent_as_value" // a "None / zero" answer coded as a large number (e.g. 88)
  | "dont_know" // "Don't know / not sure" coded as a number (e.g. 7/77/777)
  | "refused" // "Refused" coded as a number (e.g. 9/99/999)
  | "not_asked" // blank because skip-logic never posed the question to this row
  | "sentinel"; // a reserved code detached from the real range, kind unresolved

export interface NullFinding {
  code: string; // the literal code, or "(blank)"
  kind: NullKind;
  label: string; // human label for the kind
  n: number; // how many rows carry it
}

export interface NaiveVsValid {
  naive_mean: number; // mean over ALL numeric values, sentinels included
  valid_mean: number; // mean over only the real (non-sentinel) values
  excluded_codes: string[]; // which codes were excluded to get valid_mean
  n_valid: number;
  n_excluded: number;
}

export interface ColumnStructure {
  name: string;
  raw_or_derived: "raw" | "derived" | null;
  derived_from: string[] | null; // for a derived col, the raw col(s) it shadows
  is_design_weight: boolean;
  null_findings: NullFinding[]; // typed nulls detected deterministically
  naive_vs_valid: NaiveVsValid | null; // the "means lie" arithmetic, when it applies
  structural_absence: string | null; // skip-logic / mostly-empty note
  proxy_concept: string | null; // contested concept this column encodes, if any
}

export interface DatasetStructure {
  columns: ColumnStructure[];
  design_weights: string[]; // names of detected design/weight columns
  raw_derived_pairs: Array<{ raw: string; derived: string[] }>;
  notes: string[]; // dataset-level structural notes (verifiable only)
  looks_like_brfss: boolean;
}

// ---- BRFSS-aware enrichment (documented, narrow) --------------------------
// Only used to name raw->derived PARTNERS and the CDC policy note. The detection
// engine below is generic and does not depend on these.
const BRFSS_RAW_TO_DERIVED: Record<string, string[]> = {
  CRVCLPAP: ["_RFPAP37", "_PAPHPV1"],
  HADMAM: ["_RFMAM23", "_MAM402Y"],
  CRVCLHPV: ["_HPV5YR1"],
  HPVADVC4: ["_HPV5YR1"],
};
const BRFSS_WEIGHTS = ["_LLCPWT", "_PSU", "_STSTR", "_RAWRAKE", "_WT2RAKE", "_STRWT"];
const BRFSS_POLICY_NOTE =
  "CDC states the 2024 BRFSS file was modified to comply with executive orders; some answers may point at questions that were removed, so a few values can look inconsistent. That absence was created upstream, by policy — not by the respondent.";

// Contested concepts that carry proxy risk by construction (named, not scored).
const CONTESTED: Array<[RegExp, string]> = [
  [/race|ethnic|hispan|imprace/i, "race / ethnicity"],
  [/income|incomg|earn|salary|wage/i, "income"],
  [/educ/i, "educational attainment"],
  [/marital|marriage/i, "marital status"],
  [/employ/i, "employment status"],
  [/zip|zcta|postal|county|tract|fips|geo/i, "geography (segregation proxy)"],
  [/veteran/i, "veteran status"],
  [/preg/i, "pregnancy status"],
];

function isIntToken(v: string): boolean {
  return /^-?\d+$/.test(v.trim());
}

// Codes we recognise as conventional survey reserved values.
const SENTINEL_CANDIDATES = new Set([
  7, 8, 9, 77, 88, 99, 777, 888, 999, 7777, 8888, 9999,
]);

function classifySentinel(code: number): { kind: NullKind; label: string } {
  const s = String(code);
  if (/^8+$/.test(s)) return { kind: "absent_as_value", label: "None / zero — an absence coded as a number" };
  if (/^7+$/.test(s)) return { kind: "dont_know", label: "Don’t know / not sure" };
  if (/^9+$/.test(s)) return { kind: "refused", label: "Refused" };
  return { kind: "sentinel", label: "Reserved code" };
}

function detectConcept(name: string): string | null {
  for (const [re, label] of CONTESTED) if (re.test(name)) return label;
  return null;
}

/**
 * Run the deterministic structural lens over parsed CSV rows.
 * Pure / synchronous / no network.
 */
export function analyzeStructure(headers: string[], rows: string[][]): DatasetStructure {
  const nRows = rows.length;
  const headerSet = new Set(headers);
  const looksLikeBrfss =
    headerSet.has("SEXVAR") && headerSet.has("_LLCPWT") && headerSet.has("MENTHLTH");

  const columns: ColumnStructure[] = headers.map((name, colIdx) => {
    const raw = rows.map((r) => (r[colIdx] ?? "").trim());
    const nonEmpty = raw.filter((v) => v !== "");
    const blanks = nRows - nonEmpty.length;

    // raw vs derived: CDC convention is a leading underscore.
    const isDerived = name.startsWith("_");
    let derivedFrom: string[] | null = null;
    if (!isDerived && BRFSS_RAW_TO_DERIVED[name]) {
      derivedFrom = null; // this is the RAW side; partners recorded at dataset level
    }
    if (isDerived) {
      // find the raw col(s) that name this derived col as a partner
      const parents = Object.entries(BRFSS_RAW_TO_DERIVED)
        .filter(([, ds]) => ds.includes(name))
        .map(([rawName]) => rawName)
        .filter((p) => headerSet.has(p));
      derivedFrom = parents.length ? parents : null;
    }

    const isWeight =
      BRFSS_WEIGHTS.includes(name) ||
      /(^_?wt\d*$|weight$|^pweight$|finalwt|_llcpwt|_ststr|_psu|rake)/i.test(name);

    // ---- typed null detection (numeric columns only) ----
    const ints = nonEmpty.filter(isIntToken).map((v) => parseInt(v, 10));
    const nullFindings: NullFinding[] = [];
    let naiveVsValid: NaiveVsValid | null = null;

    // not_asked: a column that is blank for a large share of rows reads as
    // "the question never reached these people" (skip logic), not "no answer".
    let structuralAbsence: string | null = null;
    const blankRate = nRows > 0 ? blanks / nRows : 0;
    if (blankRate >= 0.4 && blanks > 0) {
      nullFindings.push({
        code: "(blank)",
        kind: "not_asked",
        label: "Not asked — skip logic never posed this question to these rows",
        n: blanks,
      });
      structuralAbsence = `${Math.round(blankRate * 100)}% blank — reads as skip-logic absence (question not posed), distinct from a real "no answer".`;
    }

    // Only attempt sentinel detection on genuinely integer-coded, non-weight columns.
    if (!isWeight && ints.length >= 20) {
      const present = new Set(ints.filter((n) => SENTINEL_CANDIDATES.has(n)));
      const core = ints.filter((n) => !present.has(n));
      // reduce, not Math.max(...core): spreading a multi-thousand-element array can
      // overflow the call stack.
      const coreMax = core.length ? core.reduce((m, n) => (n > m ? n : m), -Infinity) : -Infinity;
      const detected: number[] = [];
      for (const c of present) {
        // A code is a sentinel only when it sits detached ABOVE the real range.
        if (c > coreMax) {
          const { kind, label } = classifySentinel(c);
          const n = ints.filter((x) => x === c).length;
          nullFindings.push({ code: String(c), kind, label, n });
          detected.push(c);
        }
      }
      // "absence wearing a large number": when a None/DK/Refused code is detached
      // and the real range is small (count/day-like), the naive mean is a lie.
      const hasAbsentCode = nullFindings.some((f) => f.kind === "absent_as_value");
      if (detected.length && core.length >= 5 && coreMax <= 60 && hasAbsentCode) {
        const naive = ints.reduce((s, x) => s + x, 0) / ints.length;
        const valid = core.reduce((s, x) => s + x, 0) / core.length;
        naiveVsValid = {
          naive_mean: Math.round(naive * 100) / 100,
          valid_mean: Math.round(valid * 100) / 100,
          excluded_codes: detected.map(String),
          n_valid: core.length,
          n_excluded: ints.length - core.length,
        };
      }
    }

    return {
      name,
      raw_or_derived: isDerived ? "derived" : "raw",
      derived_from: derivedFrom,
      is_design_weight: isWeight,
      null_findings: nullFindings,
      naive_vs_valid: naiveVsValid,
      structural_absence: structuralAbsence,
      proxy_concept: detectConcept(name),
    };
  });

  const designWeights = columns.filter((c) => c.is_design_weight).map((c) => c.name);

  const rawDerivedPairs: Array<{ raw: string; derived: string[] }> = [];
  for (const [rawName, ds] of Object.entries(BRFSS_RAW_TO_DERIVED)) {
    if (!headerSet.has(rawName)) continue;
    const present = ds.filter((d) => headerSet.has(d));
    if (present.length) rawDerivedPairs.push({ raw: rawName, derived: present });
  }

  const notes: string[] = [];
  if (designWeights.length) {
    notes.push(
      `Design weights present (${designWeights.join(", ")}). Any unweighted count or mean over these rows describes the sample, not the population — it is not a prevalence estimate.`
    );
  }
  if (rawDerivedPairs.length) {
    notes.push(
      `Raw responses carry CDC-calculated shadow columns (e.g. ${rawDerivedPairs
        .slice(0, 2)
        .map((p) => `${p.raw} → ${p.derived.join(", ")}`)
        .join("; ")}). The derived columns are not independent variables; they depend on the raw answer.`
    );
  } else {
    const derivedCount = columns.filter((c) => c.raw_or_derived === "derived").length;
    if (derivedCount > 0) {
      notes.push(
        `${derivedCount} column${derivedCount > 1 ? "s are" : " is"} CDC-derived (leading underscore) — computed from raw responses, not collected directly.`
      );
    }
  }
  if (looksLikeBrfss) notes.push(BRFSS_POLICY_NOTE);

  return {
    columns,
    design_weights: designWeights,
    raw_derived_pairs: rawDerivedPairs,
    notes,
    looks_like_brfss: looksLikeBrfss,
  };
}
