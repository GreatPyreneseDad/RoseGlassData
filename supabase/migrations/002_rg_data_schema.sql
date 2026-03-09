DROP TABLE IF EXISTS divergence CASCADE;
DROP TABLE IF EXISTS sources CASCADE;
DROP TABLE IF EXISTS analyses CASCADE;
DROP TABLE IF EXISTS entity_nodes CASCADE;
DROP TABLE IF EXISTS domain_configs CASCADE;

CREATE TABLE db_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  connector       TEXT NOT NULL DEFAULT 'census',
  dataset_id      TEXT,
  vintage         INTEGER,
  endpoint_url    TEXT,
  profiled_at     TIMESTAMPTZ,
  variable_count  INTEGER,
  concept_count   INTEGER,
  geography_depth TEXT[],
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE db_variables (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES db_sessions(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  label           TEXT,
  concept         TEXT,
  predicate_type  TEXT,
  has_moe         BOOLEAN DEFAULT FALSE,
  is_moe          BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rg_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES db_sessions(id) ON DELETE CASCADE,
  psi             NUMERIC(4,3),
  rho             NUMERIC(4,3),
  q               NUMERIC(4,3),
  f               NUMERIC(4,3),
  tau             NUMERIC(4,3),
  lambda          NUMERIC(4,3),
  absences        JSONB,
  moe_coverage    NUMERIC(5,2),
  suppression_rate NUMERIC(5,2),
  lens_summary    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id)
);

CREATE TABLE chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES db_sessions(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_db_variables_session ON db_variables(session_id);
CREATE INDEX idx_db_variables_concept ON db_variables(session_id, concept);
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, created_at);
