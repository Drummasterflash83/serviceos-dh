# Build 08 — Reconstruct how work flows and where it gets stuck

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 1: LEARN foundation.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Read-only operational analysis and reviewed process models.
- Prerequisites: [Build 05](05-operational-evidence-and-obligations.md), [Build 06](06-finance-time-and-outcome-baselines.md), [Build 07](07-knowledge-extraction-and-local-ai.md)

## Outcome to achieve

The team can see evidenced waiting, handoffs, rework and blind spots in real company journeys.

Before implementation, define the accountable role, source-backed baseline (or
explicitly unknown baseline), measurement and denominator, acceptance condition,
observation period and quality/customer/staff guardrails. Agree unresolved business
definitions through the existing review path; do not invent a financial benefit.

## First inspect and reuse

Read the current user instructions, AGENTS.md, [decisions/sources](DECISIONS-AND-SOURCES.md),
[tracker](TRACKER.md), prerequisite receipts and current delivery evidence.
Inspect the following starting points and their actual callers/tests/runtime.
These are anchors, not an instruction to replace their contents:

- `src/lib/learn-work-history.ts`
- `src/lib/learn-work-delays.ts`
- `src/lib/learn-work-calendars.ts`
- `src/lib/learn-working-time.ts`
- `docs/architecture/06_LEARNING_CENTRE.md`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Define a shared case/event representation tied to existing evidence and work entities: case identity, event type, actual time/timezone, recorded time, role, source and confidence. Handle one-to-many visits, quotes, invoices and corrections.

2. Reconstruct bounded representative journeys from observed events. Display documented process, observed variants and proposed improvements separately. Retain partial cases and unknown boundaries rather than inventing intervening steps.

3. Calculate elapsed, waiting and directly measured handling time separately using approved calendars. Do not convert an email interval, absence of messages or diary gap into paid effort or inactivity.

4. Detect evidence-backed repeated missing information, duplicate entry, stalled acceptance-to-booking, approval bottlenecks, reopened work, repeat visits and repeated customer contacts. Group by process/cause with denominators and uncertainty.

5. Allow staff to inspect and correct event links and explanations. Surface actionable process findings in existing LEARN views without personal blame, public rankings or a new surveillance dashboard.

## Acceptance checks

- Out-of-order/late events, DST, reopened cases and incomplete history do not produce false durations.
- A documented step absent from records is shown as unevidenced, not skipped as fact.
- Duplicate source messages do not create extra work or repeated bottleneck counts.
- Review ordinary and exception journeys with people doing the work; second-tenant process vocabulary works.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No automatic causality claim, inferred working hours, employee judgement or operational intervention.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

Reviewed process maps, friction evidence and quantified blind spots for the agreed company scope.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
