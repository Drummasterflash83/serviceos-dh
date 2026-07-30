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
  supabase/functions/_shared/intelligence/automation_guards.ts
)
# The impure Objective Evaluation shell (NOT part of the pure core).
OBJ_WORKER=supabase/functions/_shared/worker_handlers/objective_evaluate.ts
OBJ_PURE=supabase/functions/_shared/intelligence/objective_evaluation.ts
# The impure Automation Engine shell + adapters (NOT part of the pure core).
AUTO_PURE=supabase/functions/_shared/intelligence/automation_guards.ts
AUTO_WORKER=supabase/functions/_shared/worker_handlers/automation_execute.ts
AUTO_MIGRATION=supabase/migrations/20260722120000_automation_engine.sql
CONNECTOR_FILES=$(ls supabase/functions/_shared/connectors/*.ts)
ADAPTER_IMPLS="supabase/functions/_shared/connectors/controlled_test.ts supabase/functions/_shared/connectors/internal_note.ts"
# Marketing Phase 4 (deliberate, reviewed evolution of the v1-era assumption
# "no real connector exists"): email.send_marketing is now the ONE registered
# external capability, implemented ONLY by this adapter with a full contract
# (registry row external_side_effect=true, capability contract, intent type,
# per-tenant enablement gated on a verified sender — never seeded). Gate (d)
# scans every OTHER adapter with the original ban list unchanged, and gate (j)
# holds this adapter to its own stricter contract.
MARKETING_ADAPTER="supabase/functions/_shared/connectors/marketing_email.ts"
NON_MARKETING_CONNECTOR_FILES=$(ls supabase/functions/_shared/connectors/*.ts | grep -v "/marketing_email\.ts$")
MARKETING_MIGRATION=supabase/migrations/20260901120000_marketing_sender_delivery.sql
MARKETING_MIGRATION_P5=supabase/migrations/20260902120000_marketing_broadcasts.sql
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
for t in verify action_loop.verify decision.verify modes.verify objectives.verify objective_evaluation.verify automation_guards.verify ; do
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

echo "G6 — Universal Automation Engine boundaries (executor never re-decides):"
# (a) the executor creates NO Decisions and NO business Actions (it only executes).
if grep -nE '\.from\("(decision_log|actions)"\)\.insert|from\("intelligence_objects"\)[^;]*\.insert' "$AUTO_WORKER" ; then
  note FAIL "automation_execute.ts creates a Decision/Action — it must only execute"; fail=1
else
  note PASS "executor creates no Decisions or business Actions"
fi
# (b) the executor NEVER writes Objective Health (facts flow via Outcomes only).
if grep -nE 'objective_health' "$AUTO_WORKER" ; then
  note FAIL "executor writes Objective Health directly"; fail=1
else
  note PASS "executor never writes Objective Health (Outcomes handoff only)"
fi
# (c) connector adapters do not import Decision/Mode/Policy logic and do not mutate
#     lifecycle tables or publish events (they only return sanitized results).
if grep -nE 'from "\.\./intelligence/(decision|modes|policy|authority)\.ts"|automation_intents|platform_events|\.update\(|\.insert\(' $CONNECTOR_FILES ; then
  note FAIL "a connector adapter re-decides policy, mutates lifecycle, or publishes events"; fail=1
else
  note PASS "connector adapters stay dumb (no policy/lifecycle/events)"
fi
# (d) NO unregistered dangerous connector capability. The ONLY permitted
#     external capability literal is email.send_marketing, and ONLY inside the
#     registered marketing adapter (whose own contract is gate (j)). Every
#     other adapter keeps the original v1 ban list, unchanged.
if grep -nEi 'email\.send|purchasing\.|inventory\.adjust|calendar\.create_event|service\.schedule_visit|crm\.update' $NON_MARKETING_CONNECTOR_FILES ; then
  note FAIL "a dangerous connector capability appears outside the registered marketing adapter"; fail=1
elif grep -nEi 'purchasing\.|inventory\.adjust|calendar\.create_event|service\.schedule_visit|crm\.update' "$MARKETING_ADAPTER" \
  || grep -nEi 'email\.send' "$MARKETING_ADAPTER" | grep -vi 'email\.send_marketing' ; then
  note FAIL "the marketing adapter implements a capability beyond email.send_marketing"; fail=1
else
  note PASS "no unregistered dangerous capability (email.send_marketing only, in its registered adapter)"
fi
# (e) the pre-existing schedule_engineer_visit intent stays UNSUPPORTED (enabled=false).
if grep -qE "'schedule_engineer_visit',[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*, *false\)" "$AUTO_MIGRATION" ; then
  note PASS "schedule_engineer_visit remains registered but unsupported (enabled=false)"
else
  note FAIL "schedule_engineer_visit is not pinned unsupported in the migration"; fail=1
fi
# (f) no BUSINESS-value outcome is produced (engine writes only operational outcomes;
#     no business outcome_type is seeded, so the FK makes one impossible).
if grep -nE 'outcome_layer: *"business"' "$AUTO_WORKER" || grep -nE "'[a-z_]+','business'" "$AUTO_MIGRATION" ; then
  note FAIL "a business-value outcome is produced/seeded — v1 must not claim business value"; fail=1
else
  note PASS "engine records only operational outcomes (no business-value claim)"
fi
# (g) every automation.* EVENT literal the worker emits is in the controlled registry.
A_REG="$(grep -oE '"automation\.(intent|execution|retry|outcome)\.[a-z.]+"' "$AUTO_PURE" | sort -u)"
A_EMIT="$(grep -oE '"automation\.(intent|execution|retry|outcome)\.[a-z.]+"' "$AUTO_WORKER" | sort -u)"
A_UNREG="$(comm -23 <(printf '%s\n' "$A_EMIT") <(printf '%s\n' "$A_REG"))"
if [ -n "$A_UNREG" ]; then
  note FAIL "executor emits an event outside the controlled registry: $A_UNREG"; fail=1
else
  note PASS "executor emits only controlled automation.* events"
fi
# (h) the pure guard is deterministic (no argless clock / randomness) + has the key.
if grep -nE "Date\.now\(|Math\.random\(|new Date\(\)" "$AUTO_PURE" ; then
  note FAIL "pure automation guard references a non-deterministic clock/random"; fail=1
elif ! grep -q "buildIdempotencyKey" "$AUTO_PURE" ; then
  note FAIL "deterministic idempotency key missing from the pure guard"; fail=1
else
  note PASS "pure guard is deterministic with a deterministic idempotency key"
fi
# (i) the controlled INTERNAL adapters make NO network / external calls. (The
#     registered external marketing adapter necessarily performs its single
#     provider call — held to that by gate (j), never exempted from (c).)
if grep -nE 'fetch\(|createClient\(|new WebSocket|Deno\.connect|XMLHttpRequest|https?://' $ADAPTER_IMPLS ; then
  note FAIL "a controlled adapter contains a network client / external call"; fail=1
else
  note PASS "controlled internal adapters make no network/external calls"
fi

# (j) the ONE registered external adapter honours its own stricter contract:
#     registered in the adapter registry; exactly ONE provider call; an
#     explicit unknown-freeze path; NO status-lookup claim (Gmail has none we
#     are willing to register); and the Phase-4 migration registers the full
#     capability contract with external_side_effect = true and
#     supports_status_lookup = false. Tenant enablement is function-gated
#     (marketing_sender_capability_sync) — the SQL suite proves zero seeded rows.
if ! grep -q 'marketingEmailAdapter' supabase/functions/_shared/connectors/index.ts ; then
  note FAIL "marketing adapter is not registered in the adapter registry"; fail=1
elif [ "$(grep -c 'fetch(' "$MARKETING_ADAPTER")" != "1" ] ; then
  note FAIL "marketing adapter must contain exactly ONE provider call"; fail=1
elif ! grep -q '"unknown"' "$MARKETING_ADAPTER" ; then
  note FAIL "marketing adapter lacks the unknown-freeze path"; fail=1
elif grep -q 'getStatus' "$MARKETING_ADAPTER" ; then
  note FAIL "marketing adapter claims a status lookup Gmail does not reliably provide"; fail=1
elif ! tr '\n' ' ' < "$MARKETING_MIGRATION" \
       | grep -qE "insert into automation_connector_capabilities[^;]*'email\.send_marketing'[^;]*true, *'high'" ; then
  note FAIL "email.send_marketing is not registered external_side_effect=true / risk high"; fail=1
elif ! grep -q "marketing_email_submitted" "$MARKETING_MIGRATION" ; then
  note FAIL "email.send_marketing has no registered outcome contract"; fail=1
elif ! grep -qE "'send_marketing_test_email', 'email\.send_marketing', 'high', true," "$MARKETING_MIGRATION" ; then
  note FAIL "send_marketing_test_email intent type is not registered with its capability"; fail=1
elif ! grep -qE "supportedIntentTypes: \[\"send_marketing_test_email\", \"send_marketing_broadcast_email\"\]" "$MARKETING_ADAPTER" ; then
  note FAIL "the marketing adapter must support EXACTLY the two registered marketing intent types"; fail=1
elif ! tr '\n' ' ' < "$MARKETING_MIGRATION_P5" \
       | grep -qE "\('send_marketing_broadcast_email', 'email\.send_marketing', 'high', true, *true, false, true," ; then
  # the BULK intent type must be registered external + high risk + honestly
  # no status lookup + REQUIRES APPROVAL (the tenant-senior launch approval)
  note FAIL "send_marketing_broadcast_email is not registered approval-required on email.send_marketing"; fail=1
elif ! grep -q "insert into automation_approvals" "$MARKETING_MIGRATION_P5" \
       || ! grep -q "'tenant_senior'" "$MARKETING_MIGRATION_P5" \
       || ! grep -q "marketing_require_launch_actor" "$MARKETING_MIGRATION_P5" ; then
  # broadcast approvals are REAL: an append-only tenant_senior row created only
  # under the owner/admin + canonical marketing.campaigns.launch ceiling
  note FAIL "the broadcast approval path is missing its genuine tenant-senior lineage"; fail=1
elif ! grep -q "marketing_broadcast_send_authority" "$MARKETING_ADAPTER" ; then
  note FAIL "the broadcast path must recheck the ONE canonical SQL send authority pre-provider"; fail=1
elif ! grep -q "marketing_sender_capability_sync" "$MARKETING_MIGRATION" ; then
  note FAIL "per-tenant enablement is not function-gated"; fail=1
elif grep -qE "automation_approvals" "$MARKETING_MIGRATION" && \
     grep -nE "insert into automation_approvals" "$MARKETING_MIGRATION" >/dev/null ; then
  note FAIL "the test-send path fabricates an approval row — authority must stay honest"; fail=1
else
  note PASS "marketing adapter honours the external-adapter contract (one call, unknown-freeze, no status claim, exactly the two registered marketing intents, broadcast approval-required with genuine tenant-senior lineage + pre-provider authority recheck, no fabricated approval, full registration)"
fi

echo ""
if [ "$fail" -eq 0 ]; then echo "CONFORMANCE: PASS"; else echo "CONFORMANCE: FAIL"; fi
exit $fail
