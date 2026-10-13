# Build 02 — Account for company information and its limits

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 1: LEARN foundation.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Extend the shared source inventory and coverage controls.
- Prerequisites: [Build 01](01-finish-current-learn-v1.md)

## Outcome to achieve

OpenFolk and Drummonds can tell what the company model knows, what it misses and which decisions the available evidence can support.

Before implementation, define the accountable role, source-backed baseline (or
explicitly unknown baseline), measurement and denominator, acceptance condition,
observation period and quality/customer/staff guardrails. Agree unresolved business
definitions through the existing review path; do not invent a financial benefit.

## First inspect and reuse

Read the current user instructions, AGENTS.md, [decisions/sources](DECISIONS-AND-SOURCES.md),
[tracker](TRACKER.md), prerequisite receipts and current delivery evidence.
Inspect the following starting points and their actual callers/tests/runtime.
These are anchors, not an instruction to replace their contents:

- `docs/architecture/source-adapter-pattern.md`
- `src/lib/learn-operator-inputs.ts`
- `src/lib/learn-operator-capture-controls.ts`
- `src/lib/learn-measurement-receipts.ts`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Inventory relevant systems and documents across operations, finance, contracts, assets, people, stock and strategy. Include the existing download and Monday reports. Distinguish available, approved, unsupported, missing and deliberately excluded sources.

2. Create or extend the source scope register required by LEARN-ACCEPTANCE.md: provider/account, entity/fields, history window, freshness, source authority, owner, access, eligibility, denominator and downstream purpose. Reuse current registries rather than creating a second inventory.

3. Map every retained source to captured, processed, linked, reviewed and usable coverage. Provide numerator/denominator and ambiguous/unmatched/stale populations. A successful no-op poll must remain distinguishable from new useful evidence.

4. Implement or complete bounded refresh, source update/withdrawal propagation and operator diagnostics for in-scope sources. Provide explicit reconciliation for pagination, duplicates and unsupported records. Approved exports are permitted with a visible cadence and limitation.

5. Make freshness and missing prerequisites actionable in existing LEARN/operator screens. Extend read-time access checks to dependent summaries and metrics; preserve authorised private-channel visibility and exclude DMs.

## Acceptance checks

- Coverage never reports 100% by excluding failed or unmatched records silently.
- Changed/revoked/deleted source evidence invalidates or restricts dependent results according to the approved retention policy.
- A source can be healthy while business coverage is incomplete, and the UI communicates both correctly.
- A second synthetic tenant can configure different sources, windows and authority without code branching.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No indiscriminate ingestion of all mail/HR/location records, new shadow archive or claim that every provider capability is accessible.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

Versioned source scope/coverage register and verified operator/client explanations of important gaps.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
