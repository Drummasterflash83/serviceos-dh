# Automation Engine

**Status:** Implemented and machine-verified (the pure execution guards are proven
by [automation_guards.verify.ts](../../supabase/functions/_shared/intelligence/automation_guards.verify.ts);
claim/append-only/idempotency/transition/outcome behaviour is proven by
`automation_engine.test.sql`). The schema migration
`20260722120000_automation_engine.sql` is additive; the repair-scanner cron is a
documented deploy step, not wired here. Deployment follows the state indicated in
the code.

This is **[Core Loop](../architecture/02_CORE_LOOP.md) stage 7 → 8 (Execution →
Outcome)**: the safe execution layer. It turns an **already-authorised Automation
Intent** into controlled, idempotent, auditable execution, then records the
resulting Outcome. It answers exactly one question:

> Is this exact previously-authorised intent still safe and valid to execute **now**?

It never answers *"should the business do this?"*, that was settled by the
[Decision Engine](DECISION_ENGINE.md) and is carried, immutable, in the Decision
Package. The engine **validates, claims, executes, records, reports**. It does not
reinterpret business intent, create Decisions or Actions, write Objective Health, or
let a connector re-decide policy. See the [Core Loop](../architecture/02_CORE_LOOP.md)
and the [canonical glossary](../architecture/00_GLOSSARY.md) for how these terms fit
the one lifecycle.

## Control path (unchanged boundaries)

```text
Observation → Intelligence Object → Decision Engine → Immutable Decision Package
→ Operational Mode → Action → Automation Intent → [ Automation Engine ]
→ Connector Adapter → Execution Result → Outcome → (future) Measurement → Objective Health → Learning
```

The engine sits at the bracket. Everything upstream is reused as-is; everything
downstream (measurement/objective/learning) is reached only through **immutable
Outcomes + factual events**, never by the engine writing those layers directly.

## Execution model (Option C — hybrid, scanner-first)

- **Job type** `automation.execute`, registered in `WORKER_HANDLERS`, run by the
  existing `platform-worker` (no second queue; see
  [BACKEND_RUNTIME](BACKEND_RUNTIME.md)). **One intent per job.**
- **Enqueue** — `enqueueAutomationExecution()` (app-owned: intent-created,
  approval-completed, retry) + a secret-gated **repair scanner**
  (`automation-execution-scheduled-sync`) for pending/lost intents. No DB trigger.
- **Manual/operator** — `automation-execute` edge function (tenant-authz, accepts only
  an intent id + trigger metadata; cannot alter immutable parameters, authority or mode).

### Payload
`{ automation_intent_id, triggered_by (intent_created|approval_completed|retry|repair|manual),
correlation_id?, force_guard_recheck? }`. **Tenant comes from the job context, never the
payload.** Every reference (intent, action, decision, connector) is tenant-checked; a
mismatch is terminal (`cross_tenant_mismatch`). No connector credentials or mutable
business parameters ever ride the payload — execution parameters come from the persisted
immutable intent.

## Execution-time guards (pure)

`evaluateExecutionGuards(input) → ExecutionGuardDecision` in
[`automation_guards.ts`](../../supabase/functions/_shared/intelligence/automation_guards.ts)
is pure, deterministic and **fails safe** (any missing fact blocks). It confirms
*current* validity; it never re-runs policy. Outcomes:
`EXECUTION_ALLOWED | WAIT | APPROVAL_REQUIRED | BLOCKED | EXPIRED | ALREADY_COMPLETED`,
each with controlled reason codes (`automation_reason_codes`). It checks, in order:
idempotency/prior-success → tenant integrity → lifecycle state → expiry → action exists →
intent type enabled → decision authorised & not superseded → policy/config versions valid →
authority valid → **approval** (present, unexpired, **approver-kind matches** — customer
approval can never be satisfied by OpenFolk) → **Operational Mode re-check** → connector
eligibility/health → dependencies → retry budget.

**The mode re-check reuses the same pure `resolveOperationalMode` the Decision Engine
used**, against the *current* profile — so a tenant demoted from `trusted` to `discovery`
after authorisation is blocked at execution time, without touching the Decision Package.

## Lifecycle, claiming & leasing

States (data-driven `automation_intent_states`, extended with **`unknown`**):
`pending → claimed → approved → executing → succeeded | failed | unknown`, with
`failed → executing` (retry), `executing → unknown` (result lost), `claimed → pending`
(release an abandoned pre-execution claim), and `pending/failed → expired`. A new
**transition-enforcement trigger** rejects any illegal move (none existed before); the
pure `isLegalTransition` mirrors it.

Claiming and the durable attempt are **one transaction**: the `automation_claim_and_start`
RPC locks the intent (`FOR UPDATE`), validates state + lease + retry budget, transitions
`pending|failed → executing`, increments `attempts` exactly once, and inserts the immutable
**in-flight** execution attempt — atomically. So two concurrent workers can never both
claim (the loser sees `executing` and gets nothing), a failed attempt insert rolls back the
claim (the intent is never left leased without a durable attempt), and **connector execution
begins only after the in-flight attempt exists**. An expired lease is recovered by the
scanner: a stuck `executing` → `unknown` (never blindly re-executed), a stuck `claimed` →
`pending`.

## Idempotency & unknown results

`buildIdempotencyKey()` is a deterministic hash of tenant + intent + action + decision +
connector + capability + operation + **immutable parameters** + execution version — **never
`now()`**. A `succeeded` execution attempt is unique per key (`aea_idem_success_uk`), so a
retry after success returns `ALREADY_COMPLETED`. The idempotency key is persisted on the
intent at claim time (before the external call); the immutable attempt row is written after.

An **unknown** external result (lost response / thrown adapter) **freezes automatic
retry** — the intent parks in `unknown`, the terminal attempt records
`external_result_unknown`, and the repair scanner **excludes** it from normal execution.
Reconciliation is explicit (`planUnknownResolution`): if the connector supports status
lookup and an external reference exists, a status-check resolves it via `getStatus` and
**appends** a superseding attempt (and outcome, if now succeeded); otherwise it **routes to
the correct human review owner**. Resolution never rewrites history and never double-records
an outcome. This is the exactly-once-where-possible / at-least-once-safely contract.

## Execution attempts & outcomes (immutable)

Every attempt is an append-only `automation_execution_attempts` row (idempotency key,
attempt number, worker, sanitized request/response, external reference, classification,
retry state, lineage). Append-only triggers reject any update/delete. **No secrets** are
persisted (a key-name filter drops token/secret/credential fields).

On success the engine appends an immutable **Outcome** (`outcomes`, append-only +
`supersedes` lineage) with explicit **provenance**: outcome layer + type, **source kind**
(`automation_execution`) + **source record id**, execution-attempt / action / intent ids,
evidence refs, confidence, observed_at, correlation id, and a **verification state** from a
controlled registry (`system_observed | externally_verified | human_verified |
inferred_unverified | rejected`). Three layers stay distinct: **execution result** vs
**operational outcome** vs **business outcome**. The controlled adapters produce only
`system_observed` **operational** outcomes (`controlled_execution_recorded` /
`internal_note_recorded`), deduped one-per-intent. **No business outcome type is registered
in v1**, so the `outcome_type` FK makes a business-value claim structurally impossible; and a
DB trigger additionally requires any business outcome to be `externally_verified` /
`human_verified`. This append-only Outcomes layer **exists now** and is the **same
`outcomes` layer** the [Objectives & Outcomes engine](OBJECTIVES_AND_OUTCOMES.md)
reads to measure whether a decision moved an objective (Core Loop stage 8 → 9). It is
the foundation the Objective Worker's contribution boundary will eventually consume, and
it **does not loosen** that boundary now.

**Authorised intent parameters are immutable.** Once an intent leaves `pending`, a DB
trigger freezes its business fields in place (`action_object_id, intent_type, parameters,
connector_id, capability_key, decision_id, schema_version, execution_version,
idempotency_key`); only lifecycle/lease/result fields change, through legal transitions.
Changing a business parameter requires a **new** intent — so the idempotency key and trust
can never be moved under a running execution.

## Connector adapters

One universal contract (`AutomationConnectorAdapter`: `validate` / `execute` /
optional `getStatus`) returning a sanitized `ConnectorExecutionResult`
(`succeeded | failed_transient | failed_permanent | unknown`). Adapters receive
credentials via secure server-side context (never the payload), and **never** decide
approval/authority/mode, create Decisions/Actions, mutate lifecycle tables, or publish
events (conformance G6). The registry holds three **safe, side-effect-free internal**
adapters — `controlled_test` (`record_controlled_execution`), `internal`
(`record_internal_note`) and `email_reply_draft` (prepares, never transmits) — plus,
since Marketing Phase 4, the **first and only registered EXTERNAL adapter**:
`marketing_email` (`connectors/marketing_email.ts`, connector `google-gmail`, intent
type `send_marketing_test_email`, capability `email.send_marketing`,
`external_side_effect = true`, risk `high`). The TEST intent type registers
`requires_approval = false` — honestly: a bounded test email to a tenant user is an
explicitly authorised, DELEGATED action under canonical `marketing.campaigns.test`,
and **no `automation_approvals` row is created or fabricated** (an Operations
requester is not a tenant senior). The approval guard itself is untouched: any future
bulk/broadcast intent type or approval-requiring Decision Package still demands a
matching approval. The adapter executes exactly the claimed immutable envelope —
the provider message is built from the FROZEN envelope content only (editing a
sender after the request can never change what is sent) — resolves Gmail OAuth /
Workspace-DWD credentials server-side, re-validates tenant/actor-authority (via the
canonical marketing permission resolver)/sender readiness (via the canonical SQL
derivation)/capability/recipient at execution time **failing closed** — a database or
resolver read error is a safe retryable pre-provider failure, never conflated with a
genuine denial and never proceeded past on partial authority data — performs **no
writes**, and
classifies conservatively (429 → transient; uncertain 5xx / lost response → **unknown**,
frozen for review — Gmail offers no send idempotency key, so no automatic resend is ever
safe; `supports_status_lookup` is honestly `false`). Its per-tenant enablement is never
seeded — `marketing_sender_capability_sync` flips it only while a verified, enabled
sender exists. Conformance gate (d) was deliberately evolved for this: every other
adapter keeps the original dangerous-capability ban, and gate (j) holds the marketing
adapter to its own stricter contract. `schedule_engineer_visit` stays **registered but
disabled** — unsupported and unexecutable until a real connector + policy are
explicitly configured.

## Approval

Execution approval is an append-only `automation_approvals` record (approver kind ∈
`openfolk | tenant_senior | customer | external`, authority basis, decision, expiry,
evidence, optional `review_task_id`). The required approver kind is derived from the
Decision Package routing; the guard enforces both presence and **kind match**, so
customer-owned approval cannot be supplied by OpenFolk.

## Retries

Transient failures schedule a **bounded** retry (`retry_at`, exponential backoff) while
budget remains; at budget → stop (`retry_limit_reached`). Permanent failures never retry.
`WAIT` (dependency/lease/connector-health) does **not** consume an attempt. Unknown results
are reconciled, never blind-retried.

## Repair scanner

`automation-execution-scheduled-sync` (secret `AUTOMATION_EXEC_SECRET`): reclaims expired
leases, expires overdue intents, and enqueues eligible pending / within-budget failed
intents — bounded, idempotent, observable, no execution inside the scanner. **Cron is a
documented deploy step, not wired here.**

## Events

Controlled `automation_event_types`, hardened envelope (actor/occurred_at/domain/
correlation_id): `automation.intent.claimed`, `automation.execution.started|succeeded|
failed|unknown|blocked|waiting`, `automation.intent.expired`, `automation.retry.scheduled`,
`automation.outcome.recorded`. Events describe; they never execute remediation.

## Objective / measurement handoff

The engine emits Outcomes + events. It **never fabricates measurements or writes Objective
Health**. A future measurement/evidence producer translates verified outcomes into
measurements → `objective.evaluate` → Objective Health → contribution. Compensation/rollback
is out of scope for v1 but the attempt/outcome records (external reference, reversibility)
make a future compensation worker possible.

## Learning handoff

Execution facts (unsupported connector, missing permission, revoked policy, schema
mismatch, repeated approval, consistent success/correction) are recorded as facts for a
future learning workflow (Execution fact → Observation → Decision → Correction/Proposal →
versioned Improvement). The engine records; it never mutates policy or learning.

## First controlled vertical slice

`Controlled Observation → Decision Package (AUTOMATION_AUTHORISED) → Operational Mode
permits → Action → Automation Intent (record_controlled_execution) → automation.execute →
controlled_test adapter → immutable attempt → intent succeeded → operational Outcome
(controlled_execution_recorded) → factual events`. No external side effect; deterministic
idempotency; a retry produces no duplicate execution or Outcome; `schedule_engineer_visit`
untouched. Prove ServiceOS-shaped and ProductOS-shaped intents both run through the same
core using configuration only.

## Security

Job tenant = intent tenant = action tenant = decision tenant = connector tenant; cross-tenant
references rejected; secrets only server-side; sanitized request/response persistence; manual
endpoint enforces roles; service-role writes are narrow; the caller cannot modify execution
payload, authority or mode; no universal financial authority default; customer-owned
authority stays customer-owned.

## Future real-connector onboarding

Register the capability in `automation_connector_capabilities`, add an adapter file + one
registry line, enable it per tenant in `tenant_connector_capabilities`, register/enable the
intent type, and (for risky operations) require approval + appropriate mode. The universal
executor never changes.

## Files

| File | Role |
| --- | --- |
| `supabase/migrations/20260722120000_automation_engine.sql` | additive schema: registries, execution/guard/approval/outcome tables, intent columns, states/transitions + enforcement trigger |
| `supabase/functions/_shared/intelligence/automation_guards.ts` (+ `.verify.ts`) | **pure** guard evaluator, idempotency key, retry/result classification, transition legality |
| `supabase/functions/_shared/connectors/` | adapter contract + registry + `controlled_test` + `internal_note` + `email_reply_draft` + `marketing_email` (the registered external Gmail Marketing adapter) |
| `supabase/migrations/20260901120000_marketing_sender_delivery.sql` | Marketing Phase 4 registration: `email.send_marketing` capability (external, high risk) + contract + the TEST-ONLY `send_marketing_test_email` intent type + function-gated, trigger-refreshed per-tenant enablement |
| `supabase/functions/_shared/worker_handlers/automation_execute.ts` | impure executor (guard → claim → execute → attempt → outcome → events) |
| `supabase/functions/_shared/automation_execution_enqueue.ts` | reusable idempotent enqueue helper |
| `supabase/functions/automation-execute/` | manual/operator edge function |
| `supabase/functions/automation-execution-scheduled-sync/` | repair scanner edge function |
| `supabase/tests/automation_engine.test.sql` | claim / append-only / idempotency / transition / outcome assertions |
| `scripts/intelligence-conformance.sh` | extended with gate G6 |
