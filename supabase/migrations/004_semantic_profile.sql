-- Migration 004: rename dc_graph to semantic_profile, reflect industry-standard column metadata
-- Run in Supabase SQL editor or via: supabase db push

ALTER TABLE rg_profiles 
  RENAME COLUMN dc_graph TO semantic_profile;

COMMENT ON COLUMN rg_profiles.semantic_profile IS 
'Industry-standard semantic column metadata: grain, dataset class, semantic types, collection methods, null semantics, cardinality, referential dependencies, proxy risk, lineage notes, analytical scope, use limitations.';
