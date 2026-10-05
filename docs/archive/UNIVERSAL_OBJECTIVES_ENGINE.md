> **SUPERSEDED — archived for historical reference.**
> This document is no longer maintained and may contain claims that were
> true only at the time of writing. Its subject is now owned by
> [Objectives & Outcomes Engine](../reference/OBJECTIVES_AND_OUTCOMES.md).
> Start at the [documentation index](../README.md). Kept to preserve the
> architectural evolution and decision history.

---

# Universal Objectives & Outcomes Engine v1

**Status:** Implemented and verified (pure engine machine-proven; migration
statically reviewed). Not deployed. Not committed pending review.

The intelligence stack has four layers, and this is the top one:

| Engine | Question it answers |
|---|---|
| Universal Intelligence | What is happening? |
| Universal Decision | What should happen? |
| Operational Modes | How much autonomy may be exercised? |
| **Objectives & Outcomes** | **What is the business trying to achieve, and did our decisions and actions move it closer?** |

Without objectives the platform optimises for activity, automation volume, task
completion, speed and usage — everything except the thing the customer actually
cares about. This engine keeps the platform pointed at
[the customer's objectives](foundation/OPENFOLK_CONTINUOUS_OPTIMISATION.md), not
its own busyness.

---

## 1. The naming: Objectives *and Outcomes*

An objective is meaningless without measurement. We deliberately model one
coherent system — **not** separate systems for North Stars, OKRs, KPIs, projects,
benefits, value tracking or optimisation opportunities. Objectives *define*
direction; Measurements *observe* reality; the pure evaluators *derive* Health and
Contribution. OKRs (or any methodology) are one configurable shape *within* this
model, never the model itself.

## 2. Core principle

Every meaningful observation, decision, action, automation intent, outcome,
recommendation and optimisation proposal should be able to answer: *which business
objective does this support, and how?* **We do not fabricate links.** When a
reliable link exists it is explicit, measurable and auditable; when it does not,
the honest answer is "none", and routine operational work is never blocked for
lack of one.

## 3. Architecture — the challenge, answered

The chosen shape is **hybrid**, and here is why, question by question:

1. **Not** an `intelligence_objects.object_class`. Objectives are strategic,
   long-lived, human-owned and versioned — a different altitude from operational
   sensing/work. They get **dedicated high-integrity tables** (`objectives`,
   `metric_definitions`, `measurements`, …), and **project into the Business Graph**
   as `Objective`/`Metric` node types for relationship traversal. Operational
   links use a universal `objective_links` table.
2. **Objectives vs Actions:** Actions are operational work (executed, short-lived).
   Objectives are strategic intent (measured over time, never "executed"). Actions
   *link to* objectives; they are not a kind of objective.
3. **KPIs are first-class**, not JSON buried in an objective — a `metric_definitions`
   table (reusable) plus a `measurements` time-series. This is required so metrics
   can be typed, sourced, freshness-aware and shared across objectives.
4. **Graph link:** objectives/metrics are graph node types; entity relationships
   go through the graph, while relationships to operational objects
   (decisions/actions/outcomes) go through `objective_links` (controlled relations).
5. **Decision Engine stays deterministic** (see §8). Objective linkage is *resolved
   before entry* and carried as descriptive `objectiveContext`; the engine never
   queries objectives or becomes goal-seeking.
6. **Definition ≠ measurement ≠ evaluation.** Objectives define; measurements
   observe; the pure `evaluateObjectiveHealth` derives; contribution is separate
   again. Four clean seams.
7. **Conflicts** are `objective_links` of relation `conflicts_with`, plus
   constraints that cap health when violated.
8. **North Star / annual / quarterly / project** are `objective_type` + hierarchy
   (`parent_objective_id`) + effective periods — one model, optional levels. An
   interim priority never overwrites the enduring North Star; they coexist.
9. **Both domains, one core:** types, metrics and capabilities are data; the pure
   engine has no domain literals (enforced by the conformance gate).
10. **Better abstraction:** "Objectives **and Outcomes**" is the more accurate
    name (§1) — objectives, measurements, health and contribution as one system.

## 4. Objective hierarchy

`strategic_direction → north_star → annual_objective → quarterly_priority →
initiative/project → operational target → metrics → actions/automations`. No
tenant is forced to use every level — a small business may run `north_star →
current priority → actions`. Relationships (parent/child, supporting, conflicting,
dependencies), weights, time horizons, ownership, status and review cadence are all
supported as data.

## 5. Objective model

Dedicated, tenant-scoped, versioned (`objectives`), with `objective_type` and
`status` from controlled registries, an owner, a hierarchy, a source and a
`version_id` into `config_versions`. The target *spec* lives in `objective_metrics`
(objective ↔ metric with role, baseline, target, direction, weight) — supporting
multiple metrics per objective without burying measurement in objective JSON.
Constraints live in `objective_constraints`. Qualitative goals are first-class
(direction `milestone`/`binary`).

## 6. Measurements

First-class: `metric_definitions` (key, unit, currency, direction, source system,
calculation method, cadence, owner) and `measurements` (a time-series of typed,
sourced, freshness-aware, evidence-carrying snapshots). Metric directions:
`increase, decrease, maintain, range, threshold, binary, milestone`. **Unlike units
and unlike currencies are never compared** without an explicit conversion source —
the health evaluator returns `unknown` rather than a false reading.

## 7. Constraints

Objectives carry constraints (`hard`/`soft`/`guardrail`) with an optional metric,
threshold and authority requirement. An action is **not** beneficial merely because
it moves one metric while breaching an agreed constraint — a violated *hard*
constraint caps Objective Health (surfaced as `constraint_violated` + a blocker).

## 8. Objective links

A universal `objective_links` table connects an objective to intelligence objects,
decisions, actions, automation intents, outcomes, graph entities, capabilities,
policies, initiatives and metrics, via a **controlled relation registry**
(`supports, contributes_to, blocks, risks, conflicts_with, depends_on, measures,
caused_by, supersedes`). Each link records expected vs actual contribution,
confidence, rationale, evidence, creator and approval — never an arbitrary string.

## 9. Objective Health (pure)

`evaluateObjectiveHealth(objective, measurements, now) → ObjectiveHealth` is pure,
deterministic, replayable and domain-agnostic
([objectives.ts](../supabase/functions/_shared/intelligence/objectives.ts)). It
returns a status (`unknown | on_track | at_risk | off_track | blocked | achieved |
missed`), progress, confidence, machine-readable reason codes, blockers and stale
measurements. **Missing or stale data never reads as healthy** (it returns
`unknown` and reports the stale metrics). It is time-aware (progress vs elapsed
window), direction-aware, dependency-aware and constraint-aware.

**The Objective Evaluation Worker operationalises this evaluator** — see
[OBJECTIVE_EVALUATION_WORKER.md](OBJECTIVE_EVALUATION_WORKER.md). It appends immutable
`objective_health` snapshots (idempotent on a deterministic input hash), publishes
factual `objective.*` events, and propagates to parent objectives — without inventing a
second health algorithm, computing health in SQL, or creating any Action. It is the
realisation of §19's "scheduled health-evaluation worker projecting `objective_health`
snapshots".

## 10. Contribution — honest attribution

`evaluateContribution(expected, outcomes, measurements) → ContributionAssessment`
is deliberately honest. An action is **never** credited merely because it was
linked. States: `proposed → expected → in_progress → outcome_observed →
contribution_confirmed | contribution_rejected | inconclusive`. Confirmation
requires *before/after measurement* evidence in the expected direction; without it,
the result is `inconclusive`. False precision is refused.

## 11. Decision Engine boundary

The Decision Engine does **not** choose company strategy and does not become
goal-seeking. `DecisionInput.objectiveContext` is *resolved before entry* and
carried verbatim onto the `DecisionPackage` as **descriptive metadata**. The engine
never queries objectives, never invents them, and never routes on them — proven by
tests: the same object with and without objective context produces the *same*
decision, and objective context can never bypass authority, risk, policy or
Operational Mode. Missing linkage never blocks routine work. Objective constraints
only ever reach the engine if already converted into policy/authority facts.

## 12. Operational Mode boundary

Modes govern *autonomy*; objectives govern *direction*; they are independent. No
objective logic is baked into the mode registry. Discovery may observe
objective-related patterns and execute nothing; Optimisation mode's `optimisation`
flag (config, not code) is what enables active objective-gap and improvement-seeking
behaviour.

## 13. Outcome integration

Reuses the existing `DecisionPackage.outcomeContract` (expected outcome, measurable
signals, timeout, `objectiveId`). The Objectives Engine *consumes* recorded outcomes
later — it never executes actions or evaluates policy. The full loop:

```
Objective → Observation → Intelligence → Decision → Action → Outcome →
Measurement → Objective Health → Learning → Optimisation Proposal
```

## 14. Versioning & approval

Objectives, metric definitions, constraints and links use the existing
`config_versions` lifecycle (`draft → review → published → supersede → archive`).
**Published strategic history is not edited in place** — a changed target or
priority creates a new version that supersedes the old, preserving who/why/previous/
new/effective-date/approval/lineage. Health is a separate append-only time-series
(`objective_health`), keeping the strategic definition immutable while operational
health evolves.

## 15. OpenFolk & client authority

AI may *draft* objectives from interviews and operational evidence and *propose*
missing/conflicting/stale/achieved/obsolete objectives — but proposals stay drafts.
**OpenFolk never unilaterally changes a customer's strategic direction; publication
requires authorised review.** The `source` field records provenance
(`client_interview | openfolk_workshop | tenant_configuration | approved_ai_proposal
| imported | derived`). The schema is provider-read-safe for a future OpenFolk
objective portfolio (objectives at risk, stale measurements, overdue reviews, value
delivered) — the control plane is an optimisation partner, not the owner of strategy.

## 16. ServiceOS & ProductOS — one core

The engine code is identical; only configuration differs.

- **ServiceOS** — Objective "reduce average response time from 6h to under 2h this
  quarter"; metric `response_time` (hours, decrease).
- **ProductOS** — Objective "reduce stock-outs by 30% without breaching the
  inventory ceiling"; metric `stock_out_rate` (percent, decrease) with a *hard
  constraint* on `inventory_level`.

Both are evaluated by the *same* `evaluateObjectiveHealth`, proven in
[objectives.verify.ts](../supabase/functions/_shared/intelligence/objectives.verify.ts).

## 17. Value measurement

The architecture supports future honest reporting of value delivered (hours saved,
cost removed, capacity created, revenue captured, response time improved, failures/
stock-outs prevented, objective progress). **No fabricated monetary values** —
every value claim must record method, source, assumptions, confidence, period,
baseline and counterfactual where available. (Reporting itself is a later phase.)

## 18. Terminology note (recommendation, not this phase)

The ServiceOS seed still uses narrow field-service terms
(`engineer_visit_requested`, `assign_engineer_visit`, `schedule_engineer_visit`).
The objective core here uses **universal concepts** (`service_target`,
`response_time`) and no engineer/technician/SKU literals. **Recommendation:** a
later domain-pack migration should generalise the service vocabulary toward
`service_visit_requested` / `assign_service_resource` / `schedule_service_visit`,
with backward-compatible aliases for existing seed data — ServiceOS must serve all
service industries, not only engineer-led field service.

## 19. Future extensions

Objective portfolio views; a scheduled health-evaluation worker projecting
`objective_health` snapshots; richer objective-context resolution (by entity/intent
lookup); value-delivered reporting; simulation of a proposed objective against
historical outcomes; AI objective-proposal routing through Operational Modes.
