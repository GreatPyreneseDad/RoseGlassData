#!/bin/bash
# Rose Glass News — Migrate local Postgres → Supabase
#
# Usage:
#   export SUPABASE_DB_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"
#   bash supabase/migrate.sh

set -e

LOCAL_DB="postgresql://localhost/rose_glass_news"
REMOTE_DB="${SUPABASE_DB_URL}"

if [ -z "$REMOTE_DB" ]; then
  echo "Error: SUPABASE_DB_URL not set"
  echo "Export it first: export SUPABASE_DB_URL='postgresql://postgres:...'"
  exit 1
fi

echo "Rose Glass News — Migration"
echo "From: $LOCAL_DB"
echo "To:   ${REMOTE_DB:0:50}..."
echo ""

# 1. Dump data only (schema already created via SQL editor)
echo "[1/3] Dumping local data..."
pg_dump "$LOCAL_DB" \
  --data-only \
  --no-owner \
  --no-privileges \
  --disable-triggers \
  --table=analyses \
  --table=sources \
  --table=divergence \
  -f /tmp/rose_glass_dump.sql

echo "      Dump complete: $(wc -l < /tmp/rose_glass_dump.sql) lines"

# 2. Fix sequences and UUIDs for Supabase compatibility
echo "[2/3] Patching dump for Supabase..."
# Remove SET statements that Supabase doesn't allow
sed -i '' \
  -e '/^SET /d' \
  -e '/^SELECT pg_catalog/d' \
  /tmp/rose_glass_dump.sql

echo "      Patch complete"

# 3. Load into Supabase
echo "[3/3] Loading into Supabase..."
psql "$REMOTE_DB" \
  --single-transaction \
  --quiet \
  -f /tmp/rose_glass_dump.sql

echo ""
echo "Migration complete. Verifying..."
psql "$REMOTE_DB" -c "
SELECT 'analyses' as table, COUNT(*) as rows FROM analyses
UNION ALL SELECT 'sources', COUNT(*) FROM sources
UNION ALL SELECT 'divergence', COUNT(*) FROM divergence;"
