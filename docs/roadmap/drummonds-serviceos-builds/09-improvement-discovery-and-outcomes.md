# Build 09 — Prioritise improvements by evidence and business outcome

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 1: LEARN foundation.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Recommendation and review only.
- Prerequisites: [Build 04](04-strategy-roles-and-business-rules.md), [Build 06](06-finance-time-and-outcome-baselines.md), [Build 08](08-observed-process-and-friction.md)

## Outcome to achieve

Chris and Drummonds can choose the next changes by demonstrated need, expected benefit and a credible success test.

Before implementation, define the accountable role, source-backed baseline (or
explicitly unknown baseline), measurement and denominator, acceptance condition,
observation period and quality/customer/staff guardrails. Agree unresolved business
definitions through the existing review path; do not invent a financial benefit.

## First inspect and reuse

Read the current user instructions, AGENTS.md, [decisions/sources](DECISIONS-AND-SOURCES.md),
[tracker](TRACKER.md), prerequisite receipts and current delivery evidence.
Inspect the following starting points and their actual callers/tests/runtime.
These are anchors, not an instruction to replace their contents:

- `supabase/functions/_shared/intelligence/objectives.ts`
- `supabase/functions/_shared/intelligence/objective_evaluation.ts`
- `src/lib/command-work.ts`
- `docs/architecture/02_CORE_LOOP.md`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Extend existing recommendations/actions/objectives to represent improvement proposals. Each carries problem, examples, affected process, owner, baseline, proposed change, expected mechanism, dependencies, confidence, effort and acceptance plan.

2. Evaluate alternatives in order: eliminate unnecessary work, simplify policy/ownership, improve capture, integrate, deterministic automation, AI assistance. Do not label every repeated step an automation opportunity.

3. Rank without invented weights or ROI. Distinguish financial amounts from staff capacity and service quality; prevent counting one underlying issue across multiple savings proposals.

4. Define outcome contracts with comparable cohorts/periods, observation window, quality/customer/staff guardrails and confounders. An observed before/after change alone is not causal proof.

5. Capture reviewed corrections and recurrent exceptions as proposed rule/process improvements. Never self-modify policy. Use this evidence to refine the Part 2 backlog; explain any deviation from the original priority order.

## Acceptance checks

- Every shortlisted change can be traced to source examples and a named owner or explicit ownership gap.
- Unknown baselines cannot be presented as measured benefit.
- Duplicated/overlapping proposals are linked rather than counted twice.
- Business reviewers can accept, reject or amend a recommendation without triggering execution.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No provider actions, auto-generated backlog explosion, autonomous policy rewriting or premature Part 2 implementation.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

A reviewed, outcome-led improvement backlog and evidence-based adjustments to Part 2.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
