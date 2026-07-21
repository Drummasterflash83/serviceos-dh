#!/usr/bin/env bash
# ServiceOS — Provider onboarding LOCAL verification battery.
#
# Runs every provider-connection proof against the LOCAL Supabase stack (real supabase_vault).
# Prereqs (one-time): local stack up, migrations applied, grants aligned, functions served:
#   npx --no-install supabase migration up --local
#   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres < scripts/dev/align-local-grants.sql
#   npx --no-install supabase functions serve --no-verify-jwt   # in another shell
#
# Usage:  bash scripts/provider-onboarding-verify.sh
set -uo pipefail
cd "$(dirname "$0")/.."

# Local Supabase creds (service role bypasses RLS; anon proves denial paths).
eval "$(npx --no-install supabase status --output json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.stdout.write('export SUPABASE_URL='+j.API_URL+'\nexport SUPABASE_SERVICE_ROLE_KEY='+j.SERVICE_ROLE_KEY+'\nexport SUPABASE_ANON_KEY='+j.ANON_KEY+'\n')})")"

pass=0; fail=0
run() { # <label> <cmd...>
  local label="$1"; shift
  if "$@" >/tmp/verify_out.$$ 2>&1; then
    echo "PASS  $label"; pass=$((pass+1))
  else
    echo "FAIL  $label"; fail=$((fail+1)); tail -5 /tmp/verify_out.$$ | sed 's/^/      /'
  fi
}

echo "── pure module + contract tests ─────────────────────────────"
run "adapter contract"        node supabase/functions/_shared/telephony/adapter.verify.ts
run "discovery suggestions"   node supabase/functions/_shared/telephony/discovery.verify.ts

echo "── Vault broker (real supabase_vault) ───────────────────────"
run "broker SQL properties"   bash -c "out=\$(docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/provider_secret_broker.test.sql 2>&1); echo \"\$out\" | grep -q 'ALL PROVIDER-SECRET-BROKER TESTS PASSED'"
run "oauth-state cleanup"     bash -c "out=\$(docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/provider_oauth_state_cleanup.test.sql 2>&1); echo \"\$out\" | grep -q 'OAUTH-STATE CLEANUP: ALL PASSED'"
run "vault probe (Data API)"  node scripts/provider-vault-probe.test.mjs
run "credential broker"       node scripts/provider-credential-broker.test.mjs

echo "── HTTP boundary (deployed-locally functions) ───────────────"
run "onboarding HTTP security" node scripts/provider-onboarding-http.test.mjs
run "oauth framework"          node scripts/provider-oauth-state.test.mjs
run "drummond existing-conn"   node scripts/drummond-existing-connection.test.mjs

echo "── canonical inventory / isolation / regression ─────────────"
run "inventory idempotency+isolation" node scripts/telephony-onboarding.test.mjs
run "queue collision"          node scripts/queue-collision.test.mjs
run "migration order"          node scripts/check-migration-order.mjs
run "product alignment"        node scripts/product-alignment.test.mjs

echo "─────────────────────────────────────────────────────────────"
echo "TOTAL: $pass passed, $fail failed"
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
