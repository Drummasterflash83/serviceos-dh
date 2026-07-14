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
  supabase/functions/_shared/intelligence/modes.ts
  supabase/functions/_shared/intelligence/objectives.ts
  supabase/functions/_shared/intelligence/objective_evaluation.ts
)
# The impure Objective Evaluation shell (NOT part of the pure core).
OBJ_WORKER=supabase/functions/_shared/worker_handlers/objective_evaluate.ts
OBJ_PURE=supabase/functions/_shared/intelligence/objective_evaluation.ts
fail=0
note() { printf "  [%s] %s\n" "$1" "$2"; }

echo "G1 — no hard-coded tenant/industry/domain in the core engine:"
# Bans hardcoded tenant/industry BRANCHING (compared to a string LITERAL) and any
# hardcoded tenant uuid — but allows variable-to-variable comparisons such as a
# legitimate same-tenant security guard (obj.tenantId !== tenantId).
BANNED="serviceos|productos|hvac|electrical|plumbing|00000000-0000-0000-0000-|tenant *[=!]=+ *[\"']|tenantId *[=!]=+ *[\"']|industry *[=!]=+ *[\"']"
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
for t in verify action_loop.verify decision.verify modes.verify objectives.verify objective_evaluation.verify ; do
  if node "supabase/functions/_shared/intelligence/$t.ts" >/tmp/uif_$t.log 2>&1 ; then
    note PASS "$t.ts — all checks passed"
  else
    note FAIL "$t.ts failed:"; sed 's/^/      /' "/tmp/uif_$t.log"; fail=1
  fi
done

echo "G5 — Objective Evaluation worker boundaries (impure shell stays a shell):"
# (a) the health formula lives ONLY in the pure evaluator — the worker must not
#     re-derive progress/status (these tokens exist only in objectives.ts).
# Signature tokens of the pure progress/deterioration computation. They never
# appear as column names (baseline_value/target_value are DB columns, not these).
if grep -nE "clamp01|deteriorating|let achieved|progress = |\(baseline|baseline -|- baseline" "$OBJ_WORKER" ; then
  note FAIL "objective_evaluate.ts appears to duplicate the Objective Health formula"; fail=1
else
  note PASS "worker duplicates no Objective Health formula (delegates to the pure evaluator)"
fi
# (b) health evaluation NEVER creates Actions / Automation Intents / executes.
if grep -nE '\.from\("(actions|automation_intents|automation_intent_transitions)"\)|executeAction|automation_intents' "$OBJ_WORKER" ; then
  note FAIL "worker creates Actions/Automation Intents — health must stay a fact"; fail=1
else
  note PASS "worker creates no Actions/Automation Intents (Decision-Engine boundary intact)"
fi
# (c) the worker orchestrates through the pure module (no bespoke evaluation path).
if grep -qE 'from "\.\./intelligence/objective_evaluation\.ts"' "$OBJ_WORKER" ; then
  note PASS "worker orchestrates via the pure objective_evaluation module"
else
  note FAIL "worker does not import the pure objective_evaluation orchestrator"; fail=1
fi
# (d) the pure orchestrator is deterministic — no wall clock / randomness inside it
#     (an injected `now` string is fine; argless new Date()/Date.now()/random is not).
if grep -nE "Date\.now\(|Math\.random\(|new Date\(\)" "$OBJ_PURE" ; then
  note FAIL "pure objective_evaluation references a non-deterministic clock/random"; fail=1
else
  note PASS "pure objective_evaluation is deterministic (injected clock only)"
fi
# (e) every objective.* EVENT literal the worker emits is in the controlled registry.
REGISTRY="$(grep -oE '"objective\.(health\.[a-z]+|at_risk|off_track|blocked|achieved|measurement\.stale|contribution\.assessed)"' "$OBJ_PURE" | sort -u)"
EMITTED="$(grep -oE '"objective\.(health\.[a-z]+|at_risk|off_track|blocked|achieved|measurement\.stale|contribution\.assessed)"' "$OBJ_WORKER" | sort -u)"
UNREG="$(comm -23 <(printf '%s\n' "$EMITTED") <(printf '%s\n' "$REGISTRY"))"
if [ -n "$UNREG" ]; then
  note FAIL "worker emits an event outside the controlled registry: $UNREG"; fail=1
else
  note PASS "worker emits only controlled objective.* events"
fi
# (f) contribution attribution flows through the pure evidence boundary — the worker
#     must NOT call the raw evaluateContribution directly (that bypasses the guard).
if grep -qE 'planContributions' "$OBJ_WORKER" && ! grep -qE 'evaluateContribution' "$OBJ_WORKER" ; then
  note PASS "worker attributes contribution only via the guarded planContributions"
else
  note FAIL "worker must use planContributions (never raw evaluateContribution)"; fail=1
fi
# (g) no confirmed-contribution path without immutable outcome evidence: the worker
#     never hardcodes the confirmed literal (it persists only the guarded state).
if grep -nE 'contribution_confirmed' "$OBJ_WORKER" ; then
  note FAIL "worker references contribution_confirmed directly — confirmation must come only from the guard"; fail=1
else
  note PASS "worker never hardcodes contribution_confirmed"
fi
# (h) v1 integrity: the supported immutable outcome-evidence set is EMPTY, so the
#     pure boundary makes confirmed attribution impossible until an Outcomes layer lands.
if grep -qE 'SUPPORTED_OUTCOME_EVIDENCE_TYPES: *readonly string\[\] *= *\[\]' "$OBJ_PURE" \
   && grep -qE 'enforceContributionEvidenceBoundary' "$OBJ_PURE" ; then
  note PASS "confirmed contribution is impossible in v1 (empty supported-evidence set + boundary)"
else
  note FAIL "v1 contribution boundary missing or supported-evidence set is non-empty"; fail=1
fi

echo ""
if [ "$fail" -eq 0 ]; then echo "CONFORMANCE: PASS"; else echo "CONFORMANCE: FAIL"; fi
exit $fail
