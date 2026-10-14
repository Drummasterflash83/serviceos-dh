# Build 23 — Prove the developments form a reusable ServiceOS product

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 2: operational improvement.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Reusable onboarding and isolated second-client proof.
- Prerequisites: [Build 22](22-drummonds-end-to-end-acceptance.md)
- The accepted [Build 10](10-learn-foundation-acceptance-gate.md) LEARN gate is also mandatory and must still be valid.

## Outcome to achieve

The next client can adopt the same capabilities through configuration and evidence-led onboarding rather than a bespoke fork.

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
- `src/lib/capability-registry.ts`
- `src/lib/client-workspace-nav.ts`
- `src/lib/openfolk-workspace-nav.ts`
- `docs/architecture/06_LEARNING_CENTRE.md`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Review all stages for Drummonds-specific assumptions, names, codes, policies and UI. Keep shared capability code separate from versioned industry templates and tenant configuration. Do not move private content into global defaults.

2. Package onboarding around business goals, source inventory, identity review, authority, metric definitions, baseline, LEARN acceptance and staged capability activation. Missing provider data disables dependent claims clearly.

3. Prove an isolated synthetic second tenant with different terminology, roles, contract rules, financial provider-shaped inputs and asset types. Use approved import fixtures/adapters; do not claim a real Xero/other connection without provider acceptance.

4. Reuse existing OpenFolk client selection, module controls, health, diagnostics, audit and recovery. No impersonation, customer-profile switching or copied credentials. Test tenant isolation through search, generated artifacts, caches and local AI work.

5. Create understandable versioned configuration and upgrade behaviour with rollback. Avoid a general workflow editor until repeated real requirements justify it. Clearly label reusable engineering improvements versus private client learning.

6. Document onboarding evidence, support effort and operating cost; identify which additional provider/industry work a real next client would need. A synthetic proof establishes portability, not universal market readiness.

## Acceptance checks

- Equivalent capabilities run without a Drummonds branch or a cloned application.
- Provider-shaped fixtures cannot be mistaken for a live connection.
- No raw financial/customer data, private template or derived memory crosses clients.
- Disabled modules, version upgrade, source revocation and client offboarding preserve the agreed access/retention boundaries.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No actual new customer onboarding, new commercial commitments, blanket industry compliance claim or cross-client training.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

Reusable onboarding/acceptance pack, isolated portability proof and explicit remaining provider/industry dependencies.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
