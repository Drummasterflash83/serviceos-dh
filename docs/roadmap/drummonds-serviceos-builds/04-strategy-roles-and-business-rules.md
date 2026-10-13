# Build 04 — Understand strategy, ownership and commercial policy

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 1: LEARN foundation.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Version and review the business model.
- Prerequisites: [Build 03](03-connected-company-records.md)

## Outcome to achieve

The company model can explain which goal work supports, who decides and which approved rule applies.

Before implementation, define the accountable role, source-backed baseline (or
explicitly unknown baseline), measurement and denominator, acceptance condition,
observation period and quality/customer/staff guardrails. Agree unresolved business
definitions through the existing review path; do not invent a financial benefit.

## First inspect and reuse

Read the current user instructions, AGENTS.md, [decisions/sources](DECISIONS-AND-SOURCES.md),
[tracker](TRACKER.md), prerequisite receipts and current delivery evidence.
Inspect the following starting points and their actual callers/tests/runtime.
These are anchors, not an instruction to replace their contents:

- `docs/architecture/07_PROTOCOL.md`
- `supabase/functions/_shared/work_authority.ts`
- `supabase/functions/_shared/ownership.ts`
- `supabase/functions/_shared/intelligence/objective_evaluation.ts`
- `src/lib/ownership-projection.ts`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Read the New Dawn originals and as-is rules using the source index. Preserve conflicting targets, time periods and instructions as assertions with provenance; extraction does not make them approved.

2. Map strategic objectives, metrics, constraints and economic relationships into existing objective/measurement primitives. Distinguish planned targets from verified baselines and hypotheses such as further-works-to-ARR ratios.

3. Model documented, observed and approved responsibilities separately. Support authority, cover/deputies, escalation and effective dates through existing work/ownership controls. Confirm roles rather than hard-coding historic individuals.

4. Represent rate cards, margin definitions, contract inclusions, quote validity, evidence requirements and communication schedules as versioned policies with business owners and precedence. Keep technical document wording separate from executable policy.

5. Expose concise review/correction in existing company, LEARN and Protocol-related surfaces. A missing approver or unresolved policy must make the relevant decision unavailable, not grant authority to the model or OpenFolk operator.

## Acceptance checks

- A policy conflict remains visible until authorised resolution, and older decisions retain the version used.
- Recurring revenue, concentration and margin metrics have explicit definitions and denominators.
- Absence cover and revoked authority behave correctly without impersonation.
- One customer-specific exception cannot change the company default or another tenant.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No invented org chart, inferred policy approval, automated legal judgement, employment decision or client pricing change.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

Reviewed strategy/role/policy model, unresolved decision list and evidence-backed authority cases.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
