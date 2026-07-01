#!/usr/bin/env bash
# ============================================================================
# Copy PROD public-schema DATA into STAGING, then scrub PII + reset logins.
#
#   • READ-ONLY on prod (pg_dump only — never writes to prod).
#   • DESTRUCTIVE on staging (truncates every public table, then loads prod data).
#   • No credentials are hardcoded — pass the two Supabase DIRECT connection URIs
#     via env vars. Use the "Direct connection" URI (port 5432), NOT the pooler.
#   • Requires pg_dump & psql whose version >= the Supabase server (PG15+),
#     or swap the dump line for `supabase db dump`.
#
# Usage:
#   export PROD_DB_URL='postgresql://postgres:...@db.<prod-ref>.supabase.co:5432/postgres'
#   export STAGING_DB_URL='postgresql://postgres:...@db.<staging-ref>.supabase.co:5432/postgres'
#   ./refresh-staging.sh
# ============================================================================
set -euo pipefail

: "${PROD_DB_URL:?set PROD_DB_URL to the PROD Supabase direct connection URI}"
: "${STAGING_DB_URL:?set STAGING_DB_URL to the STAGING Supabase direct connection URI}"

# Guardrail: never allow prod to be the target of the destructive steps.
if [ "$PROD_DB_URL" = "$STAGING_DB_URL" ]; then
  echo "ABORT: PROD_DB_URL and STAGING_DB_URL are identical."; exit 1
fi

DUMP="prod-data-$(date +%Y%m%d-%H%M%S).sql"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "1/4  Dumping prod public-schema DATA -> $DUMP   (read-only on prod)"
pg_dump "$PROD_DB_URL" \
  --data-only --schema=public \
  --no-owner --no-privileges \
  --disable-triggers \
  -f "$DUMP"

echo "2/4  Truncating staging public tables"
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('TRUNCATE TABLE public.%I CASCADE', r.tablename);
  END LOOP;
END $$;
SQL

echo "3/4  Loading prod data into staging"
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f "$DUMP"

echo "4/4  Scrubbing PII + resetting logins on staging"
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f "$HERE/scrub-staging.sql"

echo
echo "DONE. Staging mirrors prod (scrubbed)."
echo "All staging logins now use password: staging123"
echo
echo "REMINDER: confirm staging's Railway env points WhatsApp/Twilio/AI keys at"
echo "sandbox/test values so staging can never message real customers."
