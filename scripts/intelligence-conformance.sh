#!/usr/bin/env bash
# Universal Intelligence Foundation — conformance quality gate.
# Enforces the architectural invariants that keep the engine universal:
#   G1  no tenant/industry/domain branching or hard-coded ids in the CORE engine
#   G2  core engine imports nothing outside ./intelligence (packs depend on core)
#   G4  the pure resolver + evaluator are deterministic (verify.ts self-test)
# Usage: bash scripts/intelligence-conformance.sh
set -uo pipefail
cd "$(dirname "$0")/.."

CORE=(
  supabase/functions/_shared/intelligence/types.ts
  supabase/functions/_shared/intelligence/profile.ts
  supabase/functions/_shared/intelligence/policy.ts
  supabase/functions/_shared/intelligence/action.ts
  supabase/functions/_shared/intelligence/learning.ts
)
fail=0
note() { printf "  [%s] %s\n" "$1" "$2"; }

echo "G1 — no hard-coded tenant/industry/domain in the core engine:"
# Banned: domain literals, industry literals, tenant-id literals, tenant-equality branches.
BANNED='serviceos|productos|hvac|electrical|plumbing|00000000-0000-0000-0000-|tenant *[=!]=|tenantId *[=!]=|industry *[=!]='
if grep -nEi "$BANNED" "${CORE[@]}" ; then
  note FAIL "core engine contains a hard-coded tenant/industry/domain or equality branch"
  fail=1
else
  note PASS "core engine is free of tenant/industry/domain literals and branches"
fi

echo "G2 — core imports nothing outside ./intelligence:"
# Every import in the core must resolve to a sibling ./intelligence module.
if grep -nE "^import .* from \"" "${CORE[@]}" | grep -vE "from \"\./[a-zA-Z_]+\.ts\"" ; then
  note FAIL "core engine imports a module outside ./intelligence"
  fail=1
else
  note PASS "core engine imports only sibling ./intelligence modules"
fi

echo "G4 — pure engine determinism + full-loop self-tests:"
for t in verify action_loop.verify ; do
  if node "supabase/functions/_shared/intelligence/$t.ts" >/tmp/uif_$t.log 2>&1 ; then
    note PASS "$t.ts — all checks passed"
  else
    note FAIL "$t.ts failed:"; sed 's/^/      /' "/tmp/uif_$t.log"
    fail=1
  fi
done

echo ""
if [ "$fail" -eq 0 ]; then echo "CONFORMANCE: PASS"; else echo "CONFORMANCE: FAIL"; fi
exit $fail
