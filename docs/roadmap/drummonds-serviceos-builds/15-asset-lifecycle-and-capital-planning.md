# Build 15 — Create a useful asset lifecycle service

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 2: operational improvement.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Pilot asset review and client-pack preparation.
- Prerequisites: [Build 12](12-further-works-and-quote-conversion.md), [Build 13](13-contract-delivery-renewal-and-account-value.md)
- The accepted [Build 10](10-learn-foundation-acceptance-gate.md) LEARN gate is also mandatory and must still be valid.

## Outcome to achieve

Drummonds can offer evidence-backed maintenance and investment planning that supports retention and suitable planned work.

Before implementation, define the accountable role, source-backed baseline (or
explicitly unknown baseline), measurement and denominator, acceptance condition,
observation period and quality/customer/staff guardrails. Agree unresolved business
definitions through the existing review path; do not invent a financial benefit.

## First inspect and reuse

Read the current user instructions, AGENTS.md, [decisions/sources](DECISIONS-AND-SOURCES.md),
[tracker](TRACKER.md), prerequisite receipts and current delivery evidence.
Inspect the following starting points and their actual callers/tests/runtime.
These are anchors, not an instruction to replace their contents:

- `docs/architecture/canonical-entity-and-health-map.md`
- `src/lib/learn-customer-business-context.ts`
- `src/lib/command-work.ts`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Select one real pilot and confirm its scope before expanding to three. Reuse asset identity and evidence from LEARN; do not start another spreadsheet/master register.

2. Maintain location, make/model/serial, installation evidence, service history, observed condition, criticality, defects, warranty and linked work. A replacement creates a distinguishable asset/history relationship.

3. Have technical leadership approve condition definitions and recommendations. Condition, expected life and replacement cost require source/basis and uncertainty; generic tables are not facts about an individual asset.

4. Represent maintenance obligations and evidence status using authorised standards/content. Confirm rights and applicable versions before using licensed material such as SFG20/CIBSE; do not manufacture compliance conclusions.

5. Prepare a reviewed site report and five-year capital plan with cost bands, basis, dates, dependencies and customer priorities. Separate proposals from committed spend and confirmed workload.

6. Pass technically approved opportunities into Build 12 and renewal evidence into Build 13. Measure register usefulness/completeness, customer acceptance and actual planned-work decisions, not just assets counted.

## Acceptance checks

- Unknown installation date/serial/condition remains unknown; no document alone proves safe/compliant condition.
- Replaced/duplicate equipment does not inherit another asset's service history incorrectly.
- A technical reviewer can trace every recommendation and reject/adjust it without overwriting evidence.
- One pilot is accepted before wider rollout; projected work is not counted as won or realised revenue.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No sensor programme, unsupported failure prediction, automatic compliance certification or unreviewed customer issue.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

A reviewed pilot register, client-ready draft asset report/capital plan and a measured expansion decision.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
