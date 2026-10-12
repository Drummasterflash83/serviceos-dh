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
