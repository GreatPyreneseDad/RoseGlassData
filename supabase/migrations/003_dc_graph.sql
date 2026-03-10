// Supabase migration — add dc_graph column to rg_profiles
// Run: supabase db push OR execute directly in Supabase SQL editor

ALTER TABLE rg_profiles ADD COLUMN IF NOT EXISTS dc_graph JSONB;

COMMENT ON COLUMN rg_profiles.dc_graph IS 
'Coherence graph: 6 dimensional agents score each column, 7th agent annotates nodes. Derivative of Coherence.';
