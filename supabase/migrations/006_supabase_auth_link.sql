-- Migration 006: Link Supabase Auth users to api_keys + Stripe columns
-- Run AFTER 005_auth.sql in Supabase SQL editor

-- Add Supabase Auth user_id to api_keys
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'none';

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_stripe_customer ON api_keys(stripe_customer_id);

-- Stripe subscription event log (idempotency)
CREATE TABLE IF NOT EXISTS stripe_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type      TEXT NOT NULL,
  customer_id     TEXT,
  subscription_id TEXT,
  payload         JSONB,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_customer ON stripe_events(customer_id);

COMMENT ON COLUMN api_keys.user_id IS 'Links to auth.users. NULL = API-only key pre-auth.';
COMMENT ON COLUMN api_keys.stripe_customer_id IS 'Stripe customer ID.';
COMMENT ON COLUMN api_keys.subscription_status IS 'none | active | canceled | past_due';
COMMENT ON TABLE stripe_events IS 'Idempotency log. One row per processed Stripe event.';
