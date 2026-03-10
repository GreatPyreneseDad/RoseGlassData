import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { Pool } from "pg";

export const runtime = "nodejs";
export const maxDuration = 60;

// Infer Rose Glass concept from Postgres column info
function inferConcept(tableName: string, colName: string, dataType: string): string {
  const n = (tableName + " " + colName).toLowerCase();
  if (/age|dob|birth|born/.test(n)) return "AGE AND SEX";
  if (/income|revenue|salary|wage|earn|pay/.test(n)) return "INCOME";
  if (/race|ethnicity|hispanic|latino/.test(n)) return "RACE AND ETHNICITY";
  if (/employ|job|occupation|work/.test(n)) return "EMPLOYMENT STATUS";
  if (/educat|school|degree|grad/.test(n)) return "EDUCATIONAL ATTAINMENT";
  if (/house|home|rent|mortgage|property/.test(n)) return "HOUSING";
  if (/health|medical|hospital|insurance|diagnosis|icd/.test(n)) return "HEALTH AND DISABILITY";
  if (/family|household|spouse|married|child|parent/.test(n)) return "HOUSEHOLD AND FAMILY";
  if (/poverty|snap|welfare|benefit/.test(n)) return "POVERTY AND ASSISTANCE";
  if (/language|english|citizen|visa|immigrant/.test(n)) return "LANGUAGE AND CITIZENSHIP";
  if (/veteran|military/.test(n)) return "VETERAN STATUS";
  if (/crime|arrest|conviction|incarcerat|prison|jail/.test(n)) return "CRIMINAL JUSTICE";
  if (/mental|anxiety|depression|substance|drug|alcohol|recovery|sober/.test(n)) return "MENTAL HEALTH AND SUBSTANCE USE";
  if (/score|rating|grade|index|assessment|outcome/.test(n)) return "ASSESSMENT AND SCORING";
  if (/note|comment|narrative|text|reason|description/.test(n)) return "QUALITATIVE";
  if (/gender|sex/.test(n)) return "AGE AND SEX";
  if (/status|type|category|class|tier/.test(n)) return "CLASSIFICATION";
  if (/date|time|timestamp|created|updated|at$/.test(n) || dataType.includes("timestamp") || dataType.includes("date")) return "TEMPORAL";
  if (/id$|_id$|key|uuid/.test(n)) return "IDENTIFIER";
  if (/address|city|state|zip|county|geo|lat|lon/.test(n)) return "GEOGRAPHY";
  return `TABLE:${tableName.toUpperCase()}`;
}

export async function POST(request: NextRequest) {
  let userPool: Pool | null = null;
  try {
    const { connection_string, name } = await request.json();
    if (!connection_string) return NextResponse.json({ error: "connection_string required" }, { status: 400 });

    // Validate it looks like a postgres URL
    if (!connection_string.startsWith("postgres://") && !connection_string.startsWith("postgresql://"))
      return NextResponse.json({ error: "Must be a PostgreSQL connection string (postgres://...)" }, { status: 400 });

    // Connect to user's DB
    userPool = new Pool({ connectionString: connection_string, connectionTimeoutMillis: 10_000, max: 1 });
    const client = await userPool.connect();

    // Introspect schema
    const schemaRes = await client.query(`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `);
    client.release();

    if (schemaRes.rows.length === 0)
      return NextResponse.json({ error: "No tables found in public schema" }, { status: 400 });

    // Build variable manifest
    const tables = new Map<string, typeof schemaRes.rows>();
    for (const row of schemaRes.rows) {
      if (!tables.has(row.table_name)) tables.set(row.table_name, []);
      tables.get(row.table_name)!.push(row);
    }

    const concepts = new Set<string>();
    const processed: Array<{
      name: string; label: string; concept: string;
      predicate_type: string; has_moe: boolean; is_moe: boolean;
    }> = [];

    for (const [tableName, cols] of tables) {
      for (const col of cols) {
        const varName = `${tableName}.${col.column_name}`;
        const concept = inferConcept(tableName, col.column_name, col.data_type);
        concepts.add(concept);
        processed.push({
          name: varName,
          label: `${col.column_name.replace(/_/g, " ")} (${tableName})`,
          concept,
          predicate_type: col.data_type,
          has_moe: false,
          is_moe: false,
        });
      }
    }

    const conceptList = Array.from(concepts);
    const tableNames = Array.from(tables.keys());

    // Rose Glass scoring
    const contested = ["RACE AND ETHNICITY","POVERTY AND ASSISTANCE","CRIMINAL JUSTICE",
      "MENTAL HEALTH AND SUBSTANCE USE","INCOME","EMPLOYMENT STATUS"];
    const hits = contested.filter(t => conceptList.includes(t)).length;
    const psi = 0.75;
    const rho = 0.7;
    const q = Math.min(0.95, 0.25 + hits * 0.1);
    const f = conceptList.includes("HOUSEHOLD AND FAMILY") ? 0.45 : 0.6;
    const tau = conceptList.includes("TEMPORAL") ? 0.72 : 0.45;
    const lambda = Math.min(0.9, 0.3 + hits * 0.07);
    const moe_coverage = 0;

    // Absences
    const absences: Array<{ domain: string; absence: string; significance: string }> = [];
    if (conceptList.includes("INCOME") && !conceptList.includes("HOUSING"))
      absences.push({ domain: "Economic", absence: "Housing cost burden", significance: "Income tracked without housing cost — economic pressure invisible" });
    if (conceptList.includes("HEALTH AND DISABILITY") && !conceptList.includes("MENTAL HEALTH AND SUBSTANCE USE"))
      absences.push({ domain: "Health", absence: "Mental health dimensions", significance: "Physical health tracked; psychological health absent — common in clinical systems built around billing codes" });
    if (!conceptList.includes("QUALITATIVE"))
      absences.push({ domain: "Voice", absence: "Narrative and free-text data", significance: "No column captures what a person would say in their own words" });
    if (!conceptList.includes("TEMPORAL"))
      absences.push({ domain: "Time", absence: "Temporal dimension", significance: "No timestamps detected — change over time is invisible" });

    // Lens summary
    const lens_summary = `A relational database with ${tableNames.length} table${tableNames.length > 1 ? "s" : ""} (${tableNames.join(", ")}). ${hits > 2 ? "The schema tracks contested social categories — built by someone who needed to see who people are, not just what they do." : "The schema is primarily operational — tracking transactions and states rather than people."} ${conceptList.includes("ASSESSMENT AND SCORING") ? "Scoring variables suggest an evaluative frame: people are measured against standards." : ""} Connection string used in-flight only — no credentials stored.`;

    const db = getDB();
    const sessionRes = await db.query(
      `INSERT INTO db_sessions (name, connector, dataset_id, vintage, endpoint_url, profiled_at, variable_count, concept_count, geography_depth)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8) RETURNING id`,
      [name || `PostgreSQL: ${tableNames.slice(0,3).join(", ")}`, "postgres",
       tableNames.join(","), new Date().getFullYear(),
       `postgres:${tableNames.join(",")}`, processed.length, conceptList.length, []]
    );
    const sessionId = sessionRes.rows[0].id;

    const BATCH = 200;
    for (let i = 0; i < processed.length; i += BATCH) {
      const batch = processed.slice(i, i + BATCH);
      const vals = batch.map((_, j) => { const b = j*7; return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7})`; }).join(",");
      const flat = batch.flatMap(v => [sessionId, v.name, v.label, v.concept, v.predicate_type, v.has_moe, v.is_moe]);
      await db.query(`INSERT INTO db_variables (session_id, name, label, concept, predicate_type, has_moe, is_moe) VALUES ${vals}`, flat);
    }

    await db.query(
      `INSERT INTO rg_profiles (session_id,psi,rho,q,f,tau,lambda,absences,moe_coverage,suppression_rate,lens_summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (session_id) DO NOTHING`,
      [sessionId, psi, rho, q, f, tau, lambda, JSON.stringify(absences), moe_coverage, 0, lens_summary]
    );

    return NextResponse.json({
      session_id: sessionId,
      name: name || `PostgreSQL: ${tableNames.slice(0,3).join(", ")}`,
      variable_count: processed.length,
      concept_count: conceptList.length,
      moe_coverage: 0,
      geographies: [],
      tables: tableNames,
      profile: { absences, lens_summary },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[db-connect]", message);
    if (message.includes("ECONNREFUSED") || message.includes("timeout"))
      return NextResponse.json({ error: "Could not connect to database. Check the connection string and ensure the host is reachable." }, { status: 502 });
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (userPool) await userPool.end().catch(() => {});
  }
}
