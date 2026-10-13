# Build 13 — Protect contract delivery and grow valuable relationships

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 2: operational improvement.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Contract coordination, renewal preparation and review.
- Prerequisites: [Build 11](11-visit-completion-and-commercial-control.md), [Build 12](12-further-works-and-quote-conversion.md)
- The accepted [Build 10](10-learn-foundation-acceptance-gate.md) LEARN gate is also mandatory and must still be valid.

## Outcome to achieve

Customers receive the service and communication promised, while Drummonds can prepare informed renewals and judge relationship economics.

Before implementation, define the accountable role, source-backed baseline (or
explicitly unknown baseline), measurement and denominator, acceptance condition,
observation period and quality/customer/staff guardrails. Agree unresolved business
definitions through the existing review path; do not invent a financial benefit.

## First inspect and reuse

Read the current user instructions, AGENTS.md, [decisions/sources](DECISIONS-AND-SOURCES.md),
[tracker](TRACKER.md), prerequisite receipts and current delivery evidence.
Inspect the following starting points and their actual callers/tests/runtime.
These are anchors, not an instruction to replace their contents:

- `src/lib/learn-customer-business-context.ts`
- `src/lib/learn-quickbooks-finance.ts`
- `supabase/functions/_shared/intelligence/objectives.ts`
- `src/lib/command-work.ts`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Build on LEARN's approved contract, asset, obligation and finance records. Inspect existing contract/renewal work before adding fields. Retain one authoritative source for each domain and explicit synchronisation responsibility.

2. Connect contract scope and versions to assets, included visits, exclusions, response commitments, billing schedule and renewal terms. Detect agreements that appear accepted but are not operationally active, without silently activating them.

3. Show due versus delivered obligations, missing evidence and customer promises. Escalate service failures or communication gaps to an accountable relationship owner with cover.

4. Prepare renewal packs with service history, unresolved issues, reviewed asset recommendations and proposed terms. Model lead times as client policy; preserve contract-specific notice periods and customer decisions.

5. Calculate contract/account economics from evidenced revenue and allocated direct costs; show cost completeness and separately labelled support-effort estimates. Do not equate invoicing with earned revenue or classify included visits as free work.

6. Support PPM/Property Care product definitions and suitable expansion opportunities as tenant configuration. Measure retention by explicit cohort, contracted recurring income by approved definition and customer concentration with separate denominators.

## Acceptance checks

- Changed scope, mid-term amendment, cancellation, renewal overlap and multi-site assets do not double-count recurring income.
- Missing delivery evidence shows as unevidenced, not automatically non-delivery or compliance.
- An account with incomplete cost allocation cannot display a definitive profitability ranking.
- Accepted quote/customer-update commitments persist through scheduling and handover.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No automatic renewals, legal terms generation from assumptions, autonomous price changes or customer portal launch.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

Contract-delivery and renewal views, a reviewed renewal pack and account-economics measures with limitations.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
