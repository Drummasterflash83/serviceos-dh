# Build 20 — Prove controlled execution before enabling external actions

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 2: operational improvement.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Capability-specific execution infrastructure; disabled by default.
- Prerequisites: [Build 11](11-visit-completion-and-commercial-control.md), [Build 12](12-further-works-and-quote-conversion.md), [Build 13](13-contract-delivery-renewal-and-account-value.md), [Build 14](14-debtor-cost-and-cash-control.md), [Build 18](18-technical-and-customer-evidence-packs.md), [Build 19](19-capacity-and-scheduling-assistance.md)
- The accepted [Build 10](10-learn-foundation-acceptance-gate.md) LEARN gate is also mandatory and must still be valid.

## Outcome to achieve

An explicitly approved action can execute once, against current facts, with a verifiable result and recoverable failure handling.

Before implementation, define the accountable role, source-backed baseline (or
explicitly unknown baseline), measurement and denominator, acceptance condition,
observation period and quality/customer/staff guardrails. Agree unresolved business
definitions through the existing review path; do not invent a financial benefit.

## First inspect and reuse

Read the current user instructions, AGENTS.md, [decisions/sources](DECISIONS-AND-SOURCES.md),
[tracker](TRACKER.md), prerequisite receipts and current delivery evidence.
Inspect the following starting points and their actual callers/tests/runtime.
These are anchors, not an instruction to replace their contents:

- `supabase/functions/_shared/connectors/index.ts`
- `supabase/functions/_shared/intelligence/automation_guards.ts`
- `supabase/functions/_shared/work_authority.ts`
- `docs/architecture/02_CORE_LOOP.md`
- `docs/DEPLOYMENT.md`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Start with one named capability justified by the accepted backlog, such as preparing a provider draft. Inspect existing adapters and executor; extend them rather than building another agent/automation engine.

2. Define exact read/write scopes, recipients/record types, immutable parameters, tenant binding, policy/approval version, idempotency, stale-source limits, expected provider receipt and outcome verification. Separate creating a draft from sending/issuing.

3. Implement disabled capability registration, local/sandbox contract tests and execution-time authority/freshness rechecks. Handle uncertain external responses through read-back/status lookup; no blind retries or success claims.

4. Prepare a concrete activation package with exact environment, tenant, capability, authority, volume/time limits, monitoring, pause/revoke and compensation/rollback plan. Identify irreversible effects honestly.

5. Inspect current user and business authority for that exact operation. Reuse existing authorisation if it covers it; otherwise leave disabled and request only the concrete missing approval after preparatory work is complete. Selecting this build does not authorise sending to customers, posting accounting entries or purchases.

6. Where the business requires four consecutive weeks of shadow accuracy, collect actual evidence over time and the named approval. Replay alone cannot satisfy that gate. Keep high-consequence actions at review level unless separately authorised.

## Acceptance checks

- Duplicate events, race, revoked grant, changed invoice balance, dispute and changed quote version cannot produce an inappropriate action.
- Timeout after provider success reconciles safely rather than blindly reissuing.
- Capability kill switch and source access withdrawal stop new actions without erasing history.
- Runtime success, provider confirmation, customer outcome and business benefit are recorded separately.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No blanket activation, autonomous payments/payroll/credits/write-offs, hidden sends, general-purpose agent swarm or inferred approval.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

One precisely scoped execution capability with acceptance evidence; activation state and any outstanding approval explicitly recorded.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
