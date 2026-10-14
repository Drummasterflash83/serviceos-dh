# Build 03 — Connect the company without guessing identities

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 1: LEARN foundation.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Extend canonical relationships and review.
- Prerequisites: [Build 02](02-source-scope-and-coverage.md)

## Outcome to achieve

A user can trace relevant evidence to the right customer, person, site and work without duplicates or false associations.

Before implementation, define the accountable role, source-backed baseline (or
explicitly unknown baseline), measurement and denominator, acceptance condition,
observation period and quality/customer/staff guardrails. Agree unresolved business
definitions through the existing review path; do not invent a financial benefit.

## First inspect and reuse

Read the current user instructions, AGENTS.md, [decisions/sources](DECISIONS-AND-SOURCES.md),
[tracker](TRACKER.md), prerequisite receipts and current delivery evidence.
Inspect the following starting points and their actual callers/tests/runtime.
These are anchors, not an instruction to replace their contents:

- `docs/architecture/03_BUSINESS_GRAPH.md`
- `docs/architecture/canonical-entity-and-health-map.md`
- `src/lib/learn-projection-review.ts`
- `src/lib/learn-customer-business-context.ts`
- `src/lib/learn-identity-review.ts`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Inspect current canonical tables, source-link models, identity reviews and graph projections. Extend existing ownership instead of introducing a parallel company database.

2. Define stable identities and typed links for customer, contact, site, staff, contractor company/operative, job, visit, contract, asset, opportunity and financial source record. Add only foundations required by the agreed scope; projection nodes alone do not replace validated domain records.

3. Preserve source-specific identifiers and reviewed crosswalks. Distinguish a service code from a unique job number, a shared office endpoint from a person, and site ownership from customer billing identity.

4. Provide ambiguity review, merge/link correction history and safe propagation. Do not infer financial customer links from fuzzy names or email alone. Newly acquired evidence does not overwrite a verified identity silently.

5. Deepen current cards with source-backed relationships, search and usable pagination. Quantify matching coverage and stale links; ordinary client isolation and logged operator selection apply to every linked object.

## Acceptance checks

- Shared reception numbers, aliases, duplicate names and cross-company sites do not cause automatic merges.
- Leading-zero codes and original provider references survive ingestion and display.
- A reviewed correction updates dependent projections without erasing provenance.
- Representative large customer histories remain usable; a different tenant/provider fixture works.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No new CRM, broad automatic identity merge, imagined entity facts or cross-tenant knowledge sharing.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

Canonical relationship contract, reviewed sample journeys, correction/replay proof and unresolved-link counts.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
