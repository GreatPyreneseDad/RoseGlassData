-- Rose Glass News — Supabase Schema
-- Run this in Supabase SQL editor first

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT NOT NULL,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS analyses_topic_date_unique
  ON analyses (UPPER(topic), date);

CREATE TABLE IF NOT EXISTS sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE,
  source_name TEXT,
  source_type TEXT,
  calibration TEXT,
  url TEXT,
  article_text TEXT,
  psi FLOAT, rho FLOAT, q FLOAT, f FLOAT, tau FLOAT, lambda_val FLOAT,
  coherence FLOAT,
  veritas_score FLOAT,
  veritas_assessment TEXT,
  poem TEXT,
  cultural_lens TEXT,
  poem_generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sources_analysis_id_idx ON sources(analysis_id);
CREATE INDEX IF NOT EXISTS sources_poem_idx ON sources(poem) WHERE poem IS NOT NULL;
CREATE INDEX IF NOT EXISTS sources_cultural_lens_idx ON sources(cultural_lens);

CREATE TABLE IF NOT EXISTS divergence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE,
  dimension TEXT,
  mean_val FLOAT,
  std_dev FLOAT,
  variance FLOAT
);

CREATE INDEX IF NOT EXISTS divergence_analysis_id_idx ON divergence(analysis_id);
