// lib/reader/structural.ts
// Deterministic "structural pre-layer" for the EE26 schema read.
//
// This is NOT a new reader. It is an added deterministic lens that runs over the
// raw rows BEFORE/ALONGSIDE the existing profileCSV + Claude translateColumns
// pipeline, and surfaces structure those two cannot see from 5 sample values and a
// mean: the *kind* of each coded null, raw->derived shadow pairs, design weights,
// imputed-vs-reported variables, and the "absence wearing a large number" arithmetic
// (a naive mean vs the mean over the variable's *validated domain*).
//
// Vocabulary is fixed to what the read is allowed to say (Two Hands / Hand 1):
// semantic type, collection method, proxy risk, null semantics (which KIND),
// structural absence, raw-vs-derived dependency, imputed-vs-reported. No score, no
// grade, no advice.
//
// Correctness rules this file enforces (see EE26_PATCH_BRIEF):
//  - A corrected mean is the mean over the variable's *defined valid domain*, not
//    "naive minus the codes we happened to detect." Codes fall out because they are
//    out of range — that is the point. Without a codebook domain we DO NOT assert a
//    corrected mean as truth (Veritas).
//  - Categorical code columns get NO mean (a mean over _RACE codes is not a quantity);
//    they get a code-frequency distribution instead.
//  - Sentinel detection is GAP-based: a contiguous run like 1..9 has no sentinels;
//    1..30 then 77/88/99 does. This stops 7/8/9 from being mistaken for reserved
//    codes on categorical variables.

export type NullKind =
  | "absent_as_value" // a "None / zero" answer coded as a number (e.g. 88)
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

// The naive-vs-corrected reading. `corrected_mean` is the mean over the validated
// domain and is null when no domain is known for this variable (unknown CSV) —
// in that case the read shows the naive mean + suspected codes and states that the
// valid domain is unverified, rather than asserting a corrected number as truth.
export interface MeanReading {
  naive_mean: number;
  corrected_mean: number | null;
  valid_domain: string | null; // e.g. "1–30"; null when unverified
  zero_code: string | null; // a code that semantically means "0" (e.g. "88")
  zero_inclusive_mean: number | null; // corrected mean counting zero_code as 0
  excluded_codes: string[]; // reserved codes named (or suspected, when unverified)
  n_valid: number;
  n_excluded: number;
  domain_verified: boolean; // false => corrected_mean is null, do not assert truth
  sample_caveat: string; // inline "unweighted sample" tag for THIS mean
}

export interface CategoricalDistribution {
  total: number; // n of non-empty coded values
  codes: Array<{ code: string; n: number }>; // by frequency, capped
  truncated: number; // distinct codes not shown
}

export interface ColumnStructure {
  name: string;
  raw_or_derived: "raw" | "derived" | null;
  derived_from: string[] | null; // for a derived col, the raw col(s) it shadows
  is_design_weight: boolean;
  is_imputed: boolean; // value assigned upstream where the answer was missing
  imputed_note: string | null; // the distinct imputed-vs-reported read line
  null_findings: NullFinding[]; // typed nulls detected deterministically
  naive_vs_valid: MeanReading | null; // the "means lie" arithmetic, when a mean applies
  categorical_distribution: CategoricalDistribution | null; // for categorical columns
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

// Per-variable VALID DOMAIN table for the day-count / numeric items in this cut.
// corrected mean = mean over [lo, hi]; zeroCode is a reserved code that means "0".
// Everything NOT here, in a recognised BRFSS file, is treated as categorical (no mean).
const BRFSS_COUNT_DOMAINS: Record<string, { lo: number; hi: number; zeroCode?: number }> = {
  MENTHLTH: { lo: 1, hi: 30, zeroCode: 88 },
  PHYSHLTH: { lo: 1, hi: 30, zeroCode: 88 },
  POORHLTH: { lo: 1, hi: 30, zeroCode: 88 },
  CHILDREN: { lo: 1, hi: 87, zeroCode: 88 },
};

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

// Parse a token to its integer CODE when it represents a whole number — accepting
// both "88" and the "88.0" form that SAS/XPT->CSV exports (like this BRFSS file)
// emit. Returns null for blanks, text, or genuinely fractional values.
function asIntCode(v: string): number | null {
  const t = v.trim();
  if (!/^-?\d+(?:\.0+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// Codes we recognise as conventional survey reserved values.
const SENTINEL_CANDIDATES = new Set([
  7, 8, 9, 77, 88, 99, 777, 888, 999, 7777, 8888, 9999,
]);

// Classify a reserved code by its digit pattern. Single-digit 8 is deliberately NOT
// asserted as "None" — only repunit 88/888 carry the absence-as-zero meaning; a bare
// 8 is an ambiguous category code on many items, so it stays a generic reserved code.
function classifySentinel(code: number): { kind: NullKind; label: string } {
  const s = String(code);
  if (/^8{2,}$/.test(s)) return { kind: "absent_as_value", label: "None / zero — an absence coded as a number" };
  if (/^7+$/.test(s)) return { kind: "dont_know", label: "Don’t know / not sure" };
  if (/^9+$/.test(s)) return { kind: "refused", label: "Refused" };
  return { kind: "sentinel", label: `Reserved code (${code})` };
}

function detectConcept(name: string): string | null {
  for (const [re, label] of CONTESTED) if (re.test(name)) return label;
  return null;
}

// GAP-based sentinel detection. Returns the trailing reserved codes that sit ABOVE a
// gap from the contiguous body of values, and the body's max. A contiguous run such
// as 1..9 yields no sentinels (gap of 1); 1..30 then 77/88/99 yields {77,88,99}.
function detectSentinels(ints: number[]): { sentinels: number[]; bodyMax: number } {
  const distinct = Array.from(new Set(ints)).sort((a, b) => a - b);
  if (distinct.length === 0) return { sentinels: [], bodyMax: -Infinity };

  let i = distinct.length - 1;
  const trailing: number[] = [];
  while (i >= 0 && SENTINEL_CANDIDATES.has(distinct[i])) {
    trailing.unshift(distinct[i]);
    i--;
  }
  // No trailing candidates -> nothing reserved at the top.
  if (trailing.length === 0) return { sentinels: [], bodyMax: distinct[distinct.length - 1] };
  // Every value is a candidate (column holds only reserved codes).
  if (i < 0) return { sentinels: trailing, bodyMax: -Infinity };

  const bodyMax = distinct[i];
  const gap = trailing[0] - bodyMax;
  // Require a real discontinuity; a gap of 1 means the "candidates" are just the top
  // of a contiguous category scale (e.g. _RACE 1..9), not reserved codes.
  if (gap >= 2) return { sentinels: trailing, bodyMax };
  return { sentinels: [], bodyMax: distinct[distinct.length - 1] };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Run the deterministic structural lens over parsed CSV rows.
 * Pure / synchronous / no network.
 */
export function analyzeStructure(headers: string[], rows: string[][]): DatasetStructure {
  const nRows = rows.length;
  const headerSet = new Set(headers);
  const looksLikeBrfss =
    headerSet.has("SEXVAR") && headerSet.has("_LLCPWT") && headerSet.has("MENTHLTH");

  // Pre-scan weights so each per-column mean can carry an accurate inline caveat.
  const isWeightName = (name: string) =>
    BRFSS_WEIGHTS.includes(name) ||
    /(^_?wt\d*$|weight$|^pweight$|finalwt|_llcpwt|_ststr|_psu|rake)/i.test(name);
  const weightNames = headers.filter(isWeightName);
  const primaryWeight = weightNames.includes("_LLCPWT") ? "_LLCPWT" : weightNames[0];
  const sampleCaveat = weightNames.length
    ? `unweighted sample — describes these ${nRows.toLocaleString()} rows, not the population (${primaryWeight} not applied)`
    : `unweighted — describes these ${nRows.toLocaleString()} sampled rows, not a population estimate`;

  const columns: ColumnStructure[] = headers.map((name, colIdx) => {
    const raw = rows.map((r) => (r[colIdx] ?? "").trim());
    const nonEmpty = raw.filter((v) => v !== "");
    const blanks = nRows - nonEmpty.length;

    // raw vs derived: CDC convention is a leading underscore.
    const isDerived = name.startsWith("_");
    let derivedFrom: string[] | null = null;
    if (isDerived) {
      const parents = Object.entries(BRFSS_RAW_TO_DERIVED)
        .filter(([, ds]) => ds.includes(name))
        .map(([rawName]) => rawName)
        .filter((p) => headerSet.has(p));
      derivedFrom = parents.length ? parents : null;
    }

    const isWeight = isWeightName(name);

    // ---- imputed-vs-reported (Defect 3) ----
    // Detected from the derivation/naming CONVENTION, not a hardcoded column name:
    // CDC marks imputed variables with an _IMP* prefix; we also catch explicit
    // "imputed"/"allocated" markers. This generalises to _IMPRACE, _IMPNPH, etc.
    let isImputed = false;
    let imputedNote: string | null = null;
    const impMatch = /^_imp(.+)/i.exec(name);
    const impWord = /imput|allocat/i.test(name);
    if (impMatch || impWord) {
      isImputed = true;
      // Find the as-reported sibling: _IMPRACE -> _RACE (or RACE).
      let partner: string | null = null;
      if (impMatch) {
        const stem = impMatch[1];
        for (const cand of [`_${stem}`, stem]) {
          if (headerSet.has(cand) && cand !== name) {
            partner = cand;
            break;
          }
        }
      }
      const concept = detectConcept(name) || "this measure";
      imputedNote =
        `IMPUTED — values were assigned upstream where ${concept} was not reported, not given by the respondent.` +
        (partner
          ? ` Distinct from ${partner} (as-reported). Treating the two as equivalent imports the imputation as if it were data.`
          : "");
    }

    // ---- numeric body / typed nulls ----
    const ints = nonEmpty
      .map(asIntCode)
      .filter((n): n is number => n !== null);
    const isNumericCol = ints.length >= 20 && ints.length >= nonEmpty.length * 0.8;
    const { sentinels, bodyMax } = isNumericCol
      ? detectSentinels(ints)
      : { sentinels: [], bodyMax: -Infinity };
    const sentinelSet = new Set(sentinels);

    const nullFindings: NullFinding[] = [];

    // not_asked: a column blank for a large share of rows reads as skip-logic
    // absence ("question never reached these people"), not a real "no answer".
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

    // Type each detected reserved code (gap-based, so categorical scales like 1..9
    // produce no false null kinds).
    for (const c of sentinels) {
      const { kind, label } = classifySentinel(c);
      nullFindings.push({ code: String(c), kind, label, n: ints.filter((x) => x === c).length });
    }

    // ---- classify the column to decide mean vs distribution ----
    // count       -> documented numeric domain: corrected mean over [lo,hi]
    // categorical -> coded categories: NO mean, show distribution
    // unverified  -> numeric but no domain table: naive + suspected codes, no asserted mean
    // none        -> weight / non-numeric / nothing to say
    const bodyVals = ints.filter((v) => !sentinelSet.has(v));
    const distinctBody = new Set(bodyVals).size;
    let klass: "count" | "categorical" | "unverified" | "none" = "none";
    if (isWeight || !isNumericCol) {
      klass = "none";
    } else if (looksLikeBrfss && BRFSS_COUNT_DOMAINS[name]) {
      klass = "count";
    } else if (looksLikeBrfss) {
      klass = distinctBody <= 25 ? "categorical" : "unverified";
    } else {
      // Unknown CSV: no domain table exists, so never assert a corrected mean.
      klass = "unverified";
    }

    let naiveVsValid: MeanReading | null = null;
    let categoricalDistribution: CategoricalDistribution | null = null;

    if (klass === "count") {
      const spec = BRFSS_COUNT_DOMAINS[name];
      const naive = ints.reduce((s, x) => s + x, 0) / ints.length;
      const inDomain = ints.filter((v) => v >= spec.lo && v <= spec.hi);
      const corrected = inDomain.length
        ? round2(inDomain.reduce((s, x) => s + x, 0) / inDomain.length)
        : null;
      const zeroN = spec.zeroCode != null ? ints.filter((v) => v === spec.zeroCode).length : 0;
      const zeroIncl =
        spec.zeroCode != null && zeroN > 0 && inDomain.length
          ? round2(inDomain.reduce((s, x) => s + x, 0) / (inDomain.length + zeroN))
          : null;
      naiveVsValid = {
        naive_mean: round2(naive),
        corrected_mean: corrected,
        valid_domain: `${spec.lo}–${spec.hi}`,
        zero_code: spec.zeroCode != null && zeroN > 0 ? String(spec.zeroCode) : null,
        zero_inclusive_mean: zeroIncl,
        excluded_codes: sentinels.map(String),
        n_valid: inDomain.length,
        n_excluded: ints.length - inDomain.length,
        domain_verified: true,
        sample_caveat: sampleCaveat,
      };
    } else if (klass === "categorical") {
      const freq = new Map<number, number>();
      for (const v of ints) freq.set(v, (freq.get(v) ?? 0) + 1);
      const sorted = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
      const CAP = 10;
      categoricalDistribution = {
        total: ints.length,
        codes: sorted.slice(0, CAP).map(([code, n]) => ({ code: String(code), n })),
        truncated: Math.max(0, sorted.length - CAP),
      };
    } else if (klass === "unverified") {
      // Only worth surfacing when there are suspected reserved codes to flag, and the
      // body looks count-like (small range) so a naive mean is plausibly being misread.
      if (sentinels.length > 0 && bodyMax <= 60) {
        const naive = ints.reduce((s, x) => s + x, 0) / ints.length;
        naiveVsValid = {
          naive_mean: round2(naive),
          corrected_mean: null,
          valid_domain: null,
          zero_code: null,
          zero_inclusive_mean: null,
          excluded_codes: sentinels.map(String),
          n_valid: bodyVals.length,
          n_excluded: ints.length - bodyVals.length,
          domain_verified: false,
          sample_caveat: sampleCaveat,
        };
      }
    }

    return {
      name,
      raw_or_derived: isDerived ? "derived" : "raw",
      derived_from: derivedFrom,
      is_design_weight: isWeight,
      is_imputed: isImputed,
      imputed_note: imputedNote,
      null_findings: nullFindings,
      naive_vs_valid: naiveVsValid,
      categorical_distribution: categoricalDistribution,
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
