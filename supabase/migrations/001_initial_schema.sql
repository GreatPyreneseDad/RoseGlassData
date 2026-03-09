-- RoseGlassData Initial Schema Migration
-- Run in Supabase SQL Editor after project creation.

CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TABLE domain_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    entity_label    TEXT NOT NULL,
    domain_question TEXT NOT NULL,
    connector       TEXT NOT NULL DEFAULT 'csv',
    search_context  TEXT,
    deployment_tier TEXT NOT NULL DEFAULT 'commercial'
                    CHECK (deployment_tier IN ('commercial', 'government', 'classified')),
    source_types    JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE entity_nodes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_id       UUID NOT NULL REFERENCES domain_configs(id) ON DELETE CASCADE,
    label           TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    parent_id       UUID REFERENCES entity_nodes(id) ON DELETE SET NULL,
    depth_level     INTEGER NOT NULL DEFAULT 0,
    path            ltree,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX entity_nodes_path_idx ON entity_nodes USING GIST (path);
CREATE INDEX entity_nodes_domain_idx ON entity_nodes (domain_id);
CREATE INDEX entity_nodes_parent_idx ON entity_nodes (parent_id);
CREATE INDEX entity_nodes_depth_idx ON entity_nodes (depth_level);

CREATE TABLE analyses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_node_id  UUID NOT NULL REFERENCES entity_nodes(id) ON DELETE CASCADE,
    domain_id       UUID NOT NULL REFERENCES domain_configs(id) ON DELETE CASCADE,
    date            DATE NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity_node_id, date)
);

CREATE INDEX analyses_entity_node_idx ON analyses (entity_node_id);
CREATE INDEX analyses_domain_idx ON analyses (domain_id);
CREATE INDEX analyses_date_idx ON analyses (date);

CREATE TABLE sources (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id         UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    source_name         TEXT,
    source_type         TEXT,
    calibration         TEXT,
    url                 TEXT,
    article_text        TEXT,
    psi                 FLOAT,
    rho                 FLOAT,
    q                   FLOAT,
    f                   FLOAT,
    tau                 FLOAT,
    lambda_val          FLOAT,
    coherence           FLOAT,
    veritas_score       FLOAT,
    veritas_assessment  TEXT,
    poem                TEXT,
    cultural_lens       TEXT,
    poem_generated_at   TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX sources_analysis_idx ON sources (analysis_id);

CREATE TABLE divergence (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id     UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    dimension       TEXT,
    mean_val        FLOAT,
    std_dev         FLOAT,
    variance        FLOAT
);

CREATE INDEX divergence_analysis_idx ON divergence (analysis_id);

CREATE VIEW lambda_by_depth AS
SELECT
    a.domain_id,
    a.date,
    n.depth_level,
    n.entity_type,
    AVG(s.lambda_val)    AS avg_lambda,
    STDDEV(s.lambda_val) AS stddev_lambda,
    COUNT(s.id)          AS source_count
FROM sources s
JOIN analyses a ON a.id = s.analysis_id
JOIN entity_nodes n ON n.id = a.entity_node_id
GROUP BY a.domain_id, a.date, n.depth_level, n.entity_type;
