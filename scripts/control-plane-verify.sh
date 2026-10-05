#!/usr/bin/env bash
# ServiceOS — OpenFolk Control Plane LOCAL verification battery.
#
# Prereq (one-time): npx --no-install supabase migration up --local  (or db reset)
# Usage: bash scripts/control-plane-verify.sh
set -uo pipefail
cd "$(dirname "$0")/.."

eval "$(npx --no-install supabase status --output json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.stdout.write('export SUPABASE_URL='+j.API_URL+'\nexport SUPABASE_SERVICE_ROLE_KEY='+j.SERVICE_ROLE_KEY+'\n')})")"

# LOCAL-ONLY hosted-parity grants for PRE-EXISTING tables. Hosted Supabase grants
# PostgREST roles via default privileges; a fresh local `db reset` recreates older tables
# WITHOUT them. This shim restores parity so the integration test's service-role setup
# inserts work. controlplane_/endpoint_/member_/communication_ tables keep the grants from
# their OWN migration (20260821120000) — the SQL proof exercises those independently.
docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -q -c "
do \$\$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public'
           and tablename not like 'health\_%'
           and tablename not in ('platform_authority_grants','member_integration_identities','communication_endpoints','endpoint_ownership_assignments','responsibility_handoffs','controlplane_change_log')
  loop
    execute format('grant select, insert, update, delete on %I to service_role', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end \$\$;
grant usage, select on all sequences in schema public to service_role;" >/dev/null 2>&1 || true

pass=0; fail=0
run() { local label="$1"; shift
  if "$@" >/tmp/cp_verify.$$ 2>&1; then echo "PASS  $label"; pass=$((pass+1));
  else echo "FAIL  $label"; fail=$((fail+1)); tail -8 /tmp/cp_verify.$$ | sed 's/^/      /'; fi
}

echo "── pure engines (deterministic, no DB) ──────────────────────"
run "platform authz decision"    node supabase/functions/_shared/controlplane/authz.verify.ts
run "ownership resolver"         node supabase/functions/_shared/controlplane/resolver.verify.ts

echo "── SQL invariants (authority / RLS / isolation / append-only) ─"
run "control_plane SQL proof"    bash -c "out=\$(docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/control_plane.test.sql 2>&1); echo \"\$out\" | grep -q 'CONTROL-PLANE: ALL PASSED'"

echo "── store / RPC / discovery integration (real local DB) ──────"
run "control plane integration"  node scripts/control-plane.test.ts

echo "── §5 final proof — 11-step end-to-end demonstration ────────"
run "control plane demo (11 steps)" node scripts/control-plane-demo.test.ts

echo "─────────────────────────────────────────────────────────────"
echo "PASS=$pass  FAIL=$fail"
[ "$fail" -eq 0 ]
