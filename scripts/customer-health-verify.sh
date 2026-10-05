#!/usr/bin/env bash
# ServiceOS — Customer Health (callback shadow) LOCAL verification battery.
#
# Proves the Track A shadow slice against the LOCAL Supabase stack. Prereqs (one-time):
#   npx --no-install supabase migration up --local   # applies 20260820120000 + 20260820120100
#
# Usage:  bash scripts/customer-health-verify.sh
set -uo pipefail
cd "$(dirname "$0")/.."

# Local Supabase creds (service role bypasses RLS; the SQL proof exercises RLS directly).
eval "$(npx --no-install supabase status --output json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.stdout.write('export SUPABASE_URL='+j.API_URL+'\nexport SUPABASE_SERVICE_ROLE_KEY='+j.SERVICE_ROLE_KEY+'\nexport SUPABASE_ANON_KEY='+j.ANON_KEY+'\n')})")"

pass=0; fail=0
run() { # <label> <cmd...>
  local label="$1"; shift
  if "$@" >/tmp/ch_verify_out.$$ 2>&1; then
    echo "PASS  $label"; pass=$((pass+1))
  else
    echo "FAIL  $label"; fail=$((fail+1)); tail -6 /tmp/ch_verify_out.$$ | sed 's/^/      /'
  fi
}

# ── LOCAL-ONLY hosted-parity grants for PRE-HEALTH tables. ──────────────────
# Hosted Supabase grants PostgREST roles via default privileges; a fresh local
# `db reset` recreates older tables WITHOUT them (older migrations predate the
# explicit-grant convention started in 20260811120000). This shim restores parity so
# the DB suites run deterministically after a reset. health_% tables are EXCLUDED on
# purpose: their grants must come from migration 20260820120000 itself, so this
# script still proves them.
docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -q -c "
do \$\$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' and tablename not like 'health\_%'
  loop
    execute format('grant select, insert, update, delete on %I to service_role', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end \$\$;
grant usage on schema public to service_role, authenticated;
grant usage, select on all sequences in schema public to service_role;" >/dev/null 2>&1 || true

echo "── pure engines (deterministic, no DB) ──────────────────────"
run "excerpt redaction"          node supabase/functions/_shared/health/redact.verify.ts
run "callback classifier"        node supabase/functions/_shared/health/classifier.verify.ts
run "ownership resolver"         node supabase/functions/_shared/health/ownership.verify.ts
run "health evaluator + subject" node supabase/functions/_shared/health/evaluator.verify.ts
run "shadow pipeline + safety"   node supabase/functions/_shared/health/pipeline.verify.ts

echo "── evaluation set + gate (precision/recall/dup/owner/leak) ───"
run "evaluation gate"            node supabase/functions/_shared/health/evaluation.verify.ts

echo "── SQL invariants (identity / append-only / RLS / isolation) ─"
run "customer_health SQL proof"  bash -c "out=\$(docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/customer_health.test.sql 2>&1); echo \"\$out\" | grep -q 'CUSTOMER-HEALTH: ALL PASSED'"

echo "── store/review/pipeline integration (real local DB) ────────"
run "shadow integration + safety" node scripts/customer-health-shadow.test.ts

echo "─────────────────────────────────────────────────────────────"
echo "PASS=$pass  FAIL=$fail"
[ "$fail" -eq 0 ]
