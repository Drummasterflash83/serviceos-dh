# Build 05 — Bring visits, contracts, assets and opportunities into LEARN

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 1: LEARN foundation.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Read-only provider inputs; internal evidence/model extensions.
- Prerequisites: [Build 03](03-connected-company-records.md), [Build 04](04-strategy-roles-and-business-rules.md)

## Outcome to achieve

LEARN can explain what was promised and delivered across representative operational journeys.

Before implementation, define the accountable role, source-backed baseline (or
explicitly unknown baseline), measurement and denominator, acceptance condition,
observation period and quality/customer/staff guardrails. Agree unresolved business
definitions through the existing review path; do not invent a financial benefit.

## First inspect and reuse

Read the current user instructions, AGENTS.md, [decisions/sources](DECISIONS-AND-SOURCES.md),
[tracker](TRACKER.md), prerequisite receipts and current delivery evidence.
Inspect the following starting points and their actual callers/tests/runtime.
These are anchors, not an instruction to replace their contents:

- `supabase/functions/_shared/commusoft/read_page.ts`
- `supabase/functions/_shared/commusoft/source_records.ts`
- `supabase/functions/_shared/commusoft/worker.ts`
- `docs/architecture/canonical-entity-and-health-map.md`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Discover the actual supported API/export capabilities for visits/diaries, time, assignments, estimates, contract scope, assets, job parts, purchase references, certificates and service reminders. An existing jobs connection is not proof of these resources.

2. Extend existing tenant-scoped adapters in bounded entity slices. Verify provider documentation/current access before choosing endpoints; preserve limits, pagination, change/deletion semantics and source versions. Use approved exports where necessary.

3. Map operational records to Build 03 entities and Build 04 policies. Represent contract/service obligations with subject, scope, due time, accountable role and required evidence. Retain original documents and source-level authority.

4. Separate physical delivery, invoice readiness, approved FOC, contract inclusion, future opportunity and payment state. Represent multi-visit jobs, partial work, variations and multiple simultaneous outcomes without duplicating the underlying work.

5. Assemble read-only customer/site/job/asset/contract views. Identify missing fields and stale links, with no provider writes or automatic customer/engineer chases. Basic contract facts can be human-reviewed; AI extraction arrives in Build 07.

## Acceptance checks

- One routine visit, included visit, partial job and further-works case trace through original source records.
- Replayed imports do not duplicate visits, obligations or assets; corrections retain history.
- A contract-included visit with missing standard hours is not classified as lost billing.
- A missing certificate or PO follows the approved contract rule and shows uncertainty where policy is unresolved.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No replacement diary, stock system or document authoring; no inferred installation dates, asset condition or accepted scope.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

Operational source capability matrix, bounded adapters and verified as-is obligation journeys.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
