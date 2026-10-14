# Build 00 — current-build and reuse audit

14 October 2026, Europe/London. Scope: read-only product audit and documentation.
Starting checkout: `codex/learn-v1` at `72df622e29fbceedecd4a551426cf9ad02b38b83`,
clean. That exact GitHub `codex/learn-v1-test` head was read back during this audit.
This is a checkpoint branch, not the production branch or a new release.

During the audit, the QuickBooks workstream published two additional commits.
The clean shared checkout was fast-forwarded to their existing checkpoint
`bb9eafc0` before this audit was saved. Its updated documentation and recurring
control/dispatch changes were inspected and reconciled below; no provider work
was restarted. Build 00's own checkpoint changes documentation only.

Chris activated the beginning of the Dropbox LEARN V2 sequence. The full extracted
master README was read; its 31 pre-existing working files (24 prompts and seven
support files, including the original sequence README) match the repository after
ignoring trailing whitespace. No planning file was substituted for application code.

## Evidence meaning and limits

**DOCUMENT REVIEW** below means source/code/schema/test inspection and review of
retained dated evidence. It is the environment of this audit. **LOCAL**, **ISOLATED
DB**, **TEST** and **LIVE** describe the evidence cited, not fresh execution by
Build 00. Tests were inspected, not rerun. No new hosted acceptance, human business
sign-off, provider completeness or business benefit is claimed.

Architecture documents describe intended models and some obsolete status labels.
For example, the canonical entity map says ingestion is unbuilt and Slack has no
adapter; current code and dated release evidence supersede those statements.
Conversely, a graph node type, migration file, UI panel or registered adapter does
not establish operational readiness for its domain.

### Evidence register

| ID | Current source inspected | What it establishes and its limit |
|---|---|---|
| E01 | [V1 completion authority](../../operations/LEARN-V1-COMPLETION.md) | Latest entry: 14 October 10:43 BST; dated source totals and ten public Slack observations. Unchecked acceptance requirements remain binding; later dated evidence supersedes older component labels. |
| E02 | [Public Slack release evidence](../../operations/evidence/learn-public-slack-live-2026-10-14.json) | LIVE worker v77; ten committed source-only observations and fifteen audited skips through normal scheduling; exact revision bindings, zero actions and eleven-dataset preservation. TEST remains v28. |
| E03 | [QuickBooks integration](../../operations/LEARN-QUICKBOOKS-INTEGRATION.md), [history evidence](../../operations/evidence/learn-quickbooks-live-history-2026-10-14.json), [hosted refresh](../../operations/LEARN-QUICKBOOKS-HOSTED-REFRESH.md), [customer search](../../operations/LEARN-QUICKBOOKS-CUSTOMER-SEARCH.md) | Latest integrated evidence: 134,569 retained records after traversing all 13 requested collections; two reviewed combined-card examples. First-pass 49,893/zero-link state is historical. Ongoing refresh was approved in its own chat; normal hosted scheduling saved ten pages/1,000 observations by 10:16 UTC. Full recurring cycle/next due acceptance, reconciled accounts and broad matching remain open. |
| E04 | [Deployment authority](../../DEPLOYMENT.md), latest E03 hosted release | Vercel frontend and separate Supabase releases; isolated targets and preservation gates. Deployment doc's `e81575a0` is superseded first by customer search `5cdea6d0`, then isolated recurring controls `e42a0feb519fd70793c03bcc62a7d50c2c2f2e30` / `dpl_DwxESEPPsP1XpDWXXSLzstN47Byp`. E03 records shared worker v78 preserving v77 Slack code. These are retained release records, not fresh readback by this audit. |
| E05 | [Commusoft ongoing capture](../../operations/LEARN-COMMUSOFT-ONGOING.md), [incremental completion](../../operations/evidence/learn-commusoft-incremental-cycle-complete-2026-10-14.json) | Scheduled property/job/contact traversal and a subsequent incremental cycle have dated LIVE evidence; full source reconciliation and canonical publication are separate. |
| E06 | [Contact separation](../../operations/LEARN-CONTACT-SEPARATION.md), [operator job search](../../operations/LEARN-OPERATOR-JOB-SEARCH.md) | Shared-endpoint attribution safeguards and selected signed-in TEST/LIVE journeys; not universal identity or historical matching accuracy. |
| E07 | [Performance measurements](../../operations/LEARN-PERFORMANCE-MEASUREMENTS.md), [publication](../../operations/LEARN-SCORECARD-PUBLICATION.md) | Existing policy/measurement/review/correction mechanisms and component-specific TEST/local proof. No accepted Drummonds staff scoring baseline or fair company-wide ratings follows. |
| E08 | [Work history](../../operations/LEARN-WORK-HISTORY.md), [authority](../../operations/LEARN-WORK-AUTHORITY.md), [calendars](../../operations/LEARN-WORK-CALENDARS.md), [delays](../../operations/LEARN-WORK-DELAYS.md) | Work lifecycle, capture, scoped authority/cover and time/exclusion foundations with differing component evidence. They do not measure payroll effort, full diary capacity or business process correctness. |
| E09 | [Recording operations](../../operations/LEARN-RECORDING-DAILY.md), [recovery coverage](../../operations/LEARN-DATA-RECOVERY.md) | 13 October combined phone/voicemail backup and separate restore evidence. Private aggregate status inspected: last success remains 13 October; 14 October attempt failed `source_inventory_changed` at 08:12:54 UTC. No current daily success or always-on operation is established. |
| E10 | [Input acceptance](../../operations/VERIFICATION_AND_ACCEPTANCE.md) | Phone/email require a real working day without manual rescue; representative source-to-card/recovery proof, not successful job counts alone. |
| E11 | [Business graph](../../architecture/03_BUSINESS_GRAPH.md), [adapter pattern](../../architecture/source-adapter-pattern.md), [evidence design](../../architecture/EVIDENCE-LAYER-V1.md) | Reuse contracts: canonical identities, rebuildable projections, retained provenance and governed adapters. Historical implementation labels require reconciliation. |
| E12 | [Delivery journey](../SERVICEOS-DELIVERY-JOURNEY-2026-10-01.md), [coverage](COVERAGE-MATRIX.md), [foundation gate](LEARN-ACCEPTANCE.md) | Existing delivery obligations and all sixteen workflow mappings survive the expanded G1–G10 gate. A stage number is not a new product menu. |

## Stage-by-stage existing-work matrix

All rows are **audit classifications**, not execution/acceptance of the later stages.
“Gap” means not established by inspected evidence; it does not prove no other code
exists. The numbered prerequisite graph is unchanged.

### Part 1 — LEARN foundation

| Build / prerequisite | Requirement and current implementation | Schema and actual UI/caller | Verified evidence environment | Gap and smallest reuse/extension |
|---|---|---|---|---|
| 00 / none | Reconcile current work and propose outcome contracts. Existing pack, completion ledger and release records reused. | This matrix, [outcome register](00-OUTCOME-REGISTER.md), [sequence](00-RECONCILED-SEQUENCE.md); no application path added. | DOCUMENT REVIEW in this run. | Audit outputs delivered; outcome definitions/owners remain proposed where business agreement is absent. Receipt is PARTIAL pending that review. |
| 01 / 00 | Protect and finish V1 inputs, readable evidence, identity, cards, scoring and recovery. `learn-card-communications.ts`, `learn-operator-capture-health.ts`, `_shared/learn_input_tick.ts` already implement relevant paths. | Existing `platform_jobs`, canonical interactions/source receipts; `LearnCards`, `LearnPhoneSavedResults`, `OperatorCaptureHealth`, `OperatorLearnInputs`. | E01/E02/E05: bounded LIVE; E07–E10: component-specific local/TEST/LIVE. | **Substantial partial reuse.** Finish source-only Slack browsing, representative attribution/read performance, unfinished source acceptance, scoring and durable-operation/recovery proof. No second queue or restarted campaign. |
| 02 / 01 | Source inventory, coverage, authority and freshness. `learn-operator-inputs.ts`, `learn-operator-capture-controls.ts`, `learn-measurement-receipts.ts` already separate controls and evidence. | Operator input/capture RPCs and existing source/version tables; `OperatorLearnInputs`, `OperatorCaptureControls`, `OperatorCaptureHealth`. Receipt verifier is a collector helper, not a standalone screen. | E01/E02/E05: dated LIVE inputs; E10 acceptance contract. | **Partial foundations.** Add the reviewed whole-company scope register, denominators, unavailable/excluded sources and correction/withdrawal impact. A healthy poll cannot become complete business coverage. |
| 03 / 02 | Canonical people, customer, site, job and reviewed links. `learn-projection-review.ts`, `learn-identity-review.ts`, `learn-customer-business-context.ts` and associated tests are wired to real callers. | `learn_business_input_*` migrations, `jobs`, `sites`, `people`, `customer_cards`, reviewed source links; `OperatorProjectionReview`, `OperatorIdentityReview`, `LearnCustomerBusinessContext`. | E05/E06: selected LIVE/TEST journeys; E03: reviewed finance/customer examples. | **Partial operational acceptance.** Expand publication/review and correction coverage; quantify ambiguous/unmatched populations. Visits, assets, contracts and financial job crosswalks remain unproved. Preserve shared office endpoints and original identifiers. |
| 04 / 03 | Strategy, ownership, cover and approved policy. `_shared/work_authority.ts`, `_shared/ownership.ts`, `_shared/intelligence/objective_evaluation.ts`, `ownership-projection.ts`. | Existing objectives/metric definitions, authority/ownership assignments and policy/config versions; `OwnershipPanel`, roster/Directory, existing company/operator surfaces. | E08: component TEST/local; E11: architecture intent. | **Reusable primitives, business model incomplete.** Review source assertions, effective roles/cover and conflicting New Dawn definitions. The older Protocol preview is not evidence of a reviewed current commercial-policy UI. |
| 05 / 03,04 | Visits, contracts, assets, opportunities and obligations. Commusoft `_shared/commusoft/read_page.ts`, `source_records.ts`, `worker.ts`; existing job-detail reader. | Existing business source versions/projections and canonical jobs/sites; `LearnCommusoftJobDetails`, business context. Actual HTTP resource union is only `properties`, `propertyContacts`, `jobs`. | E05: LIVE for those slices; E11 entity catalogue is design. | **Job/customer spine reusable; broader inputs unproved.** Discover permitted API/export slices before adding visit/diary, asset, contract, parts and obligation support. Never infer those capabilities from the jobs connection. |
| 06 / 04,05 | Exact financial/time baselines. `learn-quickbooks-finance.ts`, QuickBooks import/OAuth worker, `learn-performance-measurements.ts`, `learn-working-time.ts`, objective evaluator. | `learn_quickbooks_source_versions`, page/checkpoint/finance-link tables, measurements; `LearnCustomerFinance` inside the existing customer business view. | E03: real LIVE requested-scope traversal, reviewed cards and first hosted refresh pages; sandbox lifecycle separate. New OperatorQuickBooksRecurring is called by existing import controls. | **Finance intake reusable; business baseline unavailable.** Requested-scope history traversal is now recorded; reconcile accounting totals, costs/hours, coverage semantics and explicit crosswalks. Preserve the active approved refresh; full-cycle/next due acceptance belongs to its existing workstream. No profit, revenue, cash-recovery or labour-savings claim. |
| 07 / 02,03,04,05,06 | Reviewable extraction/retrieval. `_shared/openai.ts`, existing source hashes/observations and `learn-card-brief.ts`. Brief helper counts accessible actions/evidence and does not claim AI knowledge. | Existing source versions, observations and evidence models; `LearnCards`, saved phone results, source drill-down. | E02: ten public source observations LIVE; E11 evidence-store concept has distinct gates. | **Partial evidence/processing foundations.** Govern document assertions/source spans and correction propagation; benchmark local processing on an agreed evaluation set. No local worker, quality/cost benchmark, model installation or silent cloud fallback established. |
| 08 / 05,06,07 | Observed processes, waiting, handling and blind spots. `learn-work-history.ts`, `learn-work-delays.ts`, `learn-work-calendars.ts`, `learn-working-time.ts`. | Existing work-source capture, history, calendars/publications and delay-review migrations; `LearnWorkHistory`, `LearnWorkDelays`, `LearnWorkCalendarSettings`. | E08: differing local/TEST component proof; actual-source process review absent. | **Reusable capture/time primitives.** Connect operational cases/events, preserve unknown intervals, review routine/exception journeys with staff. Residence or calendar minutes are not measured effort. |
| 09 / 04,06,08 | Evidence-led improvement priorities and outcome contracts. `_shared/intelligence/objectives.ts`, `objective_evaluation.ts`, `command-work.ts`. | Existing objectives, measurements, outcomes, recommendations, intelligence objects; existing Command Centre callers. | Code and existing tests inspected; historical engine proof is not a Drummonds proposal backlog. | **Shared engine reusable.** Build a bounded reviewed improvement queue with source examples, non-overlapping benefits, owners, baselines and alternatives to automation. |
| 10 / 01–09 | Accept bounded company understanding with G1–G10 and human review. | Existing delivery records, scope/identity/measurement/work primitives; [LEARN acceptance contract](LEARN-ACCEPTANCE.md). | DOCUMENT REVIEW of gate; no Build 10 receipt. | **Not passed.** Coverage, dependable operation, business meaning, finance/time, process and human acceptance are materially incomplete. Part 2 remains gated. |

### Part 2 — operational outcomes, all additionally require current accepted Build 10

| Build / other prerequisites | Requirement and current implementation | Schema and actual UI/caller | Verified evidence environment | Gap and smallest reuse/extension |
|---|---|---|---|---|
| 11 / 10 | Correct completion/commercial outcomes. `command-work.ts`, `_shared/work_transition.ts`, `work_authority.ts`, job details. | `intelligence_objects`, state/capture history, authority and source links; Command Centre and job cards. | E08 component TEST/local; selected E05 job views LIVE. | **Work spine reusable; workflow unaccepted.** Add reviewed delivery, inclusion, charge readiness, FOC and future-work dimensions. No invoice issue or guessed missing evidence. |
| 12 / 11 | Further-works to decision and booking commitments. Work transitions, `learn-work-delays.ts`, connector registry. | Same work/approval/history spine and existing cards; no inspected accepted complete quote journey. | Shared code/component evidence only; as-is exported workflows are claims. | **Primitives reusable; domain workflow required.** Retrieve missing rules/templates, merge repeated findings, preserve draft/sent/accepted distinctions and current ownership. |
| 13 / 11,12 | Contract delivery, renewals and relationship economics. Customer business view, finance reader, objectives/work. | Existing source links, objectives and work; customer business/finance panels. No accepted full contract obligation slice identified. | E03/E05 bounded LIVE readers, not contract/economics acceptance. | **Partial adjacent foundations.** Add reviewed contract/version/obligation and renewal coordination using accepted Build 05/06 data; cost incompleteness withholds profitability. |
| 14 / 11,13 | Debtor/cost exception coordination and safe drafts. QuickBooks reader, work API and connector registry. | Existing retained financial sources, reviewed customer links and internal draft adapter; existing customer card and work surfaces. | E03 requested-scope LIVE traversal; no reconciled debtor workflow acceptance. | **Financial intake reusable; debtor workflow required.** Reconcile balances, disputes/credits/holds and contact policy; separate collections from revenue/profit. No automatic sends or accounting writes. |
| 15 / 12,13 | Pilot asset lifecycle/report/capital plan. Existing customer/site/job relations and work primitives. | Canonical graph can project typed entities; no accepted real asset register/condition/capital-plan slice found in inspected anchors. | Architecture/design plus related LIVE customer/site reads. | **Domain gap on reusable spine.** One technical-review pilot, evidenced asset identity and cost/condition bands before expansion. Node extensibility is not an asset service. |
| 16 / 11,13 | Person/contractor competence and renewal readiness. Ownership/authority, work calendars and work API. | Existing team members, scoped authority, effective cover and work; roster and work surfaces. | E08 component evidence; legacy exported certificate procedures do not certify ServiceOS readiness. | **Identity/authority reusable; qualification workflow unaccepted.** Separate company approval, operative competence and document validation; retrieve missing scripts/skills and define task-specific scope. |
| 17 / 11,12 | Parts/stock readiness and cost allocation. Work-transition and governed adapter contracts. | Existing work/source/approval primitives; no accepted stock movement/reservation reconciliation slice identified. | Code/design only for this domain. | **Domain gap on reusable spine.** Discover authoritative inputs; deduplicate movements, returns and partial receipts. Keep purchasing disabled. |
| 18 / 11,12,13,15,16 | Versioned technical/customer evidence packs. Existing evidence provenance, connectors and work approval path. | Existing immutable source/history and artifact/draft mechanisms; no verified shared RAMS/SFG20/O&M production-assembly journey identified. | Existing foundations; no issued-format domain acceptance. | **Assembly gap; reuse source/work/storage.** Obtain approved assets/content rights, bind versions and render every page. Technical approval remains human. |
| 19 / 13,15,16,17 | Feasible delivery options alongside diary. Calendars, working-time utilities, delays and work transitions. | Existing calendar definitions are company opening windows, not provider appointments or resource availability. | E08 local/component proof, not accepted full diary/capacity feed. | **Calculation primitives reusable; diary/readiness data gap.** Connect authoritative appointments, leave, parts and competence; offer reviewed options with explicit assumptions. |
| 20 / 11,12,13,14,18,19 | One exact governed action capability. `_shared/connectors/index.ts`, `automation_guards.ts`, existing executor/authority. | `automation_intents`, attempts/approval/contract primitives; internal note/email-reply-draft adapters already registered. Marketing external adapters have a separate scope. | Code and prior engine/test evidence; no generic LEARN external-action acceptance. | **Executor reusable; each capability separately required.** Registry currently has no general invoicing/purchasing/booking adapter. Use capability-bound authority, current facts, idempotency, readback and kill switch. Marketing permission does not authorise LEARN actions. |
| 21 / 20 | Measured outcomes and governed improvement. Objective evaluator, learning proposal helper, performance corrections and work API. | Objectives/measurements/outcomes and proposed profile changes; existing review/Command Centre surfaces. | Shared code/component proof only for this expanded outcome. | **Shared measurement primitives reusable.** Record interventions and comparable real observation periods, confounders, guardrails and human policy review. A pure proposal helper cannot approve policy. |
| 22 / 15,16,17,18,19,20,21 | Real connected Drummonds operating acceptance. | Existing canonical evidence/work/financial paths and stage receipts; same client/operator product. | No accepted end-to-end pilot under this pack. | **Acceptance gap.** Review ordinary and exception cases, actual staff usability and supported shadow/draft mode; preserve separate external-action acceptance. |
| 23 / 22 | Repeatable onboarding without a client fork. Source adapters, capability/configuration registry and existing navigation/operator selection. | Tenant-scoped canonical records and module/authority controls; real client directory and existing workspace. | Existing isolation/component fixtures are partial portability proof only. | **Platform foundations reusable; accumulated proof absent.** Exercise a second synthetic tenant across all accepted capabilities and record onboarding/support costs. No actual new-client or universal provider claim. |

## V1 obligations retained in full

The authoritative checklist remains E01. This table indexes outstanding obligation
families rather than replacing or narrowing their denominators. Build 01 must use
the latest applicable evidence, including later entries within each linked document.

| Existing obligation | Reconciled state and required continuation |
|---|---|
| Google email / OAuth / Workspace | Retained real messages and selected source-to-card examples exist. Full enabled-mailbox authority, history/incremental reconciliation, corrections/deletions, expiry/recovery and real unattended window remain required. |
| Commusoft | Real scheduled complete/incremental cycle evidence exists. Preserve active checkpoints. Reconcile UI/API populations, source timestamps, reviewed canonical publication, changed-source refresh and broad matching. |
| Phone | Retained calls/transcripts/recordings and synthetic TEST private playback have evidence. Real provider capture/download/transcription/playback and recurring source-to-card acceptance remain component-specific requirements. |
| Slack | Authorised channel capture and selected public-channel observations are real. Source-only browsing, comprehensive eligibility/history/revision recovery and attributed coverage remain partial. Private/shared-channel acceptance is separate; DMs remain excluded. |
| Voicemail | 255 dated visible rows and 13 October original-message/audio recovery proof exist. Retained totals do not establish full mailbox/history coverage, recurring capture, usable transcripts, private playback or authorised card context. |
| Microsoft | TEST schema/worker evidence supersedes older 'nothing installed' entries. No real authorised Drummonds Microsoft mailbox is established. Keep adapter readiness separate from tenant use; do not manufacture a source requirement or silently delete the reusable acceptance obligation. |
| Cards / identities / performance | Selected real customer/site/job/communication journeys and shared-endpoint safeguards exist. Ordinary-client acceptance, representative large-history performance, ownership/next-step usability, configuration, coverage and corrections still need their full checks. Missing evidence withholds scores. |
| Controller / isolation | Existing explicit operator selection, audited reads and module/recovery controls must be reused. Verify exact role/object/source boundaries and pause/recovery for each actual release; operator success is not ordinary-client acceptance. |
| Performance input adapters | Reviewed staff/team identity, calendar history and source-backed response/progression/repeat-visit/driving measurements remain incomplete. Calendar minutes are not attendance/pay or evidence of employee inactivity. |
| Backup / operating handover | Preserve original communications, recordings, versions and recovery artifacts. Daily files last succeeded 13 October; 14 October failure preserves that success. Dependable recurring database/file backup, missed-run response, application/Auth recovery and controlled resumption remain open. Do not duplicate the active runner. |
| Release / branding / source preservation | Isolate TEST/LIVE artifacts, retain correct schema/runtime/frontend combinations and verify exact release/readback, preservation and rollback. Git backup is neither deployment nor database/audio backup. |
| AI receptionist / Emma | Main-number activation remains unverified in the handover. Separate existing workstream; no new telephony scope, replacement receptionist or activation is authorised by this audit. |

## Current navigation and branding

Inspected real route callers, not just navigation registries:

- `/client` uses `src/routes/client.tsx` → `ClientPortal.tsx` → `LearnWorkspace.tsx`.
  Current sections are Home, Receptionist, LEARN, Modules, Invoices, Notes and
  Notifications. Old overview/outcomes links resolve to Modules; retired pages
  are not reinstated. Client LEARN uses `LearnLaunchPortal`; a cross-client operator
  receives the audited information path instead of changing their profile.
- `/openfolk/$tenantId` resolves the requested slug/ID only against the authorised
  client directory. `operator-workspace.ts` exposes Home, Receptionist, Modules,
  Invoices and Information. `?module=information` hosts retained customer/business
  review; `?module=modules` hosts availability and input controls. The older
  `openfolk-workspace-nav.ts` sections remain specialist tools behind this shell,
  not a reason to redesign the active primary navigation.
- `src/lib/client-brand.ts` currently displays stored `Drummond Heating` as
  `Drummond's`; the existing emblem/nav styling is in the current components/CSS.
  E02 has dated signed-in LIVE operator/client-navigation evidence. Build 00 has
  not rerun a signed-in visual acceptance or certified ordinary-client branding.
  The computer-use inventory exposed no controlled browser tabs; the existing Arc
  browser is shared with other work. No application navigation was changed.
- Retain `https://app.openfolk.ai` and `https://test.openfolk.ai` as established
  user entry points; legacy deployment descriptions also name the existing www
  alias. Resolve actual aliases and signed-in build before a future release;
  don't send users to arbitrary previews. The illustrative `outputs/` showcase
  is not the current product specification.

## Source and concurrent-work reconciliation

The Dropbox root README and all numbered prompts were available. At the initial
nonrecursive source-folder inspection, the source index advertised several CSVs
that were not yet listed; direct metadata reads of gap/rules registers failed.
Their original local exports named by the source index were available and read
in private storage, including G01–G15, rules and cost evidence. This is a packaging
freshness limitation, not proof those business sources never existed. No raw source
register, strategy text, customer detail or private runtime manifest was copied
into Git. Only sanitised findings and source references appear here.

The as-is handover distinguishes inspected configuration, reported output,
documented claim and unknown. It supplies workflow context, not reconciled finance
actuals or authority to run its scripts. The inspected New Dawn North Star includes
an appended correction to recurring-income goals and different income/denominator
definitions. Those definitions still need review before active metrics; no private
plan values were promoted into software policy or historical actuals.

Read-only chat inventory found **New Dawn** active in this same checkout, packaging
the handover; **Quick Books Integration** active in its own worktree; **ServiceOS
GOAL MODE** idle; **Emma - Realism** not loaded. No chat was messaged. Ownership
here is limited to Build 00 audit documents and its tracker entry. QuickBooks
capture/OAuth/finance and Emma runtime remain with their existing workstreams.
Recheck filesystem, Git and runtime before the next stage; these observations
are dated, not persistent locks or authority to resume another chat.

## Recommended next boundary

Build 01 is next for selection after review of this audit. Its enabling outcome is
trustworthy source-to-evidence use: staff can open retained evidence, see missing
coverage and rely on required feeds over the existing real working-day window.
Start by revalidating current source health and the smallest outstanding public
Slack source-browse journey, then preserve every remaining V1 criterion above.
This recommendation neither activates Build 01 nor substitutes that small journey
for complete V1 acceptance. See the [reconciled sequence](00-RECONCILED-SEQUENCE.md)
for decision timing and possible later delegation boundaries.
