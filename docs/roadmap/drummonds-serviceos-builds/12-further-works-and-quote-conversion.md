# Build 12 — Turn evidenced opportunities into customer decisions

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 2: operational improvement.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Internal quote workflow and reviewed drafts.
- Prerequisites: [Build 11](11-visit-completion-and-commercial-control.md)
- The accepted [Build 10](10-learn-foundation-acceptance-gate.md) LEARN gate is also mandatory and must still be valid.

## Outcome to achieve

More suitable engineering findings reach timely, correctly priced customer decisions without duplicate quotes or repeated preparation.

Before implementation, define the accountable role, source-backed baseline (or
explicitly unknown baseline), measurement and denominator, acceptance condition,
observation period and quality/customer/staff guardrails. Agree unresolved business
definitions through the existing review path; do not invent a financial benefit.

## First inspect and reuse

Read the current user instructions, AGENTS.md, [decisions/sources](DECISIONS-AND-SOURCES.md),
[tracker](TRACKER.md), prerequisite receipts and current delivery evidence.
Inspect the following starting points and their actual callers/tests/runtime.
These are anchors, not an instruction to replace their contents:

- `supabase/functions/_shared/work_transition.ts`
- `supabase/functions/_shared/connectors/index.ts`
- `src/lib/learn-work-delays.ts`
- `docs/architecture/07_PROTOCOL.md`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Inspect existing quote/opportunity capability and the accepted improvement evidence. Retrieve missing golden rules and control files if needed; do not reconstruct them from memory. Treat historic trackers as sources, not mandatory new masters.

2. Link each finding to site, asset, visit and original evidence. Combine repeated observations of the same issue; preserve separate scopes, quote versions and declined/held decisions.

3. Prepare scope, supplier-price requests and quote lines from verified inputs. Apply approved margin/price definitions deterministically. Route technical review and commercial approval to the current authorised roles, including cover.

4. Track identified, priced, approved, sent, accepted, lost, expired, delivered, invoiced and paid separately. Only actual sent/acceptance evidence advances those states. Never substitute the run date for an unknown decision date.

5. Implement configurable working-day follow-up and missing-contact resolution as internal actions/drafts. Disputes, holds, promised decision dates, expiry and duplicate prevention suppress inappropriate progression.

6. After acceptance, create owned booking/parts/customer-update commitments. Capture reasons for loss and stalled conversion, then measure turnaround and conversion on like cohorts.

## Acceptance checks

- Draft creation cannot stamp sent, chased or accepted dates.
- Shared/blank email, duplicate intake, expired quote, version change, bank holiday/DST and customer hold cases behave correctly.
- Quote total agrees with approved provider proposal/source and version; missing cost means unassessed margin.
- A second tenant uses different stages/terminology without changes to shared code.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No automatic sends, autonomous prices, invented failure costs/asset life, Trello clone or unapproved provider writes.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

A source-to-decision quote journey, reviewed drafts and evidence-backed conversion measures.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
