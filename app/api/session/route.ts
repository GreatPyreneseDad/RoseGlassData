import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { checkAuth, withTokenHeaders } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await checkAuth(request, "chat");
    if (auth instanceof NextResponse) return auth;

    const sessionId = request.nextUrl.searchParams.get("session_id");
    if (!sessionId) return NextResponse.json({ error: "session_id required" }, { status: 400 });

    const db = getDB();
    const res = await db.query(
      `SELECT s.id, s.name, s.dataset_id, s.vintage, s.variable_count,
              s.concept_count, s.profiled_at, s.connector, s.endpoint_url,
              p.moe_coverage, p.absences, p.lens_summary, p.semantic_profile,
              p.psi, p.rho, p.q, p.f, p.tau, p.lambda
       FROM db_sessions s
       LEFT JOIN rg_profiles p ON p.session_id = s.id
       WHERE s.id = $1 AND (s.api_key_id = $2 OR s.api_key_id IS NULL)`,
      [sessionId, auth.api_key_id]
    );

    if (res.rows.length === 0)
      return NextResponse.json({ error: "Session not found" }, { status: 404 });

    const session = res.rows[0];
    let semanticProfile = null;
    if (session.semantic_profile) {
      try {
        semanticProfile = typeof session.semantic_profile === "string"
          ? JSON.parse(session.semantic_profile) : session.semantic_profile;
      } catch { /* ignore */ }
    }

    let absences = [];
    if (session.absences) {
      try {
        absences = typeof session.absences === "string"
          ? JSON.parse(session.absences) : session.absences;
      } catch { /* ignore */ }
    }

    const responseData = {
      session_id: session.id,
      name: session.name,
      variable_count: session.variable_count,
      concept_count: session.concept_count,
      moe_coverage: session.moe_coverage || 0,
      geographies: [],
      connector: session.connector,
      profile: {
        absences,
        lens_summary: session.lens_summary || "",
      },
      semantic_profile: semanticProfile,
      tokens_remaining: auth.tokens_remaining,
    };

    const response = NextResponse.json(responseData);
    return withTokenHeaders(response, auth);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
