# Build 11 — Resolve completed work into clear commercial outcomes

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 2: operational improvement.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Internal coordination and reviewed drafts; provider writes disabled.
- Prerequisites: [Build 10](10-learn-foundation-acceptance-gate.md)
- The accepted [Build 10](10-learn-foundation-acceptance-gate.md) LEARN gate is also mandatory and must still be valid.

## Outcome to achieve

Completed visits reach a correct, evidenced commercial outcome with less manual chasing and avoidable delay.

Before implementation, define the accountable role, source-backed baseline (or
explicitly unknown baseline), measurement and denominator, acceptance condition,
observation period and quality/customer/staff guardrails. Agree unresolved business
definitions through the existing review path; do not invent a financial benefit.

## First inspect and reuse

Read the current user instructions, AGENTS.md, [decisions/sources](DECISIONS-AND-SOURCES.md),
[tracker](TRACKER.md), prerequisite receipts and current delivery evidence.
Inspect the following starting points and their actual callers/tests/runtime.
These are anchors, not an instruction to replace their contents:

- `src/lib/command-work.ts`
- `supabase/functions/_shared/work_transition.ts`
- `supabase/functions/_shared/work_authority.ts`
- `src/lib/learn-commusoft-job-details.ts`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Read the accepted LEARN model and prioritised improvement backlog. Inspect existing completion, work-item and evidence UI. Choose a bounded pilot with the operational and finance owners.

2. Use existing engineer capture where possible. Identify missing information at the useful point in the visit, with a small context-specific request; avoid mandatory re-entry into another app. Voice/photo assistance uses only accepted Build 07 capabilities.

3. Represent delivery, contract inclusion, invoice readiness, FOC approval, blocker and further-work proposal separately. One visit may legitimately contribute to several paths. Respect multi-visit jobs, partial completion, approved variations and warranty.

4. Apply approved pricing/scope/evidence/PO checks with deterministic calculations and traceable inputs. Preserve accepted quoted prices and distinguish actual costs from selling rates. Ambiguous contract/policy inputs remain held.

5. Create owned, grouped internal exceptions with due dates, cover and completion evidence. Prepare invoice information and further-work handoffs for review; provider invoicing remains in its authoritative system until separately enabled.

6. Measure completion-to-readiness/invoice time, missing-information exchanges, corrections and handling effort against the accepted baseline. Resolve current invoicing independently of a future replacement quote where contract rules permit.

## Acceptance checks

- Routine, included, FOC, missing-PO, partial-job and simultaneous-invoice-plus-quote cases follow approved rules.
- Replay cannot duplicate charges, internal actions or opportunities; corrections preserve original evidence.
- Missing certification follows approved contract requirements, never a blanket inferred rule.
- Staff can resolve a real exception more simply; financial/capture unknowns remain visible.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No automatic invoice issue, FOC approval, rate change, staff punishment or rebuild of the engineer app.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

Accepted completion workflow, draft invoice handoff and pilot outcome observations.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
