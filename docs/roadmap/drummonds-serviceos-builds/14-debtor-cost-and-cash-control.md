# Build 14 — Resolve cash and cost exceptions using accounting evidence

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 2: operational improvement.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Finance coordination and draft-only customer communication.
- Prerequisites: [Build 11](11-visit-completion-and-commercial-control.md), [Build 13](13-contract-delivery-renewal-and-account-value.md)
- The accepted [Build 10](10-learn-foundation-acceptance-gate.md) LEARN gate is also mandatory and must still be valid.

## Outcome to achieve

Finance spends less time assembling chase information and avoids chasing paid, disputed or incorrectly classified invoices.

Before implementation, define the accountable role, source-backed baseline (or
explicitly unknown baseline), measurement and denominator, acceptance condition,
observation period and quality/customer/staff guardrails. Agree unresolved business
definitions through the existing review path; do not invent a financial benefit.

## First inspect and reuse

Read the current user instructions, AGENTS.md, [decisions/sources](DECISIONS-AND-SOURCES.md),
[tracker](TRACKER.md), prerequisite receipts and current delivery evidence.
Inspect the following starting points and their actual callers/tests/runtime.
These are anchors, not an instruction to replace their contents:

- `docs/operations/LEARN-QUICKBOOKS-INTEGRATION.md`
- `src/lib/learn-quickbooks-finance.ts`
- `src/lib/command-work.ts`
- `supabase/functions/_shared/connectors/index.ts`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Reuse the accepted finance baseline and existing connector. Verify current completeness before evaluating debt or stage progression; account for credits, voids, payments, remittances and cross-provider timing differences.

2. Configure the approved debtor sequence, account grouping, minimum balance, contact preferences, holds and promise-to-pay rules. Distinguish a customer query, unresolved dispute, recorded call and actual communication delivery.

3. Prepare concise internal finance packs and customer drafts with source-linked balances and documents. Advance chase timing only on evidenced delivery; keep phone prompts distinct from attempted/completed calls.

4. Resolve supplier bills and stock costs against jobs with explicit allocation review. Surface late costs on closed work and completed-but-uninvoiced evidence without automatically changing accounting, payment or WIP treatment.

5. Route exceptions to finance with cover and retain reasons for every hold or adjustment. Customer legal/escalation wording remains approved content; no AI choice of legal position.

6. Measure collection timing, inappropriate-chase prevention, allocation completeness and staff effort separately from new revenue or profit.

## Acceptance checks

- Incomplete pagination or absent invoice cannot mark it paid; reduced balance may be credit rather than cash.
- Partial payment, contested line, account-level promise, expired hold and duplicate run cannot produce inappropriate/duplicate chases.
- Draft, sent and paid states require different evidence and remain independently correct.
- Money totals reconcile by currency/accounting scope with no double subtraction or double-counted benefit.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No external sends, payments, credit/write-off approval, accounting posting, legal escalation or autonomous wage change.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

Reviewed debtor/cost exception workflows, safe drafts and reconciled cash-control outcome measures.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
