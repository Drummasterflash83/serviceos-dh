# Build 17 — Connect parts evidence to work and cost

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 2: operational improvement.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Internal procurement coordination; purchasing disabled.
- Prerequisites: [Build 11](11-visit-completion-and-commercial-control.md), [Build 12](12-further-works-and-quote-conversion.md)
- The accepted [Build 10](10-learn-foundation-acceptance-gate.md) LEARN gate is also mandatory and must still be valid.

## Outcome to achieve

Fewer jobs stall or repeat because parts are missing, and material use is more reliably linked to job economics.

Before implementation, define the accountable role, source-backed baseline (or
explicitly unknown baseline), measurement and denominator, acceptance condition,
observation period and quality/customer/staff guardrails. Agree unresolved business
definitions through the existing review path; do not invent a financial benefit.

## First inspect and reuse

Read the current user instructions, AGENTS.md, [decisions/sources](DECISIONS-AND-SOURCES.md),
[tracker](TRACKER.md), prerequisite receipts and current delivery evidence.
Inspect the following starting points and their actual callers/tests/runtime.
These are anchors, not an instruction to replace their contents:

- `supabase/functions/_shared/work_transition.ts`
- `supabase/functions/_shared/connectors/index.ts`
- `docs/architecture/source-adapter-pattern.md`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Map the current stock/parts/supplier records, physical locations, movements, reservations and job references. Distinguish a recorded quantity from a verified physical count.

2. Use stable part identities and reviewed alternatives. AI may propose a match from a supplier document; it cannot silently substitute a component or guess exact compatibility.

3. Capture take-outs, returns, reservations and received items with source/version and job links using the simplest accepted existing staff flow. Replayed Slack/export records must not duplicate stock movement.

4. Connect quote parts requirements to price validity, supplier lead time, purchase authorisation and delivery readiness. Separate ordered, confirmed, received, reserved and used states.

5. Surface missing thresholds, count discrepancies, unmatched supplier cost and shortages as owned work. Prepare purchasing requests for approval; retain Commusoft/approved inventory authority instead of creating two editable masters.

6. Measure avoidable waiting/revisits and allocation completeness against the LEARN baseline, with actual evidence and no assumed physical-stock accuracy.

## Acceptance checks

- Duplicate posting, return/cancellation, partial delivery, substitution and multi-job allocation retain correct quantities and history.
- No negative/unknown inventory is silently fixed; reconciliation uses an approved count.
- Stale supplier prices cannot appear as confirmed quote costs.
- No purchase or supplier message occurs while the capability is disabled.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No autonomous orders, payments, supplier messages, full ERP replacement or fabricated reorder thresholds.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

Parts-to-job readiness and reviewed movement/cost reconciliation with a purchasing draft path.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
