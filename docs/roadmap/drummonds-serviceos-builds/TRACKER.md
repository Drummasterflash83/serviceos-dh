# Build execution tracker

Latest Build 01 checkpoint (16 October, 20:41 UTC): an exact ten-row older
Email worker and matching scheduler are released in TEST/LIVE. The first
ordinary LIVE batch published ten previously unlinked sources, reducing the
eligible gap from 313 to 303, but its older saved payload prevented settlement.
An exact idle retry payload was corrected after a rollback rehearsal; that
ordinary retry still hit a selector timeout. The selector's internal 200-row
revision window has now been narrowed for ten-row requests in TEST and LIVE,
after rollback rehearsals, synthetic TEST coverage and a read-only LIVE call.
The next ordinary retry settled at 20:13 with ten published sources and a
durable successor; that successor published ten more and continued at 20:14.
The eligible Email gap fell from 303 to 283. Unattended continuation is
verified and kept publishing through 20:40, while complete catch-up and
end-of-backlog behavior remain open. A 200-card LIVE retry hit its lease and
later dead-lettered after partial failures. A 40-card TEST/LIVE worker release
and indexed, counts-preserving card DRAFT lookup then passed rollback and
synthetic TEST checks; three ordinary LIVE 40-card jobs succeeded with zero
failures and a continuation queued by 20:40. Ten cards over an hour without
projection have not yet been reached by that sweep.
An ordinary Graph job settled at 20:07 and a read-only eligible
interaction-to-Graph join fell to zero missing nodes at 20:09.
One archived LIVE Edge route passed combined isolated
database/Auth/REST recovery with a synthetic tenant login and audited operator
boundary. The approved 19:11 Edge source ciphertext was copied to the private
London bucket and independently downloaded and hash-checked; it is a
point-in-time worker v100 package, not the final current runtime. The signed
public Slack reply path, all 160 original handoff cutoffs, ordinary Graph and card
retries and scheduled backup/monitor runs are verified. Use retained labelled
Slack posts and natural activity for freshness; Chris requests no more team
test posts. Historical Slack reconciliation, source-backed job routing and
scoring, final current runtime recovery, signed-in UI review and Chris's
business sign-off remain open. The detailed
[Build 01 receipt](receipts/01-2026-10-14.md) and
[operational checklist](../../operations/LEARN-V1-COMPLETION.md) hold the
timestamped evidence. Build 02 is inactive.

Planning baseline: 13 October 2026. This is not the live product status report.
Creating the original pack executed no numbered prompt. Current execution is
recorded below; existing implementation and runtime acceptance remain distinct
from the documentation audit and its proposed business outcome contracts.

States: NOT STARTED, IN PROGRESS, PARTIAL, BLOCKED, ACCEPTED.
Acceptance includes the required environment and human/provider evidence for that
stage. Only genuine Build 10 acceptance unlocks Part 2. A plan is not acceptance.

| Build | Stage | State | Highest verified environment | Business outcome | Receipt |
|---|---|---|---|---|---|
| 00 | Reconcile the main build and agree outcome contracts | PARTIAL — audit delivered; outcome agreement pending | DOCUMENT REVIEW / LOCAL document validation; dated TEST/LIVE evidence referenced | NOT YET MEASURABLE | [14 October audit](receipts/00-2026-10-14.md) |
| 01 | Finish and protect the existing LEARN V1 foundation | IN PROGRESS — LIVE menu, branding, public Slack evidence browsing and signed Events reply capture are released; 160 plus 20 approved public channels have ongoing capture. Database backup, independent copy/readback, isolated Auth/REST tenant and operator boundaries, one archived Edge authenticated read, and an approved point-in-time Edge source off-site readback pass. Older Email settles and self-continues in ten-row batches; the eligible Graph gap was zero after an ordinary retry. A 40-card worker and indexed DRAFT lookup passed TEST and LIVE checks; three ordinary 40-card continuations succeeded, but ten older unprojected cards remain to be reached. Historical Slack catch-up, post-fix parent freshness from natural activity, complete Email/Phone source coverage, source-backed Commusoft job routing, scoring policy, final current full-runtime recovery, signed-in UI review and Chris’s business sign-off remain open. Chris waived the elapsed full-day wait, not the evidence gates. | ISOLATED DB/AUTH/REST/EDGE, TEST and LIVE bounded released capabilities; full Build 01 acceptance incomplete | OBSERVING — technical and business acceptance remain separate | [Build 01 receipt](receipts/01-2026-10-14.md) |
| 02 | Account for company information and its limits | NOT STARTED | Not assessed | Not assessed | None |
| 03 | Connect the company without guessing identities | NOT STARTED | Not assessed | Not assessed | None |
| 04 | Understand strategy, ownership and commercial policy | NOT STARTED | Not assessed | Not assessed | None |
| 05 | Bring visits, contracts, assets and opportunities into LEARN | NOT STARTED | Not assessed | Not assessed | None |
| 06 | Establish reconciled financial and time baselines | NOT STARTED | Not assessed | Not assessed | None |
| 07 | Turn documents and conversations into reviewable knowledge | NOT STARTED | Not assessed | Not assessed | None |
| 08 | Reconstruct how work flows and where it gets stuck | NOT STARTED | Not assessed | Not assessed | None |
| 09 | Prioritise improvements by evidence and business outcome | NOT STARTED | Not assessed | Not assessed | None |
| 10 | Prove LEARN understands the agreed company scope | NOT STARTED | Not assessed | Not assessed | None |
| 11 | Resolve completed work into clear commercial outcomes | NOT STARTED | Not assessed | Not assessed | None |
| 12 | Turn evidenced opportunities into customer decisions | NOT STARTED | Not assessed | Not assessed | None |
| 13 | Protect contract delivery and grow valuable relationships | NOT STARTED | Not assessed | Not assessed | None |
| 14 | Resolve cash and cost exceptions using accounting evidence | NOT STARTED | Not assessed | Not assessed | None |
| 15 | Create a useful asset lifecycle service | NOT STARTED | Not assessed | Not assessed | None |
| 16 | Make competence and contractor readiness dependable | NOT STARTED | Not assessed | Not assessed | None |
| 17 | Connect parts evidence to work and cost | NOT STARTED | Not assessed | Not assessed | None |
| 18 | Prepare consistent reviewed documents from shared evidence | NOT STARTED | Not assessed | Not assessed | None |
| 19 | Make delivery readiness and capacity actionable | NOT STARTED | Not assessed | Not assessed | None |
| 20 | Prove controlled execution before enabling external actions | NOT STARTED | Not assessed | Not assessed | None |
| 21 | Turn outcomes into sustained company improvement | NOT STARTED | Not assessed | Not assessed | None |
| 22 | Accept the connected Drummonds operating journey | NOT STARTED | Not assessed | Not assessed | None |
| 23 | Prove the developments form a reusable ServiceOS product | NOT STARTED | Not assessed | Not assessed | None |

When running a stage, link a sanitised `receipts/NN-YYYY-MM-DD.md` using
[RECEIPT-TEMPLATE.md](RECEIPT-TEMPLATE.md). Record evidence centrally in the existing
delivery logs where applicable; do not maintain competing acceptance claims.
Changes to scope/dependencies require a reason and must preserve outstanding work.

## Planning-pack validation

The author checks links, stage dependencies, coverage and shared constraints before
delivery. This validates the documents only; no implementation checks, provider
acceptance or runtime release are implied.

Initial document validation: 24 numbered prompts, all 16 handover workflows mapped,
229 local Markdown links resolved, no missing reuse anchors and no dependency cycles.
Every prompt contains an existing-work review, outcome contract, acceptance checks,
boundaries and single-stage stopping condition. All Part 2 prompts explicitly require
Build 10. These are planning checks, not executed build receipts.
