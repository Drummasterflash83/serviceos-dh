# Objective Evaluation Worker v1

The first live feedback loop. It turns append-only **measurements** into immutable
**Objective Health** snapshots so the platform can begin to measure whether OpenFolk
is actually improving the customer's business — honestly, and without ever inventing
value or bypassing the control plane.

It **operationalises** the already-proven pure evaluators in
[`objectives.ts`](../supabase/functions/_shared/intelligence/objectives.ts)
(`evaluateObjectiveHealth`, `evaluateContribution`). It invents **no** second health
algorithm, computes **no** health in SQL, builds **no** UI, executes **no** business
action, and changes **no** customer strategy.

## Reference flow

```text
Measurement inserted (app writer OR manual SQL/import)
→ objective.evaluate job enqueued (app-owned helper, or the repair scanner)
→ platform-worker claims the job and calls handleObjectiveEvaluate
→ loads objective version + metrics + definitions + constraints + dependency health + in-scope measurements
→ normalises them (pure) and derives a deterministic input hash
→ pure evaluateObjectiveHealth runs (the ONE formula site)
→ one immutable objective_health snapshot is appended (idempotent on the hash)
→ honest contribution assessment appended where verified links + before/after evidence exist
→ factual platform_events published (health.evaluated always; state-change events only on change)
→ parent objective enqueued for re-evaluation on a status change (cycle-safe)
```

The worker **evaluates and publishes facts**. Remediation, if any, re-enters through
the normal control path (see [Decision Engine boundary](#decision-engine-boundary)).

## Trigger / enqueue strategy (Option C — hybrid, scanner-first)

There is deliberately **no synchronous health computation inside the measurement
transaction** and **no database trigger**. Two complementary paths enqueue an
idempotent `objective.evaluate` job:

1. **Application-owned** —
   [`enqueueObjectiveEvaluation()`](../supabase/functions/_shared/objective_evaluation_enqueue.ts)
   is called by any code that appends a measurement/outcome (and by parent
   propagation). Clear ownership, easy correlation, no trigger coupling.
2. **Repair scanner** —
   [`objective-evaluation-scheduled-sync`](../supabase/functions/objective-evaluation-scheduled-sync/index.ts)
   runs on a cron, finds active objectives whose newest in-scope measurement is newer
   than their latest snapshot (or that have a measurement but no snapshot yet) and
   enqueues them. This is what covers **manual SQL inserts, imports and the first live
   slice**, which no application writer touches.

A database `AFTER INSERT` trigger (Option B) was rejected: job explosion, harder
testing, and tight DB coupling, for no coverage the scanner does not already give.

> **Deploy step (not wired here):** the scanner is secret-gated
> (`OBJECTIVE_EVAL_SECRET`, header `x-schedule-secret`). Register a `scheduler_cron`
> row / cron invocation to fire it, exactly like the other `*-scheduled-sync`
> functions. Until then it can be invoked on demand with the secret.

## Job type & payload

Registered in [`WORKER_HANDLERS`](../supabase/functions/_shared/worker_handlers/index.ts)
as `objective.evaluate`. Payload (narrow, replayable, no secrets):

```typescript
interface ObjectiveEvaluatePayload {
  objective_id: string;                 // must belong to the job's tenant
  triggered_by: "measurement" | "outcome" | "constraint_change"
              | "dependency_change" | "manual" | "backfill";
  measurement_ids?: string[];           // optional provenance
  outcome_ids?: string[];               // optional provenance
  correlation_id?: string;              // trace a causal chain
  evaluated_at?: string;                // ISO; the injected clock for replay
  force?: boolean;                      // append a fresh audit snapshot
  nonce?: string;                       // stabilises a forced replay identity
}
```

**Tenant identity comes from the job context, never the payload.** The objective,
its metrics, its metric definitions and its measurements must all belong to that
tenant or the job is rejected `cross_tenant_mismatch` (terminal, dead-letters).

## Idempotency model

A retry must never create a duplicate logical snapshot. Two layers guarantee it:

- **Deterministic identity** — `buildObjectiveInputHash()` hashes tenant + objective
  id + **objective version** + normalised metric spec + constraint spec + the **latest
  selected measurement ids/timestamps/values** + **dependency state** + evaluator
  version + a coarse **time bucket** (UTC day) + an optional **force nonce**. It never
  includes the raw clock.
- **Database uniqueness** — `objective_health_idem_uk` (partial unique on
  `tenant_id, objective_id, input_hash`). A concurrent double-run collapses to one row;
  the loser treats the `23505` as an idempotent success and re-emits **no** events.

Consequences:

| Change | Result |
| --- | --- |
| Same inputs, same day, retry | same hash → **no** new snapshot, **no** duplicate events |
| New measurement | new hash → **new** snapshot |
| New objective version | new hash → **new** snapshot |
| Changed constraint / dependency state | new hash → **new** snapshot |
| New day (time-aware status may drift, e.g. crossing `target_at`) | new bucket → **new** snapshot |
| `force: true` | nonce mixed into the hash → **new** audit snapshot (documented, explicit) |

The time bucket is why an objective that silently crosses its target date still gets a
fresh `missed`/`off_track` snapshot on the next cadence without any measurement change.

**UTC-day bucket — exact behaviour:**

- **Measurement-driven** evaluations enqueue **immediately** (app writer or the scanner
  noticing a newer measurement); they do not wait for a day boundary.
- **Repeated evaluation with unchanged inputs during the same UTC day is idempotent** — same
  hash → no new snapshot, no re-emitted events.
- **Time-only re-evaluation happens at most once per UTC day.** The bucket exists precisely so
  **stale / overdue / target-date** conditions can change **without a new measurement** — the
  next day yields a new hash and can capture the transition (e.g. `on_track` → `missed`).
- The repair scanner therefore enqueues a time-only re-evaluation **only when the objective has
  not been evaluated yet today** — so it does **not** create repeated logical snapshots every
  few minutes.
- The **unique input hash is the final race guard**: even if two runs enqueue within the same
  day, the `objective_health_idem_uk` index collapses them to one snapshot.

## Data loading & measurement selection

The impure handler loads and the pure module normalises. In scope for an objective:
its **primary** metric, **supporting** metrics and **constraint** metrics. For each
in-scope metric the evaluator uses the **latest** measurement; baseline and target are
kept **separate** from measurements; unlike **units** and unlike **currencies** are
never compared (→ `unknown`, never a false healthy reading); **stale** measurements are
surfaced (`stale_measurements`, `measurement_stale`) and never read as healthy; missing
data → `unknown`. Roles are respected: the primary metric drives status, a violated
**hard** constraint caps it (`constraint_violated` + blocker), and stale **supporting**
data lowers confidence. Qualitative **milestone**/binary objectives remain supported.

## Health snapshot (append-only)

Written to the existing `objective_health` table, extended additively with
`objective_version_id, evaluator_version, input_hash, triggered_by, snapshot,
job_id, correlation_id, supersedes`. The `snapshot` jsonb stores the **normalised
evaluator input + selected measurement refs** (ids/timestamps/values) for full replay —
**no raw emails, transcripts, tokens or secrets**. `supersedes` links to the previous
snapshot for lineage. Old snapshots are **never** updated (append-only triggers from
`20260720120100` cover the new columns too).

## Health vs lifecycle (status is descriptive)

A snapshot reports `unknown | on_track | at_risk | off_track | blocked | achieved |
missed`. It is **descriptive**: `achieved` does not archive the objective, `missed`
does not rewrite the target, `off_track` does not change strategy, `blocked` does not
edit anything. Health and strategic lifecycle stay distinct; publishing/superseding an
objective remains an authorised human/OpenFolk workflow (`20260720120100`).

## Event model

Published to `platform_events` (hardened envelope: `actor`, `occurred_at`, `domain`,
`correlation_id`) from the controlled `objective_event_types` registry. Storm-avoidance
is built in:

| Event | When | Subject |
| --- | --- | --- |
| `objective.health.evaluated` | every new logical snapshot | the snapshot |
| `objective.health.changed` | only on a status change | the objective |
| `objective.at_risk` / `.off_track` / `.blocked` / `.achieved` | only on transition into that status | the objective |
| `objective.measurement.stale` | only when a metric is newly stale | the objective |
| `objective.contribution.assessed` | a contribution assessment recorded | the assessment |

Events **describe**; they never execute remediation. The one-pending-per-subject unique
index de-duplicates repeats.

## Contribution boundary — confirmation is impossible in v1 (intentional)

An objective link expresses a **relationship or expectation**; it is **not** immutable
evidence that an outcome occurred. Neither is a completed Action, a succeeded Automation
Intent, or a metric that merely moved afterwards — those prove *work* or *change*, never
*causation*. Therefore:

- an **approved + verified** `objective_links` row establishes an **expected** contribution;
- `contribution_confirmed` requires an **immutable observed-outcome record** (or an explicitly
  verified external outcome-evidence reference) of a **supported** type;
- there is **no first-class Outcomes layer yet**, so the supported set
  (`SUPPORTED_OUTCOME_EVIDENCE_TYPES`) is **empty** — and confirmed attribution is therefore
  **structurally impossible in v1**.

This is enforced at a single **pure choke point**: `planContributions` derives outcomes
**only** from supported immutable evidence (none in v1) and every result passes through
`enforceContributionEvidenceBoundary`, which downgrades any would-be `contribution_confirmed`
to `inconclusive` (movement preserved for audit) unless immutable evidence backs it. The
worker never fabricates a completed outcome from a link, never calls the raw contribution
evaluator, and never writes a confirmed state (conformance G5 f–h).

v1 behaviour: no relevant link/evidence → **no assessment**; verified expected link only →
**`expected`**; a would-be confirmation without evidence → **`inconclusive`**; metric movement
without sufficient causation evidence → **`inconclusive`**. Never a claimed attributable value
just because a metric moved after an action.

Assessments are written to an **append-only** `objective_contribution_assessments` table
(idempotent by input hash) — the mutable `objective_links.contribution_state` is only a
"current" pointer, never the history.

> **Prerequisite for confirmed attribution:** a future **first-class Outcomes layer** — an
> append-only, immutable `outcomes` record (or a verified external outcome-evidence type)
> added to `SUPPORTED_OUTCOME_EVIDENCE_TYPES`. Until then, confirmation cannot occur, by
> construction. This is a deliberate integrity boundary, not a limitation to work around.

## Parent objectives

Child status changes enqueue the parent for re-evaluation (`triggered_by:
"dependency_change"`), gated on a **real** status change and bounded by an acyclic-parent
DB trigger (`objectives_no_parent_cycle`, depth-capped). Parent health is **not** a blind
average: a parent uses explicit `depends_on` links' health where configured, and otherwise
reports `unknown`/blocked honestly. No universal portfolio formula is invented.

## Repair & backfill

The scanner is the bounded repair path: tenant-scoped, resumable (idempotent enqueue),
observable via `platform_jobs`, capped per invocation (`MAX_OBJECTIVES`). It enqueues an
objective when a **measurement is newer than the last evaluation** (or there is none yet) **or**
when the objective **has not been evaluated yet today** (the at-most-daily time-drift path).
Running every few minutes is a no-op once today's snapshot exists. Backfill never overwrites
history — it only appends snapshots that did not exist. At scale, replace the
per-objective freshness probe with a single set-based SQL RPC over the existing
`(tenant, metric, measured_at)` and `(tenant, objective, evaluated_at)` indexes; the
idempotent enqueue makes that swap safe.

## Operational Modes

Modes govern autonomy; objectives govern direction — independent. Even in **Discovery**,
measurements are stored and Objective Health is evaluated (observe-only). No business
execution occurs. Proactive optimisation off the back of health changes is **out of scope
for this phase** and gated to Optimisation mode's config flag when it lands.

## Decision Engine boundary

Objective Health facts do **not** mutate or bypass Decision Packages. The worker may emit
`objective.off_track`; a later intelligence producer interprets it into an
Observation/Intelligence Object that flows through the Universal Decision Engine →
Operational Mode → Action/Review/Approval. The evaluation worker creates **no** Actions or
Automation Intents (enforced by conformance gate G5).

## Security

Job tenant must match objective tenant; metric/objective/measurement relationships must
match the tenant; cross-tenant references are rejected terminally; OpenFolk provider access
follows the existing `is_openfolk()` RLS; service-role writes are narrow; no caller-controlled
tenant id overrides the job context. Covered by the worker tenant checks and the SQL
assertions.

## Operational verification (controlled slice)

Controlled inputs (test/runbook only — **not** a published strategic claim, never seeded):

- objective `1295f92c-6204-4c08-8ba5-e29fb2097ef6`, metric `b341661b-91c1-4a9f-b735-bc1e649888a8`
- baseline `6 hours` → target `2 hours`, current measurement `4.5 hours`, direction `decrease`

Expected progress: `(6 − 4.5) / (6 − 2) = 0.375` (≈37.5%), subject to the pure evaluator's
exact time-aware model. Proven in
[`objective_evaluation.verify.ts`](../supabase/functions/_shared/intelligence/objective_evaluation.verify.ts).
Live deployment sequence: apply migration `20260721120000` → deploy the two edge functions
→ insert the measurement → invoke `objective-evaluate` (or the scanner) → confirm one
`objective_health` row with `progress = 0.375` and an `objective.health.evaluated` event.

## Future optimisation handoff

Health snapshots + events are the substrate the slow (strategic) loop consumes: an
intelligence producer reads `objective.off_track`/trend events, proposes an improvement
through the Decision Engine, and — only in Optimisation mode — the platform can act. This
worker's job ends at **honest facts**.

## Files

| File | Role |
| --- | --- |
| `supabase/migrations/20260721120000_objective_health_evaluation.sql` | additive schema: identity/lineage columns, idempotency index, contribution table, event registry, parent-cycle guard |
| `supabase/functions/_shared/intelligence/objective_evaluation.ts` | **pure** orchestration (normalise, input hash, diff, event plan) |
| `supabase/functions/_shared/intelligence/objective_evaluation.verify.ts` | node self-test |
| `supabase/functions/_shared/worker_handlers/objective_evaluate.ts` | impure handler (load → pure → append → emit → propagate) |
| `supabase/functions/_shared/objective_evaluation_enqueue.ts` | reusable idempotent enqueue helper |
| `supabase/functions/objective-evaluate/index.ts` | manual/operator edge function |
| `supabase/functions/objective-evaluation-scheduled-sync/index.ts` | repair scanner edge function |
| `supabase/tests/objective_health_evaluation.test.sql` | append-only + idempotency + parent-cycle assertions |
| `scripts/intelligence-conformance.sh` | extended with gate G5 |
