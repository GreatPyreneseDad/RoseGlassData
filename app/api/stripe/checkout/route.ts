// app/api/stripe/checkout/route.ts
// Creates a Stripe Checkout session for plan upgrades.
// POST { email, plan } → { checkout_url }
// No stripe npm — uses Stripe REST API directly.

import { NextRequest, NextResponse } from "next/server";

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY!;
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://rose-glass-data.vercel.app";

// Price IDs — set in Stripe dashboard, reference here
const PRICE_IDS: Record<string, string> = {
  pro:        process.env.STRIPE_PRICE_PRO || "",
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE || "",
};

export async function POST(request: NextRequest) {
  try {
    const { email, plan = "pro" } = await request.json();

    if (!email || !email.includes("@"))
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });

    const priceId = PRICE_IDS[plan];
    if (!priceId)
      return NextResponse.json({ error: `Unknown plan: ${plan}` }, { status: 400 });

    const params = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      customer_email: email,
      "metadata[plan]": plan,
      success_url: `${BASE_URL}/dashboard?upgrade=success`,
      cancel_url:  `${BASE_URL}/dashboard?upgrade=canceled`,
    });

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await res.json();
    if (!res.ok) {
      console.error("[stripe-checkout]", session);
      return NextResponse.json({ error: session.error?.message || "Stripe error" }, { status: 502 });
    }

    return NextResponse.json({ checkout_url: session.url });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[stripe-checkout]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
