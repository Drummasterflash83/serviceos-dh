# LEARN V1 production release plan

Status: **preparation only; not approved or ready to execute**. The
[completion checklist](LEARN-V1-COMPLETION.md) is the acceptance authority.
The current hosted TEST frontend is Git `9cbf562`, schema package 079 and worker
v20. That combination has synthetic processing acceptance, not full launch
acceptance. Source backups are on `codex/learn-v1-test`.

## Production archive reconciliation — 12 October, 02:52 UTC

A fresh isolated restore of the existing 00:25 UTC production archive now supplies
the release-planning baseline. The pinned archive and PostgreSQL image matched;
network access, published ports, background workers and scheduled execution were
disabled throughout. The disposable container was removed after metadata capture.
No production or hosted TEST data was changed. A separate read-only TEST query
captured the matching public-schema inventory and all 80 deployment receipts.

| Public objects | Production archive | Current TEST | TEST-only | Production-only to preserve | Shared but different |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tables | 251 | 183 | 82 | 150 | 93 |
| Functions/signatures | 366 | 330 | 295 | 331 | 30 |
| Views | 5 | 9 | 8 | 4 | 1 |

All 79 numbered TEST SQL packages match a hosted deployment receipt; all 67 with
companion manifests also match their declared hash. The remaining 12 have no
companion manifest, so their receipt/file hashes establish only their recorded
TEST provenance. None is a production migration package.

The first production-specific compatibility requirements are now concrete:

- Preserve the five production-only email origin columns and their campaign,
  delivery, intent and person constraints. TEST does not exercise those writers.
- Preserve the three marketing capability triggers on `email_oauth_tokens` and
  its account/tenant foreign key. Rehearse LEARN token refresh alongside them.
- Preserve production-only correlation, decision, objective-health, campaign,
  event and receptionist fields. Do not replace those tables with TEST versions.
- Reconcile existing tenant/profile/source policies and privileges individually.
  Ninety-three shared tables differ in at least one catalog facet; this does not
  mean all 93 require the TEST definition. Prove both existing-service access and
  the new restricted LEARN readers after each relevant change.
- Add the missing journal/receipt tables and supported columns in dependency
  order. Review shared triggers and indexes before adding or replacing names.
  Preserve existing uniqueness and same-tenant constraints.

The [machine-readable reconciliation](evidence/learn-production-release-reconciliation-2026-10-12.json)
lists additions, production-only objects, changed facets and pinned TEST packages.
Its classifier has four passing checks covering production-only preservation,
type/authority changes, overloaded signatures, duplicate metadata and package pin
drift. Raw source records and credentials are not in that report.

**This is a planning baseline, not migration acceptance.** It compares the retained
archive with TEST, not the current live database. It covers public-schema metadata,
not every cross-schema dependency or runtime. The archive's known pg_net omissions
remain; no full service/Vault recovery is claimed. The next release step is an
explicit additive production candidate and its offline rehearsal with retained
source fingerprints and real production constraints. No candidate has been applied.

## First production candidate rehearsed offline — 12 October

The draft [metadata migration](../../supabase/release/learn-production/001_launch_metadata_views.sql)
and its [manifest](../../supabase/release/learn-production/001_launch_metadata_views.manifest.json)
are production-specific. Their pinned SHA-256 is
`d9870a4b1e581ea75d1b9ef84b0fffb713c8965caa9c02d8aad63b009bac745d`.
They add eight restricted LEARN metadata views and a private release ledger, with
an exact guard on the nine source-table catalogs from the archived baseline.
The TEST target, an altered catalog and a duplicate submission are rejected.
An injected failure after receipt insertion rolls the whole transaction back.

Production has existing policies that apply to PUBLIC. The candidate therefore
adds restrictive policies for the new reader role alongside its permissive grants;
existing policies cannot widen the views beyond the current owner/admin's tenant.
Original source permissions and writers remain intact. The new role cannot log in,
bypass RLS or create schema objects; applications gain no role membership or access
to the release ledger. The deployer's temporary SET/INHERIT access is absent after
installation.

The final rehearsal used a fresh offline restore of the real archive. Owner/admin
SQL-role reads returned the retained tenant's 18,598 emails, 4,328 calls and 2,882
recordings. Viewer, unknown-actor, no-actor and anonymous checks passed, as did view
write denial and email-label/provider-error redaction. All original public tables,
functions, views and application column privileges were preserved, except the
explicitly added reader policies. All **1,591,576 rows across 299 archived tables
and five sequence states** matched before/after. The single new release receipt
was accounted for separately. The disposable container was removed.

The initial verification attempt exposed unqualified search-path assumptions in
the rehearsal queries; those were corrected and exact expected failure reasons
were checked before accepting the later runs. The candidate SQL itself did not
change between these runs. See [rehearsal evidence](evidence/learn-production-launch-rehearsal-2026-10-12.json).

**This is only the first metadata prerequisite.** Remaining foundation, scoring,
operator, ingestion, queue and recovery changes still need production-specific
packages and a complete combined rehearsal. Existing production source grants
have not been tightened by this step; later access review must distinguish legacy
service requirements from new LEARN access. SQL claims in an isolated database do
not prove signed-in HTTP/browser acceptance. Nothing has been deployed live.

## Required evidence before requesting promotion

The first two production-specific packages now pass an ordered offline rehearsal:

1. `001_launch_metadata_views.sql`: the restricted metadata surface described above.
2. [002_foundation_rules.sql](../../supabase/release/learn-production/002_foundation_rules.sql):
   existing-table reference guards, forward membership capture and immutable
   scorecard rule drafts/publications, including the reviewed conflict codes.

The second package hash is
`1ea226e5da475464b1b6ccccf3cc1e027b6a17417e99f582b81f10206459e1d4`.
It reuses all 33 existing foundation tables and retains their original policies,
grants, columns, constraints and indexes, including production-only fields. The
existing View-As table and its behavior are preserved. Exact catalog/helper and
prior-receipt guards precede a read-only audit of declared tenant references.
That audit passed on the restored archive; no historical relationships were
rewritten. The package adds two empty history tables, eleven functions, 39 triggers
and two indexes. New guards affect future writes; compatibility with every legacy
writer still needs combined acceptance.

The scoring-rule journey passed on that real restored schema: save/publish/replay,
50-to-100-point revision, period-specific history, changed/stale request denial,
foreign-tenant denial, membership capture with honest coverage, retention guards,
View-As write denial and same-session owner revocation. Synthetic rules and a
temporary member rolled back. All original 1,591,576 rows and five sequences
matched; only two deployment receipts remained in the disposable database, with
the two new history tables empty. The new history sequence is accounted for
separately. The database was then removed. Wrong target, catalog drift, late
failure rollback and duplicate rejection passed as well.

The first attempt stopped on a verification timestamp later than the history
reader's completed-period boundary. The corrected probe uses statement time;
the candidate SQL did not change. See
[combined rules evidence](evidence/learn-production-rules-rehearsal-2026-10-12.json).
This is rule configuration/publication acceptance, not proof of real performance
measurements or pay decisions. Measurement collectors, governed work, operator
and connector packages still need production reconciliation and combined rehearsal.

### Measurement and work prerequisites rehearsed offline

The third package, [003_measurements_work.sql](../../supabase/release/learn-production/003_measurements_work.sql),
now passes an ordered offline rehearsal after packages 001 and 002. Its SHA-256 is
`d3a2abaccbb2542f3ec8cf92d9b48b7fd3eed9d0505d050b04828304b4fc6b27`.
It preserves the existing objective schema/registry rows/guards, extends three
tables for performance evidence and forward work capture, and adds review and
collection receipts. Existing company-wide objective access remains unchanged;
new staff-performance reads are restricted to the same tenant's owners/admins.
Direct browser work-history writes and privileged truncation are removed so the
captured ledger can remain evidence. Existing service-role history DML remains.

Synthetic journeys on the real restored schema passed append/replay/conflict,
correction and human review, team-transfer coverage, alias-aware handoffs,
ownership-time calculation and insufficient-evidence handling. An unresolved
owner produces a null measure with incomplete coverage. Direct service-role
self-confirmation and viewer/foreign-owner/foreign-OpenFolk staff access were
denied. The original fixtures needed two production-aware corrections: reusing
profiles created by the Auth trigger and distinguishing existing authorised
company measurements from newly restricted staff facts. Production code and
triggers were not bypassed to make the fixtures pass.

All original columns/values in 1,591,576 rows and five original sequences matched.
The comparison explicitly projects original columns for the three extended tables:
three measurements, nine metric definitions and 14,452 work-history rows. Old
measurements retain tenant scope; old work rows receive no fabricated snapshots
or capture sequence. Synthetic data rolled back; only the three candidate receipts
remained in the offline database before it was removed. Wrong target, catalog drift,
late-failure rollback and duplicate rejection also passed.

See [measurement/work evidence](evidence/learn-production-measurements-rehearsal-2026-10-12.json).
Later collector, calendar, corrections, authority and receipt fixes must still
be included before any full release or current-behavior acceptance claim.

### Governed work rehearsed offline

The fourth package, [004_governed_work_actions.sql](../../supabase/release/learn-production/004_governed_work_actions.sql),
adds five functions and nineteen authority/registry serialization triggers. Its
SHA-256 is `f919f590057ccaa257c0b69b4cffb8084c9b01c4d6ba638600eac5e412373d3f`.
Production already contains the required Action vocabulary. The package preserves
all six classes, 29 object types, 32 states, 48 transitions and nineteen permission
entries; it does not replay TEST seeds, replace existing functions, change table
policies/grants or backfill history. A changed required Action edge fails closed
for review instead of overwriting the configuration.

The combined 001–004 archive rehearsal passed scoped assignment, cover and expired
access, View-As denial, claiming, verb/state/evidence validation, stale versions,
atomic attribution failure and canonical history counts. Existing measurement,
review and work collectors also passed their regression journeys. Controlled
second connections verified cover revocation and action orderings, actor-role
changes, guarded transitions, roster/preview mutations and rejection of stale
repeatable-read snapshots. Work in a different company proceeds concurrently.

All original archived rows/columns and five sequences match after rolled-back
journeys. The second database commits synthetic fixtures solely for concurrency
checks; it is removed with the network-isolated container. Wrong target, schema
and registry drift, late transaction failure and duplicate rejection passed.
The initial rehearsal exposed inconsistent schema search paths in catalog
rendering and the second test connection; both were fixed in the rehearsal setup.
No production configuration was weakened to pass a test.

Reproduce the baseline using `scripts/backup/inspect_production_actions.py`, build
with `node scripts/verify/learn-production-actions-candidate.mjs`, then rehearse
with `python3 scripts/backup/rehearse_production_actions.py`. These use exclusive
private output directories: inspect prior terminal results and choose a new run
suffix before deliberately rerunning. Do not delete or reuse completed journals.
See [governed-work evidence](evidence/learn-production-actions-rehearsal-2026-10-12.json).
Later work/authority fixes and remaining operator/connector packages still need
reconciliation before complete-release acceptance or promotion.

### Scoring, recovery and working-time group rehearsed offline

The fifth package, [005_scoring_working_time.sql](../../supabase/release/learn-production/005_scoring_working_time.sql),
groups twelve pinned source migrations for corrections, assessment retention and
recovery, team residence, resumable collection, calendars, approved delays,
working-time calculation, input bounds and deferred receipt validation. SHA-256:
`d69899c63c83bfb974282599ffa4a6183b29e8f53b652796459d2c1e235ae066`.
It adds fourteen tables and 49 functions, extends the existing append evidence
allowlist and scorecard draft validation, and adds deferred insert receipt guards
to measurements/reviews. Existing source columns, table policies/grants and other
functions remain unchanged. No real calendar, staff grant or score is created.

All five packages passed ordered installation on the full retained archive.
Wrong target, catalog drift, late rollback and duplicate rejection passed, as did
six application-role access probes. All 1,591,576 original archived rows and five
original sequences match after installation. New scoring tables are empty in
that database. A second network-isolated clone then passed twelve synthetic SQL
journeys using actual collectors, including a 14,500-item frozen population,
individual/team attribution, batch replay, missing evidence, working calendars,
DST and exceptions, approved-delay reversal, rule changes, corrections and exact
request recovery. It also passed rule publication through collection, review,
saved assessment and assessment recovery. Altered receipt scope/value/coverage/
contract and forged correction references were rejected; cancellation prevents
late writes. The disposable container and both databases were removed.

Production-aware fixture adaptations retain the archive's Action registry, use
the current PT409 conflict contract, include all existing tenant measurements in
preservation checks, and deterministically order pre-capture history by ID when
its sequence is null. The truncate test includes its newly referencing evidence
table so the immutability trigger is exercised. No source guard was removed or
weakened. PostgreSQL represents each deferred constraint trigger in both trigger
and constraint catalogs; the exact declared entries are accounted for.

Baseline: `scripts/backup/inspect_production_scoring.py`; generator:
`node scripts/verify/learn-production-scoring-candidate.mjs`; rehearsal:
`python3 scripts/backup/rehearse_production_scoring.py`. Each inspection/rehearsal
has an exclusive private journal; select a new run suffix only after inspecting
the previous terminal result. Do not overwrite completed journals.
[Combined scoring evidence](evidence/learn-production-scoring-rehearsal-2026-10-12.json)
records source/probe checksums and limitations. These are synthetic SQL results
on a production archive, not hosted provider, browser or pay acceptance. Remaining
card-input/operator/connector/queue packages and complete-release checks are open.

### Slack intake and recovery group rehearsed offline

The sixth package, [006_slack_intake.sql](../../supabase/release/learn-production/006_slack_intake.sql),
uses ten pinned sources for channel storage, durable workers, thread storage,
operator reads, workspace pacing, history/thread recovery and recurring capture.
SHA-256: `ede925a3158c48f4374c916b3cbcaf2e5345110885458833d5f9d988ca3b4a91`.
It adds nine tables and 32 functions. The generic job claimant excludes Slack jobs
so the dedicated paced claimant owns them; its existing authority is unchanged.

Production already has shared connector tables. The candidate retains their
columns, policies and grants instead of replaying TEST's replacements. It adds
same-tenant references and source/audit retention guards. Existing shared metadata
can no longer be deleted/truncated; provider event records cannot be overwritten.
All other original functions, views and table definitions remain unchanged.

All six packages install together on the pinned archive. Wrong-target, catalog
drift, late rollback and duplicate rejection passed. Every original archived row
and sequence matches; nine new Slack tables remain empty in the preservation DB.
A separate offline clone verifies owner-approved channel import, worker ownership,
exact page retry, source/version/interaction creation, isolation, ongoing approval
and paused recurring admission. A second journey verifies bounded thread capture,
incomplete coverage, retained-cursor continuation, original-approval preservation,
reply deduplication, stale-review rejection and completed-window denial. Fixture
pacing clocks advance only for the synthetic workspace; no provider calls occur.

Baseline: `scripts/backup/inspect_production_slack.py`; generator:
`node scripts/verify/learn-production-slack-candidate.mjs`; rehearsal:
`python3 scripts/backup/rehearse_production_slack.py`. Completed exclusive journals
v1 and v2 are retained privately; v2 adds thread recovery. No product migration
change was needed between these rehearsals. The disposable container was removed.
[Slack evidence](evidence/learn-production-slack-rehearsal-2026-10-12.json) includes
source/probe hashes and exact limits.

**Not complete Slack acceptance:** real workspace authorization, credentials,
provider paging/rate limits, card delivery, signed-in controls and unattended
operation remain unverified. The capture predicate gates recurring admission in
this package, but manual approvals and worker paths still need the later operator
capture-control reconciliation. Do not deploy or present this as a complete
module-disable implementation. No hosted schema or schedule changed.

### OpenFolk capture controls rehearsed offline

The seventh package, [007_capture_controls.sql](../../supabase/release/learn-production/007_capture_controls.sql),
adds one receipt table and eight control/authority helpers. SHA-256:
`178edb3a1e61397ba7cac593276269ea06dfd25d91d5206844e1948473610947`.
It preserves the existing effective-dated OpenFolk authority resolver and grants,
and reuses package 006's capture predicate. Shared operator access/immutability
helpers are brought forward from their pinned source; the remaining Commusoft
operator request/read functions must follow their connector prerequisites.

Only three existing function bodies change: the generic job claimant, paced Slack
claimant and phone pending selector gain capture filters. Existing function
ownership/authority, source tables, table policies/grants, columns and views are
unchanged. The candidate guards the actual phone view and each helper's baseline;
it creates no real operator grant, flag, job or activation.

All seven packages pass ordered install, wrong-target/catalog drift rejection,
late rollback and duplicate denial. Every original archived row and sequence
matches. The actual-schema synthetic journey verifies OpenFolk-only controls,
View-As denial, stale revisions, exact receipts, cancellation, malformed-flag
withholding and atomic receipt failure. Paused queues keep their attempt budget;
owned pre-admission work can defer without burning retries, while saved Slack
pages cannot be deferred away. Actual phone records feed the real pipeline view,
which selects retained audio ahead of paused downloads. Two sessions verify a
waiting admission blocks on the operator transaction and then observes its pause.

Baseline: `scripts/backup/inspect_production_capture.py`; generator:
`node scripts/verify/learn-production-capture-candidate.mjs`; rehearsal:
`python3 scripts/backup/rehearse_production_capture.py`. Private terminal journal
v1 found the fixture used reversed queue priority; v2 uses the correct lower-value
priority and adds concurrency. Candidate SQL did not change. Both disposable
containers were removed. [Evidence](evidence/learn-production-capture-rehearsal-2026-10-12.json)
records the source hashes, fixture adaptations and limits.

This proves database controls locally, not hosted provider or browser acceptance.
Existing worker admission code still needs matched deployment and end-to-end
verification. A previously admitted bounded batch may complete after a pause;
the next batch must check again. Commusoft controls and later voicemail/Microsoft
extensions remain required. No live system changed.

### Governed customer/site/job import framework rehearsed offline

The eighth package, [008_governed_imports.sql](../../supabase/release/learn-production/008_governed_imports.sql),
adds three import ledgers, 30 functions, two customer-card identity indexes and a
same-company contact-parent constraint. SHA-256:
`33b82c3e902bf4eb1172a6f1750a43ec0b02f69551662eb1392ce4a6bb1d308d`.
It also adds three pinned reusable import templates for customers, sites and jobs.
Production's contact store, marketing normalizer, anchor indexes, source columns,
policies and privileges are retained; no source record or card is backfilled.
Conflicting pre-existing prepared templates cause refusal before installation.

All eight packages install together. Archive inspection found no duplicate person/
company card identities or foreign-company contact parents. Wrong target, catalog
drift, late rollback and duplicate application are rejected. Every original row
and sequence matches, including original import profiles. The three additional
templates must match their exact pinned source definitions, active/version defaults
and global scope, and no extra profile may appear. New import ledgers remain empty
in the preservation database.

A second offline clone passes the historical governed import suite with two-phone
and exact-site regression coverage, import authority checks, customer-card creation/
reconciliation and bounded batch application. Customer matching uses source and
strong channel evidence; ambiguous identities become reviewable conflicts. Exact
site references never silently degrade to address guesses. Existing card content
and person records stay intact, alternate source aliases reuse a card, and new
cards do not invent activity or scores. Imported endpoints never create consent;
pre-existing marketing suppressions remain effective. A 100-row batch and replay,
sanitized per-row failure, atomic late failure and tenant/View-As restrictions pass.

Baseline: `scripts/backup/inspect_production_imports.py`; generator:
`node scripts/verify/learn-production-imports-candidate.mjs`; rehearsal:
`python3 scripts/backup/rehearse_production_imports.py`. Baseline v1 failed only its
aggregate-query search path; v2 corrected it. Rehearsal v1 caught the intentional
profile seeds in the strict preservation check. V2 adds exact template validation,
original-profile COPY comparison and a pre-existing-template guard. The three
legacy profile fixtures adapt to production's actual auth trigger. Terminal
journals remain private and all disposable containers were removed.
[Evidence](evidence/learn-production-imports-rehearsal-2026-10-12.json) records hashes
and limitations. Real Commusoft intake, contacts traversal, operator controls,
source coverage and signed-in acceptance remain required; no hosted work occurred.

### Outstanding release gates

- Resolve existing TEST access approvals and verify signed-in customer and
  OpenFolk journeys on the matching protected frontend: reset/sign-in, source
  inspection, card evidence/audio, operator review, module controls and scoring.
- Complete the bounded real Commusoft import and relationship reconciliation;
  establish historical/incremental coverage for required email, Phone, voicemail
  and Slack inputs. Reusable Microsoft support remains in scope; identify whether
  Drummonds needs an actual Microsoft mailbox. Do not substitute fixtures for
  source acceptance or silently defer unavailable inputs.
- Prove provider capture through stored inputs, identity/card delivery and
  reviewed metrics, including disable/resume, lease expiry and unattended worker
  dispatch. A manually invoked worker does not prove recurring operation.
- Establish Drummonds' staff/team mapping, working calendars, scoring criteria,
  weights, scales and source limitations. Missing inputs must remain missing;
  pay-related use requires authorised human review.
- Rehearse a real isolated production database restore and reconnect its recording
  references to verified independent audio backups. Complete credential recovery
  and storage ownership handover. See [recovery coverage](LEARN-DATA-RECOVERY.md)
  and [daily recording operations](LEARN-RECORDING-DAILY.md).
- Resolve every remaining item in the authoritative checklist or obtain an
  explicit scope decision from Chris. Present specific unresolved limitations;
  never interpret absence of objections as approval.


### Commusoft API, operator setup and capture-to-card recovery rehearsed offline

The ninth package, [009_commusoft_api.sql](../../supabase/release/learn-production/009_commusoft_api.sql),
adds 14 protected tables and 43 functions for connection setup/verification,
request permits, durable pages/versions, customer/site/job/contact review, fixed
contact traversal plans and operator continuation. SHA-256:
`02cd8ccd3d806eacc30976edd89bdfd30b05e90d45bbf36cab2828a8765cc253`.
Existing Vault storage and OpenFolk authority helpers are reused; no credential,
operator grant, feature activation or customer import is seeded. The generic
queue claimant excludes Commusoft work while retaining prior Slack/capture gates.

Actual-schema contact projection uncovered a production-only dependency: the
existing `marketing_tenant_guard` used unqualified table names and failed under
the restricted writer search path. The package checks its exact installed hash,
qualifies its seven table references and fixes its path to `pg_catalog`. Its
invoker status, owner, execution grants and every tenant check remain intact.
The guard rejects a cross-company person even when a caller supplies a misleading
temporary `people` table. Existing table catalogs, policies and privileges remain
unchanged; only this guard and the generic claimant change among prior functions.

All nine packages install together. Wrong target, catalog drift, late failure and
duplicate submission checks pass. All 1,591,576 original archived rows and five
original sequences match. The only seeded application additions remain package
008's three exact import templates; new Commusoft tables stay empty in the
preservation database.

Seven suites run in separate offline clones, with actual auth profile creation,
existing operator authority and encrypted Vault using a disposable local key.
They prove setup/reuse and verification receipts, scoped worker credential release,
property discovery, empty contact pages, immutable traversal plans, interrupted
continuation, exact replay and atomic publication failures. The captured sources
continue through the client's owner review into a single card with customer,
site, contact and completed-job links. Endpoint deduplication, existing-person
preservation, graph relationships, held ambiguous identities, cancellation,
permission boundaries and partial timestamp handling pass. Source versions stay
unchanged through projection. The synthetic setup does not recover production
Vault encryption or make real provider requests.

Generator: `node scripts/verify/learn-production-commusoft-candidate.mjs`;
rehearsal: `python3 scripts/backup/rehearse_production_commusoft.py`.
The terminal v4 journal records the successful run. V1 lacked disposable Vault
preloads; v2 put all worker steps in one transaction and collapsed job timestamps;
v3 exposed the actual marketing-trigger incompatibility corrected above. No guard
was weakened to pass. All containers and their cloned databases were removed.
[Sanitised evidence](evidence/learn-production-commusoft-rehearsal-2026-10-12.json).

This remains offline release preparation. Real provider coverage and reconciliation,
remaining release packages, worker deployment, signed-in acceptance and explicit
production promotion approval are still required. No live environment changed.

### Email protocol, durable capture and retained mailbox changes rehearsed offline

The tenth package, [010_email_capture.sql](../../supabase/release/learn-production/010_email_capture.sql),
adds six protected tables, 25 new function names, a private protocol owner, two
Workspace identity columns and related guards. SHA-256:
`c66f74df447fa77a2fdbd914900ae43b1ce88cd544b769ad6d6b864f071e98a6`.
The archived production schema had no ingestion checkpoint/transition tables or
protocol functions. Their pinned TEST reference supplies the exact protocol table,
helper, owner and privilege contracts; existing production email tables are not
replaced. Later pinned migrations supply lease-bound requests, page persistence,
safe failures, v4 mailbox changes and alias identity protection.

The new owner cannot log in, bypass RLS, create roles/databases or read credentials
or email content. Its table/column grants compare exactly with the restricted
reference. Temporary schema CREATE and deployer SET/INHERIT access are revoked;
only PostgreSQL's automatic ADMIN-only creator grant may remain. Existing table
owners, policies, grants, columns, constraints and source rows are retained. New
protocol policies apply only to the new role, with two progress guards on existing
account/run tables. Message updates append private prior versions. The generic
claimant retains Slack/Commusoft exclusions and can settle saved email work while
new capture is paused.

All ten packages install together; wrong target, guarded-table drift, late failure
and duplicate submission are rejected. The 299 archived COPY tables retain all
1,591,576 original rows and five sequences, with only the three earlier import
seed templates added. New email ledgers remain empty. Existing mailbox identity
columns initialise to null/false; no primary owner is guessed from an alias.

Four synthetic suites use the actual production schema and grants. Storage checks
cover unsent drafts, invalid draft-as-sent refusal, provider absence retaining the
body/source ID, a newer sent revision, older-boundary refusal and exact retry
without duplicate source history. The v4 coverage probe withholds the history cursor
until every page is exhausted and resumes across attempts. Durable recovery tests
real enqueue/deduplication, request preparation/application/replay, saved-work
settlement after pause, replacement leases, stale-worker refusal and allowlisted
failure receipts. The fixture models the worker's lease-release update before
calling the actual claimant; runtime HTTP/reaper acceptance remains separate.
Alias checks preserve first ownership, latch later conflicts and reject unauthorised
scope changes. All clones and their isolated container were removed.

Generator: `node scripts/verify/learn-production-email-candidate.mjs`;
rehearsal: `python3 scripts/backup/rehearse_production_email.py`.
The terminal v5 journal is successful. Earlier failures exposed a managed-role
installation mismatch and fixture extraction/reaper omissions; neither application
scope nor guards were weakened. [Sanitised evidence](evidence/learn-production-email-rehearsal-2026-10-12.json).

**Coordinated cutover is required.** The new protocol guards intentionally refuse
legacy direct account-cursor and protected run-completion writes. Pause affected
old capture, deploy matching protocol-aware email endpoints/worker and verify the
paired runtime before activating new capture. Never install this package alone
while incompatible old writers remain active. An old worker is not a safe rollback
after this installation; retain durable receipts/source versions and recover with
a compatible worker or reviewed forward fix. No cursor reset or source overwrite
is part of this package.

Communication projection/card draft eligibility and phone-aware operator health
remain explicit later dependencies; this package proves capture/storage only.
Microsoft integration, real mailbox coverage, browser acceptance and production
approval are still required. No live environment changed.

## Build the production-specific release candidate

1. Read production's current migration ledger, schema/catalog, deployed function
   versions, settings and active schedules. Capture a fresh private preservation
   baseline of source IDs, relationships, counts and fingerprints. Record the
   currently serving frontend and production environment binding.
2. Derive an additive, ordered production migration manifest from that actual
   state. The numbered TEST packages include TEST-specific guards and assumptions;
   **do not execute TEST bundles on production, copy the TEST database, or run an
   unreviewed blanket database push**. Keep schema and source hash pins immutable.
3. Rehearse the exact candidate against an isolated restored full production
   schema, with network/provider calls and imported schedules disabled. Prove
   preservation, tenant isolation, authority, rollback on failure and compatibility
   of every paired reader/writer. Record each required runtime and deployment order.
4. Pin the frontend Git commit, database package hashes, function source bundles,
   required environment-variable names and dependencies in one reviewable manifest.
   Never include secret values. Re-run the documented release checks for that
   exact candidate and verify the GitHub backup SHA.
5. Prepare a production-configured Vercel candidate using the existing production
   project's environment. Never promote a frontend bound to Supabase TEST.
   Follow [deployment instructions](../DEPLOYMENT.md); Lovable is not a host.
6. Give Chris the exact production changes, expected user-visible behaviour,
   preservation/recovery evidence, capture activation plan and rollback limits.
   Production promotion requires his explicit approval.

## Approved execution order and verification

After approval of the specific manifest, take a fresh recovery/preservation
checkpoint. Install the reviewed additive database prerequisites, then their
compatible guarded functions, then the matching production frontend. Do not
activate capture or schedules as a side effect of schema/frontend installation;
follow only the separately reviewed activation steps in the approved manifest.

Verify the actual `openfolk.ai` routing and served version, production Supabase
binding, tenant/operator permissions, Drummonds branding and signed-in journeys.
Compare source IDs, existing relationships and recorded-file references with the
baseline. Verify new real inputs and updates through the whole pipeline, including
scoring limitations and operator-visible diagnostics. Record actual observation
windows and receipts; an ACTIVE function, HTTP 200 or rising count is insufficient.

## Rollback and operational handover

Choose compatibility boundaries during rehearsal. An old frontend or worker may
not understand new receipt contracts; Vercel rollback alone is not automatically
a safe application rollback. For an unsafe paired release, pause affected capture
through verified controls while retaining inputs and evidence, then use the
reviewed compatible runtime/frontend version or an additive forward correction.
Do not drop receipt/audit tables, overwrite existing data from TEST, or rewrite
published Git history. A production database restore is a separate reviewed
recovery operation, not a routine way to undo a schema addition.

The final handover must name the operator, monitoring location, actual dispatch
and backup schedules, alert recipient, escalation route, credential locations
and rotation dates, recovery steps, expected provider coverage and known limits.
No credentials belong in this document. Keep customer messages calm and factual;
record operator detail without claiming failed or stale processing is healthy.

## Workspace alias compatibility before promotion

The 11 October read-only directory audit found two active configured addresses
that Google reports as aliases; their Gmail profiles resolve to current primary
users without separate DWD account rows. The earlier directory handler would
mark these valid alias inputs removed. Use the reviewed v3 directory-identity
candidate with its additive binding schema and matching worker when packaging production; do not run the earlier primary-only refresh.
TEST code/readback checks pass, but production is unchanged and still needs the
explicit release approval. Do not enable parallel primary accounts or merge old
sources implicitly. Review alias ownership and retained account IDs during real
capture acceptance. Four other failing addresses are absent from the current
domain directory; their history stays retained while the operator resolves them.
See [current delivery evidence](LEARN-V1-COMPLETION.md#real-workspace-directory-and-aliases--11-october-18491854-utc).

The provider distinguishes primary email from editable/non-editable aliases:
[Google Directory User reference](https://developers.google.com/workspace/admin/directory/reference/rest/v1/users).
The bounded scan covers the configured domain, not every domain, group or deleted
user in the Workspace customer:
[Google users.list reference](https://developers.google.com/workspace/admin/directory/reference/rest/v1/users/list).

### Alias capture identity sequence

TEST package `067_workspace_identity` was installed only after its exact rollback
rehearsal. The new discovery handler and capture ports require its two columns and
identity guard; schema precedes runtime. Production must use a production-specific
manifest and approval, never the TEST package. Existing bindings start unverified.
A complete authorised directory refresh must establish an alias's primary before
V1 capture can accept the primary address returned by Gmail. Source account IDs
and old email namespaces must remain intact.

If ownership changes, the guard retains the original primary and latches a hold.
A normal refresh or generic retry must not clear it. Operator disposition remains
an explicit reviewed recovery action, with preservation evidence. For rollback,
pause affected capture before reverting matching runtime; retain new binding and
conflict evidence instead of dropping columns after they have been populated.
Positive hosted real-data acceptance remains open.

## TEST 068 mailbox-wide email prerequisite — 11 October, 19:24 UTC

TEST 068 and worker v14 now read message additions without an Inbox/Sent filter.
The first v3 recent generation reconciles the mailbox, including Spam/Trash;
existing in-flight v2 pages remain unchanged. See the
[verified TEST evidence](evidence/learn-email-mailbox-coverage-test-2026-10-11.json).
This is not production promotion approval or real mailbox coverage acceptance.

The pinned TEST package uses the existing postgres administrator's ADMIN membership
only inside its migration transaction: a temporary grant enables protocol-owner
inheritance for replacement, is revoked before assertions, and original memberships,
function owners and ACLs must compare exactly. No lasting permission is added.
Production must first prove the corresponding original function hashes, authority
and full source preservation; do not execute the TEST-targeted package there.

Deploy the matching worker before allowing new v3 capture. For rollback after v3
checkpoints exist, pause new Email capture and keep a worker capable of both v2/v3
recovery. Do not downgrade the transition function or reinterpret ALL page tokens
as Inbox/Sent. Preserve v3 receipts and checkpoints and recover forward; any older
code rollback requires a separately reviewed compatible recovery plan. No data
or cursor reset is an acceptable rollback shortcut.

Real-provider initial reconciliation, subsequent capture, source-to-card acceptance,
score eligibility (including draft/spam treatment), and operator recovery still
need acceptance before this change can be part of an approved production release.


## Draft eligibility release gate — TEST 069

The draft guard retains Gmail source messages and existing canonical records,
while excluding labelled drafts from new customer communication publication,
identity attribution, card excerpts and activity counts. Source revision changes
make later corrections eligible for reassessment without rewriting receipts.
The worker parser requires the matching page-store update: new drafts have
unknown direction and no sent timestamp. Install the database before its worker.

A read-only production metadata check identified 55 retained Gmail drafts, each
with an existing canonical interaction. Before promotion, inspect their derived
card summaries, relationships, aggregates and scoring evidence and prepare a
bounded, reviewed reconciliation with before/after preservation evidence. Do not
delete source messages, canonical history or immutable receipts to hide the issue.
This observation does not establish 55 incorrect staff scores.

Do not use the TEST-pinned package in production. Prove the production function
and role prerequisites and build a separate release manifest. Pause affected
capture before a rollback; keep the draft-aware page-store and publication guard
compatible, and recover forward without restoring draft reply attribution.
Real-provider capture, signed-in card acceptance, Spam eligibility and provider
label/deletion handling remain open launch requirements.


### Card refresh must also use eligible sources

TEST 070 installed `20261101390000_learn_card_projection_eligibility.sql` after
full-schema and exact-package rollback rehearsals. Matching `platform-worker` v16
and `customer-card-sync` v2 passed download comparison, handler tests and HTTP denial
checks. A positive service-to-service synthetic refresh passed over hosted HTTP,
including isolation, source preservation and completed jobs; fixtures are archived.
This is not signed-in or real-provider acceptance. For the separately reviewed
production release, deploy the database function before matching callers. The
scheduled wrapper enqueues the shared worker and needs no independent eligibility logic. Preserve the function during a runtime
rollback. Do not run a legacy card refresh as a repair: it can reintroduce drafts.

The 19:57 UTC production audit found four draft-linked recommendations and 95
match suggestions. Its 178 person/company-associated cards are a review boundary,
not a list of proved corrupt cards. None had an exact draft summary/timestamp
match; all had legacy/unversioned priority inputs. Refresh eligible projections
with revision-checked writes, retain historical source/derived records, and review
unversioned priority and indirect recommendation influence separately. Do not
rewrite manual text, accepted identity decisions or saved performance evidence
based solely on a shared company link. See the
[impact evidence](evidence/learn-email-draft-impact-2026-10-11.json) and
[TEST verification](evidence/learn-card-draft-projection-2026-10-11.json).
