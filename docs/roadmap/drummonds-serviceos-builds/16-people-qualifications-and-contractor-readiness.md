# Build 16 — Make competence and contractor readiness dependable

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 2: operational improvement.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Evidence administration and readiness checks.
- Prerequisites: [Build 11](11-visit-completion-and-commercial-control.md), [Build 13](13-contract-delivery-renewal-and-account-value.md)
- The accepted [Build 10](10-learn-foundation-acceptance-gate.md) LEARN gate is also mandatory and must still be valid.

## Outcome to achieve

Work can be prepared with the right qualified people and approved contractors without repeated evidence chasing.

Before implementation, define the accountable role, source-backed baseline (or
explicitly unknown baseline), measurement and denominator, acceptance condition,
observation period and quality/customer/staff guardrails. Agree unresolved business
definitions through the existing review path; do not invent a financial benefit.

## First inspect and reuse

Read the current user instructions, AGENTS.md, [decisions/sources](DECISIONS-AND-SOURCES.md),
[tracker](TRACKER.md), prerequisite receipts and current delivery evidence.
Inspect the following starting points and their actual callers/tests/runtime.
These are anchors, not an instruction to replace their contents:

- `supabase/functions/_shared/ownership.ts`
- `supabase/functions/_shared/work_authority.ts`
- `src/lib/learn-work-calendars.ts`
- `src/lib/command-work.ts`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Inspect existing training, qualification and contractor matrices and source scripts. Preserve their authoritative evidence and approved policies; identify exact missing logic instead of blindly copying schedules.

2. Model person qualification, contractor company approval and individual operative competence separately, with scope, issuer, expiry, evidence and reviewer. An uploaded certificate is a candidate record until appropriate validation.

3. Implement deterministic expiry/reminder and renewal-booking workflows with Europe/London working-day rules, deduplication and absence cover. Group chases and preserve privacy of staff evidence.

4. Expose current/expiring/missing/under-review readiness for a specified task. A generic valid certificate or insurance document does not establish all-task competence.

5. Retain human contractor and technical approvals; connect readiness to jobs and later scheduling. Record why a hold exists and what clears it.

6. Use approved hours/leave evidence from LEARN for reconciliation support only; keep payroll calculation approval with finance and do not implement an automatic pay engine.

## Acceptance checks

- Expiry boundaries, DST, revoked/replaced certificates, absent approver and contractor/operative confusion are handled.
- Only authorised people access qualification/payroll evidence; operators are explicitly selected and audited.
- Duplicate sweep/import does not create repeat reminders or erase old proof.
- Required task-specific competence is checked without presenting evidence absence as a definitive judgement of ability.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No automated employment/pay decisions, blanket HR capture or self-approved contractor activation.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

Evidence-backed readiness, grouped renewal work and tested task/role checks.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
