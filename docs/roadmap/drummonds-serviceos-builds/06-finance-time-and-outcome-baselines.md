# Build 06 — Establish reconciled financial and time baselines

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 1: LEARN foundation.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Complete authorised read-only finance/time evidence and deterministic measures.
- Prerequisites: [Build 04](04-strategy-roles-and-business-rules.md), [Build 05](05-operational-evidence-and-obligations.md)

## Outcome to achieve

Drummonds can reproduce the numbers used to judge leakage, contract economics and future improvement.

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
- `src/lib/learn-performance-measurements.ts`
- `src/lib/learn-working-time.ts`
- `supabase/functions/_shared/intelligence/objective_evaluation.ts`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Continue the existing QuickBooks work from fresh evidence. Separate local, sandbox, provider lifecycle, LIVE company authorisation, imported coverage and reconciled acceptance. Do not create a competing app, connector or ledger.

2. Obtain authorised payroll/timecard, attendance, contract-hour and cost-allocation evidence needed for agreed measures. Preserve source definitions; on-site time does not determine paid hours automatically. Restricted employee data stays role-appropriate.

3. Build explicit reviewed customer/job/invoice/payment/credit/cost links. Preserve original codes, one-to-many relationships, dates and currency. A partial query or missing invoice cannot establish payment.

4. Define and calculate revenue, receivables, collection, WIP evidence, allocation completeness, quote/actual margin, contract economics and hours on an agreed basis. Missing direct costs make margin incomplete. Avoid subtracting payments twice from an already-net balance.

5. Rebuild priority leak claims from record lists rather than copying historical figures. Separate recoverable cash, potential sales, accounting corrections and avoided future cost. Establish baseline periods and outcome measurement contracts before interventions.

## Acceptance checks

- Reconcile counts/totals with authoritative source reports on the same basis; explain residuals.
- Handle partial payment, credit, void, duplicate reference, mixed currency, unallocated cost and delayed posting.
- Approved payroll/hours reconciliation reproduces independently; PPM and contractor classifications do not distort staff measures.
- Every surfaced actual links to source and calculation; missing LIVE acceptance keeps financial claims unavailable.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No accounting writes, wage changes, automatic FOC/write-offs, fabricated savings, AI financial arithmetic or payroll-engine replacement.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

Finance/time reconciliation pack, versioned metric definitions and a trustworthy baseline with explicit exclusions.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
