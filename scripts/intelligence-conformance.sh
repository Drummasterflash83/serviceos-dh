#!/usr/bin/env bash
# Universal Intelligence Foundation — conformance quality gate.
# Enforces the architectural invariants that keep the engine universal:
#   G1  no tenant/industry/domain branching or hard-coded ids in the CORE engine
#   G2  core engine imports nothing outside ./intelligence (packs depend on core)
#   G3  the pure core has no DB / client / event / automation side-effect imports
#   G4  the pure engines are deterministic (node self-tests)
# Usage: bash scripts/intelligence-conformance.sh
set -uo pipefail
cd "$(dirname "$0")/.."

CORE=(
  supabase/functions/_shared/intelligence/types.ts
  supabase/functions/_shared/intelligence/profile.ts
  supabase/functions/_shared/intelligence/policy.ts
  supabase/functions/_shared/intelligence/action.ts
  supabase/functions/_shared/intelligence/learning.ts
  supabase/functions/_shared/intelligence/reason_codes.ts
  supabase/functions/_shared/intelligence/authority.ts
  supabase/functions/_shared/intelligence/decision.ts
)
fail=0
note() { printf "  [%s] %s\n" "$1" "$2"; }

echo "G1 — no hard-coded tenant/industry/domain in the core engine:"
BANNED='serviceos|productos|hvac|electrical|plumbing|00000000-0000-0000-0000-|tenant *[=!]=|tenantId *[=!]=|industry *[=!]='
if grep -nEi "$BANNED" "${CORE[@]}" ; then
  note FAIL "core engine contains a hard-coded tenant/industry/domain or equality branch"; fail=1
else
  note PASS "core engine is free of tenant/industry/domain literals and branches"
fi

echo "G2 — core imports nothing outside ./intelligence:"
if grep -nE "^import .* from \"" "${CORE[@]}" | grep -vE "from \"\./[a-zA-Z_]+\.ts\"" ; then
  note FAIL "core engine imports a module outside ./intelligence"; fail=1
else
  note PASS "core engine imports only sibling ./intelligence modules"
fi

echo "G3 — pure core has no DB/client/event/automation side effects:"
IMPURE='@supabase|createClient|SupabaseClient|supabaseAdmin|publishEvent|fetch\(|Deno\.serve|\.insert\(|\.upsert\(|automation_intents'
if grep -nE "$IMPURE" "${CORE[@]}" ; then
  note FAIL "pure core references a database/client/event/execution primitive"; fail=1
else
  note PASS "pure core is free of DB/client/event/execution primitives"
fi

echo "G4 — pure engine determinism self-tests:"
for t in verify action_loop.verify decision.verify ; do
  if node "supabase/functions/_shared/intelligence/$t.ts" >/tmp/uif_$t.log 2>&1 ; then
    note PASS "$t.ts — all checks passed"
  else
    note FAIL "$t.ts failed:"; sed 's/^/      /' "/tmp/uif_$t.log"; fail=1
  fi
done

echo ""
if [ "$fail" -eq 0 ]; then echo "CONFORMANCE: PASS"; else echo "CONFORMANCE: FAIL"; fi
exit $fail
