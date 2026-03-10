-- Migration 005: API key auth + token metering
-- Run in Supabase SQL editor

CREATE TABLE api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key             TEXT NOT NULL UNIQUE,
  email           TEXT NOT NULL,
  plan            TEXT NOT NULL DEFAULT 'trial',  -- trial | pro | enterprise
  tokens_remaining INTEGER NOT NULL DEFAULT 10000,
  tokens_used     INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ
);

-- Link sessions to api keys (nullable — existing sessions have no key)
ALTER TABLE db_sessions ADD COLUMN IF NOT EXISTS api_key_id UUID REFERENCES api_keys(id);

-- Token cost log — audit trail, useful for debugging and billing disputes
CREATE TABLE token_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id      UUID NOT NULL REFERENCES api_keys(id),
  operation       TEXT NOT NULL,  -- 'upload' | 'chat' | 'connect' | 'db_connect'
  tokens_charged  INTEGER NOT NULL,
  session_id      UUID REFERENCES db_sessions(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_key ON api_keys(key);
CREATE INDEX idx_token_ledger_key ON token_ledger(api_key_id, created_at);

COMMENT ON TABLE api_keys IS 'API key registry. trial=10000 tokens free, pro=unlimited via Stripe.';
COMMENT ON TABLE token_ledger IS 'Immutable token deduction log. One row per API operation.';
COMMENT ON COLUMN api_keys.tokens_remaining IS '-1 = unlimited (pro/enterprise plan)';
