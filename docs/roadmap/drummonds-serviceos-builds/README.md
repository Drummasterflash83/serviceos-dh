# Drummonds and reusable ServiceOS — staged build prompts

**Planning pack only. No stage has been activated or accepted by creating these files.**
Prepared 13 October 2026 from the full planning conversation, client handover,
New Dawn sources and the current main-build evidence.

## Start here

This pack turns the agreed direction into **24 individually runnable prompts**.
They are delivery stages, not 24 new product modules.

1. Begin with [Build 00: current-build and outcome audit](00-current-build-and-outcome-audit.md).
2. Read the [shared contract](BUILD-CONTRACT.md), [decisions and sources](DECISIONS-AND-SOURCES.md)
   and [coverage matrix](COVERAGE-MATRIX.md).
3. Execute one selected stage at a time, with its dependencies satisfied. Capture
   its actual result using the [receipt template](RECEIPT-TEMPLATE.md).
4. Complete the broader [LEARN acceptance gate](LEARN-ACCEPTANCE.md) at Build 10
   before implementing Part 2.
5. Revisit later priorities when measured evidence changes them. Preserve the
   LEARN-first gate and record the reason for any sequencing/scope change.

Suggested instruction when you are ready:

> Run Build 00 from docs/roadmap/drummonds-serviceos-builds/00-current-build-and-outcome-audit.md.
> Follow BUILD-CONTRACT.md. Inspect the latest main build and evidence first.
> Produce the existing-work matrix and outcome contracts. This stage is a read-only
> product audit with documentation outputs only. Stop after its receipt.

For a later stage, select that file explicitly. The file includes its own brief,
required shared context, prerequisites, reuse anchors, outcome, scope, checks and
stopping conditions. Keep this folder together; a copied file alone still needs
BUILD-CONTRACT.md and the referenced sources/receipts. The repository and exact
current user instructions remain authoritative.

## What success means

The business should become easier to run and better at delivering sustainable value:
correct charging and collection, profitable recurring relationships, better customer
service, less rework and avoidable administration, and less founder dependence.
Quality, safety, customer commitments and staff workload constrain optimisation.

Each stage must first state what already works and what is missing. Its outcome
contract names the owner, baseline/source, measurement, target, observation period
and guardrails. Code completion and a green test suite establish technical outputs;
business benefit needs separate evidence. A blocked provider approval or unmeasured
baseline cannot become a fictional success.

## Part 1: LEARN before operational improvement

Builds 00–10 establish reliable inputs, connected company records, strategy/authority,
operational and financial meaning, reviewable knowledge, observed process journeys
and improvement priorities. Assets, contracts, obligations and financial links belong
here as evidence/model foundations. Their operational uses come in Part 2.

The current LEARN V1 checklist remains its own delivery authority. Build 00 checks
what has already been built; Build 01 finishes only its remaining obligations.
This broader company-understanding scope must not retroactively turn completed V1
features into new work or make uncompleted V1 requirements disappear.

'Complete' means the reviewed company scope passes defined checks. It does not mean
all possible historical data has been collected or the company can never change.

## Part 2: improve the company's operation

Builds 11–19 use the accepted understanding for completion, quotes, contracts, cash,
assets, readiness, documents and scheduling assistance. Start with internal work and
reviewed drafts, maintaining existing systems of record.

Build 20 adds one precisely scoped execution capability at a time, through the
existing executor. It can finish with a tested capability disabled pending approval.
Additional capabilities require their own execution/activation receipt; one approval
never activates every workflow.

Builds 21–23 measure improvements, prove the Drummonds journey and package the same
capabilities for future clients. A sandbox or second synthetic tenant proves only
its stated scope; it is not LIVE provider or new-client acceptance.

## Run order and dependencies

The numbered order is the default human run order. The dependency column captures
the minimum prerequisite graph; all Part 2 builds also require an accepted, current
Build 10. Do not start parallel agents/chats or jump ahead without explicit direction.

| Build | Outcome-focused stage | Prerequisites |
|---|---|---|
| [00](00-current-build-and-outcome-audit.md) | Reconcile the main build and agree outcome contracts | Start |
| [01](01-finish-current-learn-v1.md) | Finish and protect the existing LEARN V1 foundation | 00 |
| [02](02-source-scope-and-coverage.md) | Account for company information and its limits | 01 |
| [03](03-connected-company-records.md) | Connect the company without guessing identities | 02 |
| [04](04-strategy-roles-and-business-rules.md) | Understand strategy, ownership and commercial policy | 03 |
| [05](05-operational-evidence-and-obligations.md) | Bring visits, contracts, assets and opportunities into LEARN | 03, 04 |
| [06](06-finance-time-and-outcome-baselines.md) | Establish reconciled financial and time baselines | 04, 05 |
| [07](07-knowledge-extraction-and-local-ai.md) | Turn documents and conversations into reviewable knowledge | 02, 03, 04, 05, 06 |
| [08](08-observed-process-and-friction.md) | Reconstruct how work flows and where it gets stuck | 05, 06, 07 |
| [09](09-improvement-discovery-and-outcomes.md) | Prioritise improvements by evidence and business outcome | 04, 06, 08 |
| [10](10-learn-foundation-acceptance-gate.md) | Prove LEARN understands the agreed company scope | 01, 02, 03, 04, 05, 06, 07, 08, 09 |
| [11](11-visit-completion-and-commercial-control.md) | Resolve completed work into clear commercial outcomes | 10 |
| [12](12-further-works-and-quote-conversion.md) | Turn evidenced opportunities into customer decisions | 11 |
| [13](13-contract-delivery-renewal-and-account-value.md) | Protect contract delivery and grow valuable relationships | 11, 12 |
| [14](14-debtor-cost-and-cash-control.md) | Resolve cash and cost exceptions using accounting evidence | 11, 13 |
| [15](15-asset-lifecycle-and-capital-planning.md) | Create a useful asset lifecycle service | 12, 13 |
| [16](16-people-qualifications-and-contractor-readiness.md) | Make competence and contractor readiness dependable | 11, 13 |
| [17](17-parts-stock-and-procurement-readiness.md) | Connect parts evidence to work and cost | 11, 12 |
| [18](18-technical-and-customer-evidence-packs.md) | Prepare consistent reviewed documents from shared evidence | 11, 12, 13, 15, 16 |
| [19](19-capacity-and-scheduling-assistance.md) | Make delivery readiness and capacity actionable | 13, 15, 16, 17 |
| [20](20-governed-external-action-capabilities.md) | Prove controlled execution before enabling external actions | 11, 12, 13, 14, 18, 19 |
| [21](21-continuous-improvement-and-leadership.md) | Turn outcomes into sustained company improvement | 20 |
| [22](22-drummonds-end-to-end-acceptance.md) | Accept the connected Drummonds operating journey | 15, 16, 17, 18, 19, 20, 21 |
| [23](23-future-client-onboarding-and-product-proof.md) | Prove the developments form a reusable ServiceOS product | 22 |

## Evidence, status and checkpoints

[TRACKER.md](TRACKER.md) tracks this pack's execution receipts only. Every row begins
NOT STARTED even where substantial implementation already exists: this is not a
claim that ServiceOS has no working capability. Build 00 reconciles that distinction.

A receipt records DOCUMENT REVIEW, LOCAL, ISOLATED DB, TEST and LIVE evidence separately,
plus human acceptance and whether business benefit is observing, evidenced or unknown.
A stage needing provider acceptance cannot pass because local tests pass.

Use the existing main-build release and preservation procedures. Checkpoint to
`codex/learn-v1-test` without history rewrites as required by AGENTS.md; that branch
does not automatically deploy. This planning request authorises no runtime changes.

## Intentionally deferred

No replacement accounting/ERP/diary, broad workflow builder, speculative predictive
maintenance, autonomous pricing/payments/payroll, sensor programme, public customer
portal or indiscriminate agent fleet. These can become later proposals if evidence
establishes value. Existing working Perplexity processes are not retired automatically.

No universal fixed delivery dates or financial savings are promised. Resolve actual
source coverage, business ownership and policy gaps through the staged reviews.
