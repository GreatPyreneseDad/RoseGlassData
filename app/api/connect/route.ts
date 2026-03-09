import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";

const CENSUS_BASE = "https://api.census.gov/data";

interface CensusVariable {
  label: string;
  concept: string;
  predicateType: string;
}

export async function POST(request: NextRequest) {
  try {
    const { dataset_id, vintage, name } = await request.json();
    if (!dataset_id || !vintage) {
      return NextResponse.json({ error: "dataset_id and vintage required" }, { status: 400 });
    }

    const db = getDB();
    const endpoint = `${CENSUS_BASE}/${vintage}/${dataset_id}`;
    const varsUrl = `${endpoint}/variables.json`;

    const varsRes = await fetch(varsUrl, { signal: AbortSignal.timeout(30_000) });
    if (!varsRes.ok) {
      return NextResponse.json({ error: `Census API error: ${varsRes.status} for ${varsUrl}` }, { status: 502 });
    }
    const varsData = await varsRes.json();
    const variables = varsData.variables || {};

    let geographies: string[] = [];
    try {
      const geoRes = await fetch(`${endpoint}/geography.json`, { signal: AbortSignal.timeout(10_000) });
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        geographies = (geoData.fips || []).map((g: { name: string }) => g.name).slice(0, 20);
      }
    } catch { /* geography is optional */ }

    const varEntries = Object.entries(variables).filter(([k]) =>
      k !== "for" && k !== "in" && k !== "ucgid"
    );

    const concepts = new Set<string>();
    const moeNames = new Set(
      varEntries.filter(([k]) => k.endsWith("M") || k.endsWith("MA")).map(([k]) => k)
    );
    let moeCount = 0, estimateCount = 0;

    const processed: Array<{
      name: string; label: string; concept: string;
      predicate_type: string; has_moe: boolean; is_moe: boolean;
    }> = [];

    for (const [varName, varDef] of varEntries as [string, CensusVariable][]) {
      const concept = varDef.concept || "UNCATEGORIZED";
      concepts.add(concept);
      const is_moe = moeNames.has(varName);
      const has_moe = !is_moe && moeNames.has(varName + "M");
      if (is_moe) moeCount++; else estimateCount++;
      processed.push({
        name: varName, label: varDef.label || "", concept,
        predicate_type: varDef.predicateType || "string", has_moe, is_moe,
      });
    }

    const moe_coverage = estimateCount > 0 ? Math.round((moeCount / estimateCount) * 100) : 0;

    const sessionRes = await db.query(
      `INSERT INTO db_sessions (name, connector, dataset_id, vintage, endpoint_url, profiled_at, variable_count, concept_count, geography_depth)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8) RETURNING id`,
      [name || `${dataset_id} ${vintage}`, "census", dataset_id, vintage, endpoint,
       processed.length, concepts.size, geographies]
    );
    const sessionId = sessionRes.rows[0].id;

    const BATCH = 500;
    for (let i = 0; i < processed.length; i += BATCH) {
      const batch = processed.slice(i, i + BATCH);
      const vals = batch.map((_, j) => {
        const b = j * 7;
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7})`;
      }).join(",");
      const flat = batch.flatMap(v => [sessionId, v.name, v.label, v.concept, v.predicate_type, v.has_moe, v.is_moe]);
      await db.query(
        `INSERT INTO db_variables (session_id, name, label, concept, predicate_type, has_moe, is_moe) VALUES ${vals}`,
        flat
      );
    }

    const conceptList = Array.from(concepts);
    const contested = ["RACE","POVERTY","CITIZENSHIP","LANGUAGE","DISABILITY","VETERAN","INCOME"];
    const hits = contested.filter(t => conceptList.some(c => c.includes(t))).length;

    const psi = Math.min(0.95, 0.55 + (moe_coverage > 50 ? 0.2 : 0));
    const rho = vintage >= 2020 ? 0.85 : vintage >= 2015 ? 0.75 : 0.65;
    const q = Math.min(0.95, 0.3 + hits * 0.08);
    const f = conceptList.some(c => c.includes("HOUSEHOLD")) ? 0.45 : 0.6;
    const tau = dataset_id.includes("acs5") ? 0.8 : 0.6;
    const lambda = Math.min(0.95, 0.3 + hits * 0.06 + (moe_coverage < 30 ? 0.2 : 0));

    const absences = [];
    if (!conceptList.some(c => c.includes("WEALTH") || c.includes("ASSET")))
      absences.push({ domain: "Economic", absence: "Wealth and asset holdings", significance: "Income is tracked but not accumulated wealth — the gap that makes inequality invisible across generations" });
    if (!conceptList.some(c => c.includes("SOCIAL NETWORK") || c.includes("COMMUNITY")))
      absences.push({ domain: "Social", absence: "Social capital and network density", significance: "Household composition is measured but not the quality or density of connections" });
    if (!conceptList.some(c => c.includes("MENTAL HEALTH") || c.includes("WELLBEING")))
      absences.push({ domain: "Health", absence: "Mental health and subjective wellbeing", significance: "Physical disability is tracked; psychological health is not" });
    if (!conceptList.some(c => c.includes("INFORMAL") || c.includes("GIG")))
      absences.push({ domain: "Economic", absence: "Informal and undocumented labor", significance: "Employment metrics exclude the informal sector — systematic blind spot for low-income populations" });
    if (!conceptList.some(c => c.includes("FOOD SECURITY")))
      absences.push({ domain: "Basic needs", absence: "Food security", significance: "Housing cost burden is tracked; hunger requires a separate survey entirely" });

    const lens_parts = [
      "Built by a federal agency whose mandate is administrative enumeration, not human flourishing.",
      "The unit of analysis is the household — assuming people live in stable, enumerable domestic units.",
    ];
    if (conceptList.some(c => c.includes("RACE")))
      lens_parts.push("Race is treated as a self-reported categorical variable — acknowledging subjectivity while enforcing discreteness on a continuous reality.");
    lens_parts.push(moe_coverage > 60
      ? `MOE fields cover ${moe_coverage}% of estimates — unusually transparent about where instruments are weakest.`
      : `Only ${moe_coverage}% of estimates carry MOE fields — uncertainty is present but not consistently acknowledged.`);
    const lens_summary = lens_parts.join(" ");

    await db.query(
      `INSERT INTO rg_profiles (session_id,psi,rho,q,f,tau,lambda,absences,moe_coverage,suppression_rate,lens_summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (session_id) DO NOTHING`,
      [sessionId, psi, rho, q, f, tau, lambda, JSON.stringify(absences), moe_coverage, 0, lens_summary]
    );

    return NextResponse.json({
      session_id: sessionId,
      name: name || `${dataset_id} ${vintage}`,
      variable_count: processed.length,
      concept_count: concepts.size,
      moe_coverage,
      geographies,
      profile: { absences, lens_summary },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[connect]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
