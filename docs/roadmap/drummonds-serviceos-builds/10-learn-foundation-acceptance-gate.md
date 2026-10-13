# Build 10 — Prove LEARN understands the agreed company scope

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 1: LEARN foundation.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Acceptance review; bounded repairs only within existing Part 1 scope.
- Prerequisites: [Build 01](01-finish-current-learn-v1.md), [Build 02](02-source-scope-and-coverage.md), [Build 03](03-connected-company-records.md), [Build 04](04-strategy-roles-and-business-rules.md), [Build 05](05-operational-evidence-and-obligations.md), [Build 06](06-finance-time-and-outcome-baselines.md), [Build 07](07-knowledge-extraction-and-local-ai.md), [Build 08](08-observed-process-and-friction.md), [Build 09](09-improvement-discovery-and-outcomes.md)

## Outcome to achieve

The team can rely on LEARN's company model and baseline before operational automation is introduced.

Before implementation, define the accountable role, source-backed baseline (or
explicitly unknown baseline), measurement and denominator, acceptance condition,
observation period and quality/customer/staff guardrails. Agree unresolved business
definitions through the existing review path; do not invent a financial benefit.

## First inspect and reuse

Read the current user instructions, AGENTS.md, [decisions/sources](DECISIONS-AND-SOURCES.md),
[tracker](TRACKER.md), prerequisite receipts and current delivery evidence.
Inspect the following starting points and their actual callers/tests/runtime.
These are anchors, not an instruction to replace their contents:

- `docs/roadmap/drummonds-serviceos-builds/LEARN-ACCEPTANCE.md`
- `docs/operations/LEARN-V1-COMPLETION.md`
- `docs/operations/VERIFICATION_AND_ACCEPTANCE.md`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Revalidate all prerequisite receipts against current code, data authority and source freshness. A historic PASS invalidated by changed access or definitions is not sufficient.

2. Evaluate G1–G10 in LEARN-ACCEPTANCE.md against the agreed scope register. Account for every required row and capability; classify exclusions without silently reducing coverage.

3. Trace the representative ordinary and exception journeys with source-backed records. Verify financial/time definitions, process meaning, access, source corrections, recurring reliability and second-tenant reuse.

4. Obtain recorded business, finance and operational review of the understanding and its practical usability. Do not invent a human sign-off or equate operator acceptance with staff acceptance.

5. Repair bounded Part 1 gaps where authorised; retain meaningful incomplete work. Produce PASS only when required criteria are established. Otherwise record PARTIAL/BLOCKED with exact dependencies and the next action.

## Acceptance checks

- Every G1–G10 decision has evidence, environment, scope version and acceptance owner.
- Real observation periods were observed; no replay is labelled weeks of live operation.
- Material gaps block their dependent claims and cannot be waived by the agent.
- Part 2 remains unstarted unless the full agreed gate passes; the receipt names which capability boundaries it unlocks.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No new operational features, automatic activation, invented acceptance or claim that learning stops after the gate.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

A signed/reviewed LEARN acceptance decision and explicit Part 2 eligibility.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
