# Build 19 — Make delivery readiness and capacity actionable

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 2: operational improvement.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Scheduling recommendations alongside the existing diary.
- Prerequisites: [Build 13](13-contract-delivery-renewal-and-account-value.md), [Build 15](15-asset-lifecycle-and-capital-planning.md), [Build 16](16-people-qualifications-and-contractor-readiness.md), [Build 17](17-parts-stock-and-procurement-readiness.md)
- The accepted [Build 10](10-learn-foundation-acceptance-gate.md) LEARN gate is also mandatory and must still be valid.

## Outcome to achieve

Coordinators can choose feasible delivery options and reduce avoidable waiting without losing control of the diary.

Before implementation, define the accountable role, source-backed baseline (or
explicitly unknown baseline), measurement and denominator, acceptance condition,
observation period and quality/customer/staff guardrails. Agree unresolved business
definitions through the existing review path; do not invent a financial benefit.

## First inspect and reuse

Read the current user instructions, AGENTS.md, [decisions/sources](DECISIONS-AND-SOURCES.md),
[tracker](TRACKER.md), prerequisite receipts and current delivery evidence.
Inspect the following starting points and their actual callers/tests/runtime.
These are anchors, not an instruction to replace their contents:

- `src/lib/learn-work-calendars.ts`
- `src/lib/learn-work-delays.ts`
- `src/lib/learn-working-time.ts`
- `supabase/functions/_shared/work_transition.ts`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Read the authoritative diary, accepted work, maintenance obligations and approved resource/leave sources. Verify real access and refresh; a job list is not a complete availability feed.

2. Calculate readiness from accepted scope, access, parts, competence, contractor status, customer promises and dependencies. Keep hard constraints separate from preferences.

3. Offer feasible engineer/date options with duration/travel assumptions and reasons. Unknown duration, access or resource availability remains explicit and prevents a confident booking claim.

4. Support quiet-period planning from technically approved asset plans without treating unaccepted work as booked capacity. Show firm, tentative and forecast workload separately.

5. Route suggestions to the existing coordinator with customer/service priorities and explicit override reasons. Recheck current diary state before any later approved booking operation.

6. Measure actual scheduling effort, ready-to-book delay, missed commitments and repeat visits. Do not rank engineers by unadjusted financial proxies or infer paid work from empty diary slots.

## Acceptance checks

- Leave, travel, overlapping assignments, expiring competence, missing parts and external appointment changes invalidate stale suggestions.
- No provider booking is created by recommendation generation.
- Working-day/DST and site access windows are applied consistently.
- Observed capacity and forecasts remain separate; coordinators can explain and correct recommendations.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No autonomous dispatch, emergency safety triage replacement, new scheduling product or invented availability.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

A reviewed readiness/capacity view and evidence-backed options within the existing workflow.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
