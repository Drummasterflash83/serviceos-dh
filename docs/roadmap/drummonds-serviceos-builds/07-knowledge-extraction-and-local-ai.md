# Build 07 — Turn documents and conversations into reviewable knowledge

Status: NOT STARTED in this pack. Existing capabilities may already satisfy parts;
inspect them before making changes. Part 1: LEARN foundation.

## Activation and prerequisite

Run only when Chris explicitly selects this stage. Creating, reading or attaching
this file for planning is not permission to implement. Execute this stage only,
then stop. Read [BUILD-CONTRACT.md](BUILD-CONTRACT.md) in full; it governs this prompt.

- Mode: Bounded extraction and local-AI evaluation; no business actions.
- Prerequisites: [Build 02](02-source-scope-and-coverage.md), [Build 03](03-connected-company-records.md), [Build 04](04-strategy-roles-and-business-rules.md), [Build 05](05-operational-evidence-and-obligations.md), [Build 06](06-finance-time-and-outcome-baselines.md)

## Outcome to achieve

Useful business facts and commitments can be found and corrected without repeatedly rereading whole documents or paying to reprocess unchanged inputs.

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
- `docs/architecture/04_AI_ARCHITECTURE.md`
- `docs/architecture/06_LEARNING_CENTRE.md`
- `supabase/functions/_shared/openai.ts`
- `src/lib/learn-card-brief.ts`

Produce an existing-work matrix: requirement, implementation, verified environment,
evidence, remaining gap and reuse/extension. If a requirement is already accepted
and still valid, preserve it. Choose the smallest change that advances the outcome.

## Work within this stage

1. Inspect the existing evidence, transcription, knowledge and extraction paths. Add governed source-document intake/versioning where missing; keep originals and derived assertions distinct. Search results respect source visibility and withdrawn access.

2. Extract candidate facts, contract clauses, commitments and evidence links into schema-validated proposals with source spans and versioned extractor/prompt identity. Treat embedded instructions as source text, including adversarial prompts.

3. Use deterministic parsers/templates first. Create a replaceable processing adapter for local/cloud/manual modes within existing job orchestration. Cache by source/content/configuration version and process changes rather than entire company history repeatedly.

4. Benchmark authorised local transcription/extraction/retrieval on engineering terminology, noisy audio, serials, incomplete tables and conflicting documents. Measure accuracy/abstention, correction effort, latency, throughput and total cost. Do not install models, buy hardware or enable new provider calls without applicable authority.

5. If an approved local worker is available, use bounded authenticated work leases and tenant-scoped access; local failure remains visible and recoverable. No public model endpoint or silent cloud fallback. If unavailable, retain a manual/approved existing path and record the exact unverified capability.

6. Keep money calculations and policy approvals outside model outputs. Do not train/fine-tune on QuickBooks data or silently add accounting records to an AI pipeline.

## Acceptance checks

- Prompt injection cannot cause a tool action, policy change or disclosure.
- A fact has inspectable source evidence; unknown/conflicting fields remain so.
- Reprocessing and corrections do not duplicate facts, and access withdrawal is enforced through derived search/results.
- Compare local and approved alternatives using the same reviewed evaluation set; no local-readiness claim from a mocked adapter.

Apply the shared contract's proportionate verification, preservation and release
requirements as well. A passed code test is not proof of a business outcome. If
real data, elapsed observation or human acceptance is missing, record the exact
limit and leave dependent claims unavailable.

## Boundaries and stopping conditions

No 'AI knows the entire company' claim, autonomous agents, uncontrolled RAG corpus, new public inference service or provider/model purchase.

Stop dependent work when a prerequisite, source authority, business rule or necessary
approval is missing. Continue independent preparation already authorised. Do not
change scope or acceptance thresholds simply to obtain a PASS. Do not execute the
next numbered prompt automatically.

## Required delivery

Extraction/retrieval acceptance evidence, correction UX and a measured local-processing decision with honest fallback limits.

Use [RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md); update this stage in
[TRACKER.md](TRACKER.md) with the actual environment, evidence and remaining work.
Record technical acceptance separately from observed business outcome. Back up
meaningful authorised checkpoints per AGENTS.md, verify the remote head and report
**Working and verified**, **Needs finishing**, **Blocked externally**.
