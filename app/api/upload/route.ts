import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { profileCSV } from "@/lib/csv-profiler";

export const runtime = "nodejs";
export const maxDuration = 60;

// Minimal CSV parser — handles quoted fields, newlines in quotes
function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuote && text[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === "\n" && !inQuote) {
      lines.push(cur); cur = "";
    } else if (ch === "\r" && !inQuote) {
      // skip
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);

  function splitRow(line: string): string[] {
    const fields: string[] = [];
    let field = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { field += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        fields.push(field.trim()); field = "";
      } else {
        field += ch;
      }
    }
    fields.push(field.trim());
    return fields;
  }

  const nonEmpty = lines.filter(l => l.trim());
  if (nonEmpty.length < 2) throw new Error("CSV must have a header row and at least one data row");

  const headers = splitRow(nonEmpty[0]).map(h => h.replace(/^"|"$/g, "").trim());
  const rows = nonEmpty.slice(1).map(splitRow);
  return { headers, rows };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "csv") return NextResponse.json({ error: "Only CSV files supported currently" }, { status: 400 });

    const MAX_MB = 4;
    if (file.size > MAX_MB * 1024 * 1024)
      return NextResponse.json({ error: `File too large. Max ${MAX_MB}MB.` }, { status: 400 });

    const text = await file.text();
    const { headers, rows } = parseCSV(text);

    if (headers.length === 0) return NextResponse.json({ error: "No columns detected" }, { status: 400 });
    if (rows.length === 0) return NextResponse.json({ error: "No data rows detected" }, { status: 400 });

    const profile = profileCSV(file.name, headers, rows);

    const db = getDB();

    // Store session
    const sessionRes = await db.query(
      `INSERT INTO db_sessions (name, connector, dataset_id, vintage, endpoint_url, profiled_at, variable_count, concept_count, geography_depth)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8) RETURNING id`,
      [profile.name, "csv", file.name, new Date().getFullYear(),
       `upload:${file.name}`, profile.variable_count, profile.concept_count, []]
    );
    const sessionId = sessionRes.rows[0].id;

    // Store columns as variables
    const BATCH = 200;
    for (let i = 0; i < profile.columns.length; i += BATCH) {
      const batch = profile.columns.slice(i, i + BATCH);
      const vals = batch.map((_, j) => {
        const b = j * 7;
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7})`;
      }).join(",");
      const flat = batch.flatMap(c =>
        [sessionId, c.name, c.label, c.concept, c.predicate_type, c.has_moe, c.is_moe]
      );
      await db.query(
        `INSERT INTO db_variables (session_id, name, label, concept, predicate_type, has_moe, is_moe) VALUES ${vals}`,
        flat
      );
    }

    // Store Rose Glass profile + sample data for chat grounding
    const sampleRows = rows.slice(0, 200);
    const sampleJson = JSON.stringify({ headers, rows: sampleRows });

    await db.query(
      `INSERT INTO rg_profiles (session_id,psi,rho,q,f,tau,lambda,absences,moe_coverage,suppression_rate,lens_summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (session_id) DO NOTHING`,
      [sessionId, profile.psi, profile.rho, profile.q, profile.f, profile.tau, profile.lambda,
       JSON.stringify(profile.absences), profile.moe_coverage, 0, profile.lens_summary]
    );

    // Store sample data for chat queries
    await db.query(
      `UPDATE db_sessions SET endpoint_url = $1 WHERE id = $2`,
      [`csv_data:${sampleJson.slice(0, 100000)}`, sessionId]
    );

    return NextResponse.json({
      session_id: sessionId,
      name: profile.name,
      variable_count: profile.variable_count,
      concept_count: profile.concept_count,
      row_count: profile.row_count,
      moe_coverage: 0,
      geographies: [],
      profile: { absences: profile.absences, lens_summary: profile.lens_summary },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[upload]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
