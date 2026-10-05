# Objectives & Outcomes Engine

**Status:** Implemented and machine-verified. The pure evaluators, the worker
orchestration, the schema and the conformance gate (G5) all pass their self-tests
and SQL assertions. The remote environment runs an older slice, so treat the
migrations `20260720120000`, `20260720120100` and `20260721120000` and the two
edge functions as **built and reviewed but not yet applied to the live deployment**.
Nothing strategic is seeded for any real tenant, by design.

This is the **top layer of the intelligence stack**. The other engines answer
"what is happening", "what should happen" and "how much autonomy may be exercised";
this one answers the question everything else must be able to trace back to:

> **What is the business trying to achieve, and did our decisions and actions move
> it closer?**

Without objectives the platform optimises for its own busyness: activity,
automation volume, task completion, speed, usage. Everything except the thing the
customer actually cares about. Objectives keep the whole engine pointed at
[the customer's stated direction](../foundation/OPENFOLK_CONTINUOUS_OPTIMISATION.md),
and they are where the Core Loop's **Outcome → Learning** stages land: an Outcome is
measured against the objective it claimed to serve, and the resulting Objective
Health delta is the Learning signal the slow strategic loop consumes. See
[02_CORE_LOOP](../architecture/02_CORE_LOOP.md) and the canonical terms in
[00_GLOSSARY](../architecture/00_GLOSSARY.md).

The engine has two halves, told here as one story:

1. **The definition + evaluation model** (objectives, metrics, measurements,
   constraints, links, health, contribution) — the pure, deterministic core.
2. **The live feedback loop** (the `objective.evaluate` worker) that operationalises
   that core, turning appended measurements into immutable health snapshots on a
   cadence. This is not a future extension. It is implemented and is the engine's
   running heartbeat.

Code: [`objectives.ts`](../../supabase/functions/_shared/intelligence/objectives.ts)
(the pure evaluators) and
[`objective_evaluation.ts`](../../supabase/functions/_shared/intelligence/objective_evaluation.ts)
(the pure worker orchestration).

---

## 1. Objectives *and Outcomes*, one system

An objective is meaningless without measurement, so this is deliberately one
coherent system, not separate systems for North Stars, OKRs, KPIs, projects,
benefits or value tracking. Objectives *define* direction; Measurements *observe*
reality; the pure evaluators *derive* Health and Contribution. OKRs (or any
methodology) are one configurable shape within this model, never the model itself.

Four clean seams keep it honest: **definition ≠ measurement ≠ evaluation ≠
attribution**. Objectives define, measurements observe, `evaluateObjectiveHealth`
derives health, `evaluateContribution` attributes cause, and none of the four is
allowed to fabricate the others.

### The core principle

Every meaningful observation, decision, action, automation intent, outcome and
recommendation should be able to answer: *which business objective does this
support, and how?* **We do not fabricate links.** When a reliable link exists it is
explicit, measurable and auditable; when it does not, the honest answer is "none",
and routine operational work is never blocked for lack of one.

---

## 2. Architecture: hybrid, and why

Objectives are strategic, long-lived, human-owned and versioned, a different
altitude from operational sensing and work. So they do **not** live as an
`intelligence_objects.object_type`. They get **dedicated high-integrity tables** and
**project into the Business Graph** as `Objective` and `Metric` node types for
relationship traversal. Operational relationships travel through a universal
`objective_links` table.

- **Objectives vs Actions.** Actions are operational work, executed and short-lived.
  Objectives are strategic intent, measured over time and never "executed". Actions
  *link to* objectives; they are not a kind of objective.
- **Metrics are first-class**, not JSON buried in an objective. A reusable
  `metric_definitions` table plus a `measurements` time-series lets metrics be typed,
  sourced, freshness-aware and shared across objectives.
- **Graph vs links.** Objective and metric *entities* relate through the graph;
  relationships to operational objects (decisions, actions, outcomes) go through
  `objective_links` with a controlled relation registry.
- **The Decision Engine stays deterministic** (see §9). Objective linkage is
  resolved *before* entry and carried as descriptive `objectiveContext`; the engine
  never queries objectives and never becomes goal-seeking.
- **One core, both domains.** Types, metrics and capabilities are data; the pure
  engine holds no domain literals, enforced by the conformance gate. ServiceOS and
  ProductOS run the identical evaluator; only configuration differs.

### Objective hierarchy

```
strategic_direction → north_star → annual_objective → quarterly_priority →
initiative / project → operational_target → metrics → actions / automations
```

No tenant is forced to use every level. A small business may run
`north_star → current priority → actions`. Parent/child, supporting, conflicting and
dependency relationships, weights, time horizons, ownership, status and review
cadence are all data, not code. An interim priority never overwrites the enduring
North Star; they coexist through `parent_objective_id` and effective periods.

---

## 3. The tables

All tenant-scoped, RLS-protected (tenant read plus `is_openfolk()` provider read),
additive and idempotent. Migration
[`20260720120000_objectives.sql`](../../supabase/migrations/20260720120000_objectives.sql),
hardening in `20260720120100`, worker schema in
[`20260721120000_objective_health_evaluation.sql`](../../supabase/migrations/20260721120000_objective_health_evaluation.sql).

| Table | What it holds |
|---|---|
| `objectives` | Dedicated, versioned, hierarchical objectives. `objective_type` and `status` from controlled registries, an owner, a hierarchy via `parent_objective_id`, a `source`, `stale_after_hours`, a `version_id` into `config_versions`, and a `supersedes` self-reference for lineage. |
| `metric_definitions` | Reusable metric catalogue: `key`, `unit`, `currency`, `direction`, `source_system`, `calculation_method`, `update_cadence`, `owner`. Unique per `(tenant, key)`. |
| `measurements` | The time-series: typed, sourced, freshness-aware, evidence-carrying snapshots (`value`, `unit`, `currency`, `window_start/end`, `measured_at`, `confidence`, `freshness`, `evidence`, `milestone_reached`). Indexed `(tenant, metric, measured_at desc)`. |
| `objective_metrics` | The target *spec*: objective ↔ metric with `role` (`primary` \| `supporting` \| `constraint`), `direction`, baseline, target, range and `weight`. Multiple metrics per objective without burying measurement in JSON. |
| `objective_constraints` | Per-objective constraints of `kind` `hard` \| `soft` \| `guardrail`, with an optional metric, direction, threshold and `authority_required`. |
| `objective_links` | The universal link from an objective to an `intelligence_object`, `decision`, `action`, `automation_intent`, `outcome`, `graph_node`, `capability`, `policy`, `initiative` or `metric`, via the controlled relation registry (`supports, contributes_to, blocks, risks, conflicts_with, depends_on, measures, caused_by, supersedes`). Records expected vs actual contribution, confidence, rationale, evidence, creator and approval. Never an arbitrary string. |
| `objective_health` | **Append-only** health snapshots (the pure evaluator's output over time). Extended additively by the worker with `objective_version_id, evaluator_version, input_hash, triggered_by, snapshot, job_id, correlation_id, supersedes`. |
| `objective_contribution_assessments` | **Append-only** honest-attribution history. The immutable record `evaluateContribution` produces, so a claim is never silently overwritten; `objective_links.contribution_state` is only the mutable "current" pointer. |

Controlled registries (FK-enforced, extended by INSERT not by code) back
`objective_types`, `objective_statuses`, `objective_health_statuses`,
`metric_directions`, `objective_link_relations`, `contribution_states`,
`objective_reason_codes` and the worker's `objective_event_types`.

### Constraints cap, they do not merely warn

An action is not beneficial simply because it moves one metric while breaching an
agreed constraint. A violated **hard** constraint caps Objective Health at
`off_track` (surfaced as `constraint_violated` plus a blocker on the constraint
key); a violated soft/guardrail constraint caps at `at_risk`. The cap can only ever
make health *worse*, never better.

---

## 4. Objective Health (pure)

`evaluateObjectiveHealth(objective, measurements, now) → ObjectiveHealth` is pure,
deterministic, replayable and domain-agnostic. Given the same objective,
measurements and injected `now`, it always returns the same reading. It holds no DB,
no events, no clock (the clock is injected) and no domain literals.

Status set (canonical, do not extend without a migration to
`objective_health_statuses`):

```
unknown | on_track | at_risk | off_track | blocked | achieved | missed
```

The reading also carries `progress` (0..1 or null), `confidence`, machine-readable
`reasons` (from the `OBJECTIVE_HEALTH_REASON_CODES` registry), `blockers` and
`staleMeasurements`.

The evaluation order, precisely (from `objectives.ts`):

1. **Dependency block.** If any `depends_on` dependency is `blocked`, `off_track` or
   `missed`, the objective is `blocked` (reason `dependency_blocked`), confidence 0.5.
2. **Primary measurement present + fresh.** No primary metric or no measurement →
   `unknown` (`measurement_missing`). Older than `stale_after_hours` (default 168h /
   7 days) → `unknown` (`measurement_stale`). **Stale or missing data never reads as
   healthy.**
3. **Qualitative milestone/binary.** `milestone_reached === true` → `achieved`;
   otherwise `on_track`, or `missed` if past `target_at`.
4. **Numeric guards.** Unlike **units** are never compared → `unknown`
   (`unit_mismatch`). For currency-typed metrics, unlike **currencies** → `unknown`
   (`currency_mismatch`). No false reading is ever emitted from an invalid comparison.
5. **Direction → progress.** `increase`, `decrease`, `maintain`, `range` and
   `threshold` each compute `achieved`, `deteriorating` and a clamped `progress`.
6. **Constraint cap.** As in §3.
7. **Time-aware status.** `achieved` if the target is met; `missed` if past
   `target_at`; `off_track` if deteriorating below baseline, or if `progress` lags the
   elapsed time window by more than 0.15; `at_risk` if it lags at all; else `on_track`.
   Stale supporting data lowers confidence.

This one formula lives in exactly one place. The worker calls it through the thin
`evaluateNormalized` shim and never re-implements it, never computes health in SQL.

---

## 5. The live feedback loop: the `objective.evaluate` worker

This is the engine's operational heartbeat, and it is **implemented, not a future
extension**. It turns append-only measurements into immutable Objective Health
snapshots so the platform can begin to measure, honestly, whether OpenFolk is moving
the customer's business. It invents no second health algorithm, computes no health in
SQL, builds no UI, executes no business action and changes no customer strategy.

### Reference flow

```
Measurement inserted (app writer OR manual SQL / import)
→ objective.evaluate job enqueued (app-owned helper, or the repair scanner)
→ platform-worker claims the job and calls handleObjectiveEvaluate
→ loads objective version + metrics + definitions + constraints
    + dependency health + in-scope measurements
→ normalises them (pure) and derives a deterministic input hash
→ pure evaluateObjectiveHealth runs (the ONE formula site)
→ one immutable objective_health snapshot appended (idempotent on the hash)
→ honest contribution assessment appended where verified links + evidence exist
→ factual platform_events published (health.evaluated always; changes only on change)
→ parent objective enqueued for re-evaluation on a status change (cycle-safe)
```

The worker **evaluates and publishes facts.** Remediation, if any, re-enters through
the normal control path (§9), never from inside the worker.

### Trigger strategy (hybrid, scanner-first)

There is deliberately **no synchronous health computation inside the measurement
transaction** and **no database `AFTER INSERT` trigger** (that path was rejected for
job explosion, harder testing and tight DB coupling, with no coverage the scanner
does not already give). Two complementary paths enqueue an idempotent
`objective.evaluate` job:

1. **Application-owned** —
   [`enqueueObjectiveEvaluation()`](../../supabase/functions/_shared/objective_evaluation_enqueue.ts)
   is called by any code that appends a measurement or outcome, and by parent
   propagation. Clear ownership, easy correlation, no trigger coupling.
2. **Repair scanner** —
   [`objective-evaluation-scheduled-sync`](../../supabase/functions/objective-evaluation-scheduled-sync/index.ts)
   runs on a cron, finds active objectives whose newest in-scope measurement is newer
   than their latest snapshot (or that have a measurement but no snapshot yet) and
   enqueues them. This is what covers **manual SQL inserts, imports and the first live
   slice**, which no application writer touches.

The scanner is secret-gated (`OBJECTIVE_EVAL_SECRET`, header `x-schedule-secret`).
Registering the cron row is a deploy step, not wired in code; until then it can be
invoked on demand with the secret.

### Job type & payload

Registered in `WORKER_HANDLERS` as `objective.evaluate`. Payload is narrow,
replayable and secret-free:

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

**Tenant identity comes from the job context, never the payload.** The objective, its
metrics, its metric definitions and its measurements must all belong to that tenant or
the job is rejected `cross_tenant_mismatch` (terminal, dead-letters).

Edge functions:
[`objective-evaluate`](../../supabase/functions/objective-evaluate/index.ts) is the
manual/operator entry; `objective-evaluation-scheduled-sync` is the repair scanner.
The impure handler is
[`worker_handlers/objective_evaluate.ts`](../../supabase/functions/_shared/worker_handlers/objective_evaluate.ts):
load → pure → append → emit → propagate.

---

## 6. Idempotency: input hash + UTC-day bucket

A retry must never create a duplicate logical snapshot. Two layers guarantee it.

**Deterministic identity.** `buildObjectiveInputHash()` hashes tenant + objective id +
**objective version** + normalised metric spec + constraint spec + the **latest
selected measurement ids/timestamps/values** + **dependency state** + evaluator
version (`OBJECTIVE_EVALUATOR_VERSION = "obj-health@1"`) + a coarse **time bucket**
(the UTC day via `utcDayBucket`) + an optional **force nonce**. It never includes the
raw clock, because the whole point is replayability.

**Database uniqueness.** `objective_health_idem_uk` is a partial unique index on
`(tenant_id, objective_id, input_hash)`. A concurrent double-run collapses to one row;
the loser treats the `23505` as an idempotent success and re-emits **no** events.

| Change | Result |
|---|---|
| Same inputs, same UTC day, retry | same hash → **no** new snapshot, **no** duplicate events |
| New measurement | new hash → **new** snapshot |
| New objective version | new hash → **new** snapshot |
| Changed constraint / dependency state | new hash → **new** snapshot |
| New UTC day (time-aware status may drift, e.g. crossing `target_at`) | new bucket → **new** snapshot |
| `force: true` | nonce mixed into the hash → **new** audit snapshot (explicit) |

The UTC-day bucket is what lets a **stale, overdue or target-date** condition change
health *without a new measurement*: the next day yields a new hash and captures the
transition (for example `on_track → missed`). Measurement-driven evaluations enqueue
immediately and do not wait for a day boundary; time-only re-evaluation happens at most
once per UTC day, because the scanner enqueues a time-only pass only when the objective
has not been evaluated yet today. Even if two runs enqueue within one day, the unique
index is the final race guard.

---

## 7. Append-only health snapshots and lineage

Snapshots are written to `objective_health`, never updated. The `snapshot` jsonb stores
the **normalised evaluator input plus the selected measurement refs** (ids, timestamps,
values only) for full replay, with **no raw emails, transcripts, tokens or secrets**.
`supersedes` links each snapshot to its predecessor for lineage. The append-only
triggers from `20260720120100` cover the new columns too.

Health is **descriptive**, not a lifecycle mutation: `achieved` does not archive the
objective, `missed` does not rewrite the target, `off_track` does not change strategy,
`blocked` edits nothing. Health and strategic lifecycle stay distinct. Publishing or
superseding an objective remains an authorised human/OpenFolk workflow.

### Event model

Published to `platform_events` (hardened envelope: `actor`, `occurred_at`, `domain`,
`correlation_id`) from the controlled `objective_event_types` registry
(`OBJECTIVE_EVENT_TYPES` in code). Storm-avoidance is built into `planObjectiveEvents`:

| Event | When | Subject |
|---|---|---|
| `objective.health.evaluated` | every new logical snapshot | the snapshot |
| `objective.health.changed` | only on a status change | the objective |
| `objective.at_risk` / `.off_track` / `.blocked` / `.achieved` | only on transition into that status | the objective |
| `objective.measurement.stale` | only when a metric is newly stale | the objective |
| `objective.contribution.assessed` | a contribution assessment recorded | the assessment |

Events **describe**; they never execute remediation. The one-pending-per-subject unique
index de-duplicates repeats.

### Parent objectives

A child status change enqueues the parent for re-evaluation (`triggered_by:
"dependency_change"`), gated on a **real** status change and bounded by the acyclic
`objectives_no_parent_cycle` DB trigger (depth-capped at 64 hops). Parent health is
**not** a blind average: a parent uses its explicit `depends_on` links' health where
configured, and otherwise reports `unknown` or `blocked` honestly. No universal
portfolio formula is invented.

---

## 8. Contribution: honest attribution, now consuming real Outcomes

`evaluateContribution(expected, outcomes, measurements) → ContributionAssessment` is
deliberately honest. An action is **never** credited merely because it was linked.
States (from the `contribution_states` registry):

```
proposed → expected → in_progress → outcome_observed →
contribution_confirmed | contribution_rejected | inconclusive
```

Confirmation requires **before/after measurement evidence in the expected direction**.
Without it, the result is `inconclusive`. An unverified objective link may never claim
`contribution_confirmed`. False precision is refused.

### What changed: the Outcomes layer now exists

An earlier version of this engine stated there was "no first-class Outcomes layer yet",
which made confirmed contribution structurally impossible. **That is now outdated.** The
[Automation Engine](./AUTOMATION_ENGINE.md) created the append-only `outcomes` layer, so
the prerequisite the boundary was waiting on is built. Per the glossary's canonical
**Outcome** term, it records results in **three distinct layers**, execution result vs
operational outcome vs business outcome, each carrying provenance (source kind, source
record id, execution-attempt/action/intent ids, evidence refs, confidence, `observed_at`,
correlation id) and a **verification state** from a controlled registry:

```
system_observed | externally_verified | human_verified | inferred_unverified | rejected
```

Contribution assessment now consumes those real outcomes rather than a placeholder.

### Honest about what is still empty in v1

The integrity boundary is unchanged in strength, only better grounded. It is enforced at
a single **pure choke point** in `objective_evaluation.ts`: `planContributions` derives
outcomes **only** from supported immutable evidence, and every result passes through
`enforceContributionEvidenceBoundary`, which downgrades any would-be
`contribution_confirmed` to `inconclusive` (movement preserved for audit) unless
immutable evidence backs it.

In v1 the supported set `SUPPORTED_OUTCOME_EVIDENCE_TYPES` is **still empty**, and this
is faithful to the code. The reason is on the Automation side: the controlled adapters
record only `system_observed` **operational** outcomes; **no `business` outcome type is
registered**, the `outcome_type` FK makes a business-value claim structurally impossible,
and a DB trigger additionally requires any business outcome to be `externally_verified` or
`human_verified`. So the Outcomes layer **exists** without loosening this boundary.
Confirmed contribution still waits for a verified **business-outcome** evidence type to be
registered and added to `SUPPORTED_OUTCOME_EVIDENCE_TYPES` here.

v1 behaviour, precisely: no relevant link/evidence → **no assessment**; a verified
expected link with no evidence → **`expected`**; a would-be confirmation without immutable
evidence → **`inconclusive`**; metric movement without sufficient causation evidence →
**`inconclusive`**. Never a claimed attributable value just because a metric moved after an
action. Assessments are written to the append-only
`objective_contribution_assessments` table (idempotent by input hash); the mutable
`objective_links.contribution_state` is only a "current" pointer, never the history. This
is enforced by conformance gate G5 (the worker never fabricates a completed outcome from a
link, never calls the raw contribution evaluator directly, and never writes a confirmed
state).

---

## 9. Boundaries

**Decision Engine.** The Decision Engine does not choose company strategy and never
becomes goal-seeking. `DecisionInput.objectiveContext` is resolved before entry (by the
pure `resolveObjectiveContext`) and carried verbatim onto the `DecisionPackage` as
**descriptive metadata**. The engine never queries objectives, never invents them and
never routes on them, proven by tests: the same object with and without objective context
produces the *same* decision, and objective context can never bypass authority, risk,
policy or Operational Mode. Objective Health facts do not mutate or bypass Decision
Packages either. The worker may emit `objective.off_track`; a *later* intelligence
producer interprets it into an Observation that flows through the
[Decision Engine](./DECISION_ENGINE.md) → Operational Mode → Action/Review/Approval. The
evaluation worker creates **no** Actions or Automation Intents. Objective constraints only
ever reach the engine if already converted into policy or authority facts.

**Operational Modes.** Modes govern *autonomy*; objectives govern *direction*; the two are
independent, and no objective logic is baked into the mode registry. Even in **Discovery**,
measurements are stored and Objective Health is evaluated (observe-only); no business
execution occurs. Proactive optimisation off the back of health changes is out of scope for
this phase and gated to Optimisation mode's config flag when it lands.

**OpenFolk & client authority.** AI may *draft* objectives from interviews and operational
evidence and *propose* missing, conflicting, stale, achieved or obsolete objectives, but
proposals stay drafts. **OpenFolk never unilaterally changes a customer's strategic
direction; publication requires authorised review.** The `source` field records provenance
(`client_interview | openfolk_workshop | tenant_configuration | approved_ai_proposal |
imported | derived`). The schema is provider-read-safe for a future OpenFolk objective
portfolio, but the control plane is an optimisation partner, not the owner of strategy.

---

## 10. Versioning & config lifecycle

Objectives, metric definitions, constraints and links use the canonical
`config_versions` lifecycle:

```
draft → review → published → superseded → archived
```

There is no `simulation` state; simulation is a capability, not a lifecycle stage (see
[00_GLOSSARY](../architecture/00_GLOSSARY.md)). **Published strategic history is not edited
in place.** A changed target or priority creates a new version that supersedes the old,
preserving who, why, previous, new, effective date, approval and lineage. Health is a
separate append-only time-series, so the strategic definition stays immutable while
operational health evolves beneath it.

---

## 11. Security

The job tenant must match the objective tenant; metric, objective and measurement
relationships must all match the tenant; cross-tenant references are rejected terminally;
OpenFolk provider access follows the existing `is_openfolk()` RLS; service-role writes are
narrow; no caller-controlled tenant id ever overrides the job context. Covered by the worker
tenant checks and the SQL assertions.

---

## 12. ServiceOS & ProductOS: one core

The engine code is identical; only configuration differs, and the pure evaluator holds no
domain literals (conformance-enforced).

- **ServiceOS** — objective "reduce average response time from 6h to under 2h this
  quarter"; metric `response_time` (hours, `decrease`).
- **ProductOS** — objective "reduce stock-outs by 30% without breaching the inventory
  ceiling"; metric `stock_out_rate` (percent, `decrease`) with a **hard constraint** on
  `inventory_level`.

Both are evaluated by the same `evaluateObjectiveHealth`, proven in
[`objectives.verify.ts`](../../supabase/functions/_shared/intelligence/objectives.verify.ts).

### Service-visit naming

The objective core uses **universal** concepts (`service_target`, `response_time`) with no
engineer/technician/SKU literals. The canonical vocabulary prefers generalised
`service_visit` naming (`service_visit_requested`, `assign_service_resource`,
`schedule_service_visit`) so ServiceOS serves all service industries, not only engineer-led
field service. Note the seed still carries the narrower legacy terms
(`engineer_visit_requested`, `assign_engineer_visit`); a later domain-pack migration should
generalise them with backward-compatible aliases. This is a seed-vocabulary note, not a
change to the objective engine, which is already generalised.

---

## 13. Value measurement (later phase)

The architecture supports future honest reporting of value delivered (hours saved, cost
removed, capacity created, revenue captured, response time improved, failures/stock-outs
prevented, objective progress). **No fabricated monetary values:** every value claim must
record method, source, assumptions, confidence, period, baseline and counterfactual where
available. Reporting itself is a later phase and depends on the business-outcome evidence
type of §8 being registered.

---

## 14. Operational verification (controlled slice)

Controlled inputs, test/runbook only, never seeded and never a published strategic claim:

- objective `1295f92c-6204-4c08-8ba5-e29fb2097ef6`, metric
  `b341661b-91c1-4a9f-b735-bc1e649888a8`
- baseline `6 hours` → target `2 hours`, current measurement `4.5 hours`, direction
  `decrease`

Expected progress: `(6 − 4.5) / (6 − 2) = 0.375` (about 37.5%), subject to the pure
evaluator's exact time-aware model. Proven in
[`objective_evaluation.verify.ts`](../../supabase/functions/_shared/intelligence/objective_evaluation.verify.ts).
Live deployment sequence: apply migration `20260721120000` → deploy the two edge functions
→ insert the measurement → invoke `objective-evaluate` (or the scanner) → confirm one
`objective_health` row with `progress = 0.375` and an `objective.health.evaluated` event.

---

## 15. Files

| File | Role |
|---|---|
| [`_shared/intelligence/objectives.ts`](../../supabase/functions/_shared/intelligence/objectives.ts) | Pure evaluators: `evaluateObjectiveHealth`, `evaluateContribution`, `verifyObjectiveLinks`, `resolveObjectiveContext`, controlled registries |
| [`_shared/intelligence/objective_evaluation.ts`](../../supabase/functions/_shared/intelligence/objective_evaluation.ts) | Pure worker orchestration: normalise, input hash, diff, event plan, contribution integrity boundary |
| `_shared/intelligence/objectives.verify.ts` / `objective_evaluation.verify.ts` | Node self-tests |
| `_shared/worker_handlers/objective_evaluate.ts` | Impure handler: load → pure → append → emit → propagate |
| `_shared/objective_evaluation_enqueue.ts` | Reusable idempotent enqueue helper |
| `functions/objective-evaluate/index.ts` | Manual/operator edge function |
| `functions/objective-evaluation-scheduled-sync/index.ts` | Repair scanner edge function |
| `migrations/20260720120000_objectives.sql` | Schema: objectives, metrics, measurements, links, health, registries, graph node types |
| `migrations/20260720120100_objectives_hardening.sql` | Append-only triggers + hardening |
| `migrations/20260721120000_objective_health_evaluation.sql` | Worker schema: identity/lineage columns, idempotency index, contribution table, event registry, parent-cycle guard |
| `tests/objective_health_evaluation.test.sql` | Append-only + idempotency + parent-cycle assertions |
| `scripts/intelligence-conformance.sh` | Conformance gate G5 |

---

## 16. The full loop

```
Objective → Observation → Intelligence → Decision → Action → Execution → Outcome →
Measurement → Objective Health → Learning → Optimisation Proposal
```

Objectives sit at the top: they are the "why" every other stage traces back to, and the
Objective Health snapshot is the honest fact the slow strategic loop reads. An intelligence
producer consumes `objective.off_track` and trend events, proposes an improvement through the
Decision Engine, and only in Optimisation mode can the platform act on it. This engine's job
ends at **honest facts**.
