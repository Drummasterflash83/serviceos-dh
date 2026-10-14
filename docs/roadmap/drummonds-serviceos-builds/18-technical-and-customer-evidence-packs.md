# Build 18 — Prepare consistent reviewed documents from shared evidence

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 2: operational improvement.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Internal document preparation and approval.
- Prerequisites: [Build 11](11-visit-completion-and-commercial-control.md), [Build 12](12-further-works-and-quote-conversion.md), [Build 13](13-contract-delivery-renewal-and-account-value.md), [Build 15](15-asset-lifecycle-and-capital-planning.md), [Build 16](16-people-qualifications-and-contractor-readiness.md)
- The accepted [Build 10](10-learn-foundation-acceptance-gate.md) LEARN gate is also mandatory and must still be valid.

## Outcome to achieve

The team prepares accurate evidence packs with less repeated copying while preserving technical judgement and customer-specific requirements.

Before implementation, define the accountable role, source-backed baseline (or
explicitly unknown baseline), measurement and denominator, acceptance condition,
observation period and quality/customer/staff guardrails. Agree unresolved business
definitions through the existing review path; do not invent a financial benefit.

## First inspect and reuse

Read the current user instructions, AGENTS.md, [decisions/sources](DECISIONS-AND-SOURCES.md),
[tracker](TRACKER.md), prerequisite receipts and current delivery evidence.
Inspect the following starting points and their actual callers/tests/runtime.
These are anchors, not an instruction to replace their contents:

- `docs/architecture/EVIDENCE-LAYER-V1.md`
- `supabase/functions/_shared/connectors/index.ts`
- `src/lib/command-work.ts`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Inventory current approved report/quote/contract/RAMS/SFG20/O&M/certificate templates, terms and required fields. Resolve incompatible versions with the authorised owner; retrieve unavailable source assets before reproducing exact outputs.

2. Create a shared evidence-pack assembly capability using existing storage, source links, work and approval paths. Branding and industry templates are configuration, not separate generators per customer.

3. Fill deterministic fields directly from reviewed records. AI may draft narrative only within approved extraction/data boundaries; unsupported technical statements remain missing or under review.

4. Bind each artifact to source, policy and template versions. Preserve originals and regenerate as a new version after corrections; make superseded artifacts visibly obsolete.

5. Render and inspect all issued-format pages, validate totals/mandatory sections/attachments and maintain accessible layouts. Distinguish prepared, internally approved, customer-issued and acknowledged.

6. Let engineers, technical reviewers and finance see exactly what is missing. Group missing-input requests and require the appropriate technical approval before any client-facing use.

## Acceptance checks

- A missing mandatory section or mismatched total blocks approval; no fabricated fields fill the gap.
- An old approved pack is invalidated or flagged after a material underlying change.
- Source visibility applies to attached evidence and generated exports.
- Rendered PDF/document checks detect truncation, missing terms and broken multi-page tables.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No automatic customer issue, AI safety certification, unlicensed standard reproduction or replacement of a qualified person's sign-off.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

Versioned shared pack assembly and reviewed sample documents with rendering/evidence proof.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
