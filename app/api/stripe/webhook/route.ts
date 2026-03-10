// app/api/stripe/webhook/route.ts
// Handles: checkout.session.completed, customer.subscription.updated, .deleted
// Verifies Stripe signature (no stripe npm required — manual HMAC).
// Idempotent via stripe_events table.

import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";

export const runtime = "nodejs";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;

const PLAN_TOKENS: Record<string, number> = {
  pro:        -1,   // unlimited
  enterprise: -1,
  trial:   10000,
};

async function verifySignature(body: string, sig: string, secret: string): Promise<boolean> {
  const { createHmac } = await import("crypto");
  const parts = Object.fromEntries(sig.split(",").map(p => p.split("=")));
  const { t, v1 } = parts;
  if (!t || !v1) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return expected === v1;
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature") || "";

  if (!await verifySignature(body, sig, WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: { id: string; type: string; data: { object: Record<string, unknown> } };
  try { event = JSON.parse(body); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const db = getDB();

  // Idempotency check
  const existing = await db.query(
    `SELECT id FROM stripe_events WHERE stripe_event_id = $1`, [event.id]
  );
  if (existing.rows.length > 0) {
    return NextResponse.json({ received: true, status: "already_processed" });
  }

  const obj = event.data.object;
  const customerId = (obj.customer as string) || null;
  const subscriptionId = (obj.id as string) || (obj.subscription as string) || null;

  try {
    await db.query("BEGIN");

    if (event.type === "checkout.session.completed") {
      // Checkout complete — link customer ID, upgrade plan
      const customerEmail = (obj.customer_email as string) || null;
      const plan = (obj.metadata as Record<string, string>)?.plan || "pro";
      const tokens = PLAN_TOKENS[plan] ?? -1;

      if (customerId && customerEmail) {
        await db.query(
          `UPDATE api_keys
           SET stripe_customer_id = $1,
               plan = $2,
               tokens_remaining = $3,
               subscription_status = 'active'
           WHERE email = $4`,
          [customerId, plan, tokens, customerEmail.toLowerCase()]
        );
      }
    }

    if (event.type === "customer.subscription.updated") {
      const status = obj.status as string;
      const plan = (obj.metadata as Record<string, string>)?.plan || "pro";
      const tokens = status === "active" ? (PLAN_TOKENS[plan] ?? -1) : 10000;

      await db.query(
        `UPDATE api_keys
         SET subscription_status = $1,
             stripe_subscription_id = $2,
             plan = CASE WHEN $1 = 'active' THEN $3 ELSE 'trial' END,
             tokens_remaining = $4
         WHERE stripe_customer_id = $5`,
        [status, subscriptionId, plan, tokens, customerId]
      );
    }

    if (event.type === "customer.subscription.deleted") {
      await db.query(
        `UPDATE api_keys
         SET subscription_status = 'canceled',
             plan = 'trial',
             tokens_remaining = 10000,
             stripe_subscription_id = NULL
         WHERE stripe_customer_id = $1`,
        [customerId]
      );
    }

    // Log event (idempotency record)
    await db.query(
      `INSERT INTO stripe_events (stripe_event_id, event_type, customer_id, subscription_id, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [event.id, event.type, customerId, subscriptionId, JSON.stringify(event)]
    );

    await db.query("COMMIT");
    return NextResponse.json({ received: true });

  } catch (err) {
    await db.query("ROLLBACK");
    console.error("[stripe-webhook]", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
