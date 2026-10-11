# LEARN phone account binding — TEST acceptance, 10 October 2026

Call and recording sync, connection tests and recording downloads previously
accepted an arbitrary requested provider customer or fell back to the first
customer visible through the shared Simwood credentials. A signed-in company
boundary therefore did not itself establish which provider account would be read.

The implementation now resolves accounts through the existing server-managed
`tenant_connectors` / `connector_accounts` registry. It verifies both tenant IDs,
the relationship, Simwood provider/connector identity, enabled state and active
account status. A connector with operational `error` status can still recover when
explicitly enabled; disabled, paused or revoked connectors cannot start work.
A complete, duplicate-free bounded registry read is required. An omitted customer
selects only a unique active company account; an explicit customer must match an
active registered account. The existing `settings.provider_customer_id` override
and legacy `account_key` fallback remain supported. Credentials remain server-side
and unchanged. No caller can fall back to provider-wide customer discovery.

Connection tests request the specific account and verify the returned ID before
exposing its safe metadata. Downloads verify the recorded URL names the exact
registered account and recording. Matching HTTP links are upgraded to HTTPS;
foreign hosts/accounts, userinfo, nondefault ports, query strings, fragments and
unexpected paths are refused. Missing URLs use the canonical endpoint only after
resolving a unique registered account. With multiple accounts, a valid stored URL
can select its registered account; a missing/ambiguous account cannot silently
choose one. Existing stored audio returns without needing provider credentials,
fetching audio or uploading a replacement. Explicit force-download behavior is
otherwise unchanged.

Shared JSON/audio fetches now refuse redirects and have a 60-second timeout;
connection checks use 20 seconds. Existing source upsert keys, sync-window
completeness rules, recording storage pointers and processing schedules are unchanged.
This is a read-time binding, not a transactionally fenced lease: concurrent registry
reconfiguration during a long run still requires a publication/claim design.
No automatic provisioning or separate per-company credential store is added.

## Evidence

The actual resolver's joined query was accepted by the current production registry
using existing verification credentials in a read-only call. It matched the
previously inspected active Drummonds account. Twenty-five latest recording URL
samples were accepted by the new URL guard. No provider request or audio read was
made. This sample does not establish compatibility with every historical URL.

The preservation comparison at 00:40:31 UTC, completed 00:41:02, found no missing
baseline IDs across eleven tables, no changed recording pointers, and no missing
or changed inventoried storage objects. Current counts were 18,456 emails, 4,324
calls, 2,882 recording/transcript rows, 22,792 interactions and 3,154 customer cards.
All 2,882 recording pointers matched storage objects larger than 44 bytes. Six
transcripts remained failed; jobs and voicemail rows remained zero. These are
stored observations, not complete provider coverage, playable-audio proof or a
backup/restore test. Full manifests remain in ignored private verification output.

Ten pure/completeness tests and ten actual-handler tests with synthetic database
and provider ports passed. The handler harness evaluates the actual TypeScript
source/imports in a Node VM; it is not a deployed Deno test or a live provider test.
Strict typechecking of all four handlers and their imports passed with the pinned
Supabase SDK declaration shim. It also caught existing closure-nullability and
Blob buffer typing problems, now resolved without changing source identities.

Reproduce local checks:

```sh
node --test supabase/functions/_shared/simwood-account.test.ts supabase/functions/_shared/phone-sync-completeness.test.ts
node --experimental-vm-modules --test scripts/verify/learn-phone-account-handlers.test.mjs
node node_modules/typescript/bin/tsc --noEmit --strict --allowImportingTsExtensions --module esnext --moduleResolution bundler --target ES2022 --skipLibCheck scripts/verify/learn-phone-account-globals.d.ts supabase/functions/simwood-sync-calls/index.ts supabase/functions/simwood-sync-recordings/index.ts supabase/functions/simwood-download-recording/index.ts supabase/functions/simwood-test-connection/index.ts
```

See [combined evidence](evidence/learn-phone-account-binding-local-2026-10-10.json),
[actual registry read](evidence/learn-phone-account-read-2026-10-10.json),
[URL compatibility sample](evidence/learn-phone-url-binding-sample-2026-10-10.json)
and [preservation comparison](evidence/learn-preservation-phone-binding-2026-10-10.json).

## Release and remaining work

The local milestone above made no hosted change. The TEST release and acceptance
below now supersede its hosted-acceptance gap. Production deployment still requires
its own registry/schema/version inspection and broader historical URL verification.
Deploy only reviewed phone functions and dependencies; do not blindly apply pending
migrations or change Emma.
Missing provider accounts must be configured through an authorized operator flow,
not guessed from the first provider customer or silently enabled.

Voicemail discovery still needs the existing provider-credential environment and a
verified message/audio API contract. This account resolver does not discover or
capture voicemail. Provider reconciliation, failed-audio repair, backup restoration,
continuous coverage, tenant credential lifecycle and the wider LEARN V1 scope remain.


## TEST deployment and signed-in acceptance — 10 October

Four reviewed endpoints are now runtime v1, ACTIVE, with JWT verification enabled:
`simwood-sync-calls`, `simwood-sync-recordings`, `simwood-download-recording` and
`simwood-test-connection`. The exact nine-file bundle SHA-256 is
`56d1b9c228d80f6b84e79b7a814b4d957f93fe3f7dd6313e22d8c8cb25641249`.
No provider credentials were added; metadata checks before and after acceptance
confirmed neither Simwood credential exists in TEST.

The first deployment post-check expected the historical three-endpoint inventory
and stopped. Read-only inspection confirmed that only the four reviewed endpoints
were added; removing those additions restores the exact prior release fingerprint.
No deployment was repeated. The new recognizer pins complete endpoint metadata and
preserves the original release checks. Current UI/fixture launchers use the new
release recognizer; historical release scripts retain their historical contracts.

The first signed-in acceptance passed authorization checks but could not open a
sync run: TEST deliberately lacked server-role permissions on the three phone
tables. That run was retired with its evidence intact. Its source comparison was
not reached, so its `preExistingSourcesPreserved: false` means unverified in that
run, not an observed deletion. The subsequent successful run compared all existing
TEST source rows, including that initial fixture.

Release 015 (`learn_phone_service_access_v1`) adds only SELECT, INSERT and UPDATE
for `service_role` on `phone_calls`, `phone_recordings` and `phone_sync_runs`.
Anonymous/authenticated grants remain unchanged; DELETE and TRUNCATE remain denied.
Existing registry and audit permissions remain unchanged. The exact permission
matrix is now checked separately because the older catalog's combined `serviceDml`
flag does not distinguish these partial grants. Hosted rollback rehearsal restored
the full prior fingerprint, then installation/readback passed: 89 public tables,
sixteen release receipts, unchanged earlier definitions, privileges and endpoints.
No source rows were changed by the permission release.

Fresh actual Auth/HTTP acceptance verified:

- Anonymous, viewer and wrong-company callers are refused.
- Both companies are denied the other registered provider account; invalid IDs fail.
- Owner/admin/ops reach their own account and stop at the missing-credential gate.
- A stored synthetic recording pointer returns without provider credentials; missing
  audio stops at the credential gate, and foreign account URLs/recording IDs fail.
- Disabling a connector blocks new work while its cached pointer remains available.
  Demoting a user blocks the same existing session.
- Counts and full-row fingerprints match for all pre-existing TEST email, phone,
  transcript, Slack/version and interaction records.

The successful fixture retains one call, three recording rows, 23 finished sync
runs and 23 audit rows. Both fixtures retain their records; all six synthetic users
were banned, had passwords rotated and became viewers. Final independent readback
confirmed zero active fixture accounts/connectors, approving users or running syncs.
The synthetic pointer had no audio object: this proves response behavior, not audio
playback. No real provider request, production mutation, scheduler or paid processing
occurred. Storage upload, live capture, voicemail, concurrent publication fencing
and production release remain outstanding.

Eight focused deployment/catalog/access tests passed, including privilege/runtime
mutation rejection, rollback, stale rehearsal rejection and uncertain-write handling.
The ten actual-handler VM tests, ten pure/completeness tests, seven historical
release tests and strict handler typecheck also passed.

Evidence: [deployment](evidence/learn-test-phone-deploy-2026-10-10.json),
[deployment confirmation](evidence/learn-test-phone-confirmation-2026-10-10.json),
[initial acceptance](evidence/learn-test-phone-acceptance-initial-2026-10-10.json),
[permission rehearsal](evidence/learn-test-phone-access-rehearsal-2026-10-10.json),
[permission installation](evidence/learn-test-phone-access-installed-2026-10-10.json),
[signed-in acceptance](evidence/learn-test-phone-acceptance-2026-10-10.json), and
[final readback](evidence/learn-test-phone-final-2026-10-10.json).

## Phone page controls — TEST v4, 10 October 18:33 UTC

Call and recording sync now revalidate the pinned provider account and OpenFolk
Phone switch before each bounded page, after its response before saving, and
before reporting completion or launching follow-on processing. Disabling or
replacing the account/connector stops the run; a matching provider customer on a
new registry row does not inherit the old run. Saved earlier pages remain intact,
the interrupted window is incomplete, and the scheduler retains its cursor.

Both TEST sync endpoints are now version 4 with JWT verification. No phone
credentials, channels, schedules or access grants were added. Thirty-five actual
handler tests and ten account/completeness tests pass, plus strict handler
TypeScript and eight deployment tests. Sixteen tests pass against downloaded
published handlers; eight actual HTTP cases verify JWT denial, method handling
and the archived fixture's paused path. All 70 monitored TEST datasets remain
unchanged. Production is unchanged.

This is per-page read-time revalidation, not an atomic publication fence: a
concurrent change between the last check and its database write remains possible.
Concurrent new-recording processing and real provider end-to-end capture still
need separate verification. [Release evidence](evidence/learn-phone-page-guards-hosted-2026-10-10.json).


## Atomic page publication — local candidate, not deployed

The new migration `20261101006000_learn_phone_page_publication.sql` and both local
sync handlers publish each bounded page through one service-only database RPC.
It locks against the existing OpenFolk capture controller, verifies the pinned
company/account/connector and active run, writes source metadata and appends an
immutable receipt in one transaction. Direct Phone/master flag changes also take
that controller lock. Account/connector/tenant row locks fence changes through
publication. Exact replay returns the existing receipt; changed replay or skipped
pages are refused. Empty exhaustion pages receive receipts too.

Recording inserts use the source unique constraint to identify genuinely new
recordings under concurrency. Existing recording IDs, creation timestamps and
storage paths are retained. The handlers no longer perform a separate existence
read or direct source upsert. They accept only matching versioned receipts. A
lost response, malformed receipt or database failure leaves the window incomplete,
with no blind retry, direct-write fallback or follow-on processing. Receipts are
available for operator reconciliation, but automatic reconciliation is not yet wired.

Verification passed in a disposable networkless PostgreSQL 15 database using the
original source/registry definitions: migration rollback, replay/conflict/sequence,
tenant bounds, audio-pointer retention, page limits and privileges, receipt failure
rolling back source writes, concurrent pause-first/publication-first/account-disable
ordering, and concurrent recording inserts yielding exactly one new classification.
All 42 actual-handler VM tests, 10 account/completeness tests and strict four-handler
TypeScript checks passed. Synthetic ports also prove empty-page receipts, safe
unknown outcomes and processing only database-confirmed new recording IDs.

**Deployment status:** local only. TEST remains on sync handlers v4. Install the
additive schema through a fresh, pinned TEST package and verify it before deploying
these dependent handlers. No hosted schemas, credentials, source records, schedules,
access grants or production deployments changed in this checkpoint.

**Remaining limits:** page publication is atomic, not the entire sync/pipeline.
Final run completion and scheduler cursor updates remain separate writes. Existing
background processing is not a durable outbox; interrupted/uncertain runs can leave
new recordings needing explicit recovery. The receipt does not itself guarantee
exactly-once audio download/transcription. Real provider acceptance, TEST hosted
acceptance and production promotion remain outstanding.

[Local evidence](evidence/learn-phone-publication-local-2026-10-10.json).


## Atomic page publication — TEST release 039 and sync v5 installed

Release **039** installed at **18:49:30 UTC on 10 October**, after a successful
rollback rehearsal. The call and recording handlers were replaced with **v5** at
**18:51 UTC**, retaining JWT verification. Both now use the atomic page RPC.
The earlier local-only deployment status above is superseded by this release.

Hosted service-role SQL acceptance exercised real page writes and receipts,
exact/conflicting replay, sequence and tenant denial, pause/account checks,
existing recording storage-pointer retention, immutable receipts, and a bad
second record rolling back the whole page. Every synthetic fixture was rolled
back; the receipt table remains empty. No identities, grants or credentials were
created and no real provider was contacted.

All **74** monitored datasets retained their full-row fingerprints, including
existing calls, recordings, transcripts, run/audit history, source registries,
Slack thread windows and stored-object metadata. Ten HTTP checks passed across
both handlers and the new REST RPC: JWT/anonymous denial, wrong-method handling,
archived-company pause and missing-run rejection. The downloaded published
handlers pass **23** relevant synthetic-port tests. Fourteen release/deployment
tests pass, in addition to the previous 42 local handler and 10 pure tests.

Package SHA-256: `fd2625a9d31f8cf7a99d89b4915796d601ac3b8505ee7da72f03f26185585ee4`.
Post-release Phone catalog: `0fb6d70902c76e37549ef65c157b8be9` (40 ledger entries).
Runtime dependency bundle: `7bc5b81b3770806e975b9dc742f1b05e295a38fddbc9ab319b7916165171f285`.
Earlier exact-state release wrappers are now historical and must not be reused.

**Still required:** durable recovery of newly captured recordings after an
interrupted/uncertain run, confirmed final run/cursor persistence, and real
provider-to-client acceptance. These tests prove atomic metadata publication,
not exactly-once audio/transcription or a complete live Phone service. Production
is unchanged. [Hosted evidence](evidence/learn-phone-publication-hosted-2026-10-10.json).


## Recovery selector — TEST release 040; runtime safeguards local

The existing database-backed recovery selector is the durable inventory of
unfinished recordings. It can find a recording even when its import loses its
response or never starts background processing; a new outbox is not required
just to retain that work. A hosted synthetic test exposed a missing TEST
prerequisite: service-role selection failed with `42501` on `phone_transcripts`.

Release **040** installed at **19:01:22 UTC on 10 October**, after a rollback
rehearsal. It grants only five service-role SELECT columns: tenant/recording/status
on transcripts and tenant/recording on insights. Independent permission comparison
confirms those exact changes; transcript text, insight content and source write
permissions remain unchanged. No browser grants or identities were added.

Real TEST SQL now proves interrupted-import recovery, per-recording review holds,
retention of failed-attempt history, backlog visibility, company isolation and
existing page/receipt invariants. All synthetic rows were rolled back; all **74**
monitored datasets retain their fingerprints. The new publication receipt table
remains empty. Local PostgreSQL also exercises stage progression from download
through transcript/insight completion without deleting prior failures or audio.

The local recovery runtime now refuses duplicate/manual untracked work, confirms
its queued-to-running claim, checks the job's company/type/owner/attempt/unexpired
lease before work and after each child, and conditionally settles the same claim.
Failed partial batches retain failed/retrying status. Unknown acknowledgements
remain unconfirmed; no generic worker completion overwrites them. Selection and
backlog errors cannot become an empty successful batch, and child success must
match the recording, HTTP success and completed stages. Capture pauses retain
visible waiting work; existing stored audio can still be processed.

**Runtime status:** not deployed yet. Fifty-nine actual endpoint/worker VM tests,
nine recovery lifecycle tests, five release tests, and targeted strict TypeScript
checks pass. Hosted acceptance of these runtime changes is still needed. Batch
ownership is not a per-recording claim: direct/manual/background pipeline requests
can still race, and a child can outlive a lost lease. Complete provider acceptance,
final import/cursor settlement, processing authorization and production promotion
remain outstanding.

Package: `1d124044e33984ec4a1ab109fe29e0dc7b73ebaf236a29c8a96804900b0f21b4`.
Current Phone catalog: `dddd1851fbb564cd1f1252d8b1874d79` (41 ledger entries).
[Recovery evidence](evidence/learn-phone-recovery-2026-10-10.json).


## Recovery runtime — TEST worker v5 and manual endpoint v1

At **19:06 UTC on 10 October**, TEST `platform-worker` was replaced from v4 to
**v5** and `phone-process-pending` was installed as **v1**. The manual endpoint
requires JWT verification; the cross-tenant worker retains its exact internal
service/schedule-secret gate. No scheduler or real provider credential was added.
The preceding local-only runtime status is superseded by this release.

The reviewed dependency package contains 98 source files and is pinned to the
release-040 schema. Comparison with the prior published worker found the expected
Phone changes plus the recurring Slack authority/timestamp checks already verified
for the dedicated Slack worker in release 038. The other reported differences
were formatting/brace structure or type-only imports. Nine deployment tests and
28 focused shared Phone/Slack tests pass.

Eight hosted HTTP checks pass: unauthenticated/anonymous refusals, method handling,
authorized idle worker with zero claimed jobs, and one positive **empty** manual
recovery run in the existing retired synthetic company. Its returned job ID matches
a durable succeeded row with one attempt, zero processed recordings and no remaining
lease. Exactly one synthetic job (`54b3e666-3ba5-46ec-bd1c-0a58c71a8ac1`) is retained
as evidence. All 74 pre-existing dataset fingerprints match after excluding only
that new row; no source communication, stored object or grant changed.

Downloaded published code passes 15 actual-worker control-flow tests, two manual
endpoint test groups and nine lifecycle/recovery-handler tests using synthetic
ports. These cover duplicate/manual claim failures, owned settlement, retry/failure
outcomes, unknown acknowledgements, paused health and the existing email worker
paths. This is not positive acceptance of real recordings, paid processing or a
signed-in browser flow. Per-recording claims and final import/cursor settlement
remain outstanding; production is unchanged.

Bundle SHA-256: `ba30442581d897ece5658d2b9f2ddb844034641df6d3bf7eb2805aeb47d1f672`.
Runtime catalog: `20303a1bf930ea5d60896b16d7c8c42f`; full Phone catalog remains
`dddd1851fbb564cd1f1252d8b1874d79`.
[Published runtime evidence](evidence/learn-phone-recovery-runtime-2026-10-10.json).


## Import completion — locally verified, not deployed

The call/recording handlers previously issued an unchecked final success update;
recording processing also started before that write. The candidate now uses a
service-only `learn_phone_complete_import` transaction to match all saved page
receipts to the company, run, account, connector, provider customer and input kind,
check the page/record totals and original window/filter metadata, recheck capture
and account authority, and save success with an immutable completion receipt.
Exact replay returns the original receipt, including after a later pause.

An unknown acknowledgement returns `phone_completion_unconfirmed` and preserves
the possibly committed run; it neither retries nor overwrites it as failed. Known
pause/account refusals conditionally fail only the same tenant's running run.
Recording background work starts only after receipt validation. Metadata records
`auto_pipeline_eligible`, not an unproven count of completed/started jobs. A process
that stops before that handoff leaves saved recordings available to the existing
backlog recovery selector. Zero-duration input ranges are rejected before work.

All **52 actual-handler VM tests** pass, including malformed/lost final receipts,
empty imports and no follow-on work when completion is unknown. Strict TypeScript
passes for both modified sync endpoints. Actual SQL in networkless PostgreSQL 15
proves success/receipt atomicity, failure rollback without lost pages, both source
kinds, preserved stored audio, scope/filter/count checks, immutable private receipts,
exact replay, and concurrent pause-first/completion-first/account-disable ordering.
The suite also reruns the prior page-publication and recovery assertions.

**Not deployed.** The scheduler still needs durable child-receipt verification and
atomic cursor/health settlement before this path is ready for a combined TEST
release. The database proves retained pages and matching scope/counts; provider
exhaustion is still calculated by the trusted handler. This is not evidence of
real provider coverage, paid processing, signed-in acceptance or production readiness.
[Local evidence](evidence/learn-phone-import-completion-local-2026-10-10.json).


## Scheduler settlement — locally verified, not deployed

The scheduler now requires a newly created, confirmed job claim and parent run
before dispatch. Duplicate active jobs are skipped; claim loss stops subsequent
work. Claims expire after five minutes and renew only while the same attempt is
still owned. The database rechecks ownership and lease at settlement.

`learn_phone_settle_schedule` confirms the completed child runs and immutable
import receipts match the company, account, provider customer, input kind,
window and expected unfiltered scope. Saved page receipts supply record counts.
The account's original `updated_at` revision must still match: an intervening
configuration change or competing settlement prevents stale success/failure
writes. A window cannot skip the existing cursor or move it backwards.

Run status, job status, merged account cursor, connector health and an immutable
settlement receipt commit in one transaction. Paused/failed outcomes keep the
cursor. One account's success cannot make the connector healthy while another
active account has no successful import or has an unresolved error. An unknown
acknowledgement never triggers fallback success/failure/status writes. Exact
receipt replay is read-only, including after a later pause.

All **56 actual-handler tests** and strict TypeScript checks pass. The actual SQL
suite in networkless PostgreSQL 15 covers whole-transaction rollback, retained
cursor fields, successful/paused/failed outcomes, stale account revisions,
replaced/expired job claims, missing child completion receipts, old or changed
child scopes, cross-tenant/wrong-kind denial, cursor gaps, multiaccount health,
private immutable receipts, and real concurrent settlement/pause/replay ordering.
It also reruns the preceding publication, recovery and import completion checks.

**Not deployed.** The import completion and scheduler candidates need a combined
TEST schema/runtime release and hosted acceptance. Late controller changes, lost
claims and unknown acknowledgements leave retained evidence for reconciliation;
there is no claim that these runs automatically reconcile yet. No real provider,
paid processing, signed-in acceptance or production readiness is established.
[Local scheduler evidence](evidence/learn-phone-schedule-settlement-local-2026-10-10.json).


## Import and scheduler settlement — TEST release 041 installed

The combined schema package installed at **19:33 UTC, 10 October**, after a matching
hosted rollback rehearsal. Its synthetic probe runs in a savepoint and is entirely
rolled back during both rehearsal and installation. Real TEST service-role SQL
verifies import completion/replay, browser/tenant refusal, scheduled success with
retained child evidence, cursor merge, account/owner/pause checks, paused/failed
outcomes, coherent job/run status, retained audio pointers and immutable receipts.
All **75 pre-existing datasets** retain their fingerprints, and both new receipt
tables remain empty after acceptance.

At **19:36 UTC**, `simwood-sync-calls` and `simwood-sync-recordings` became **v6**
(JWT required), and `phone-scheduled-sync` was installed as **v1** with its existing
shared-secret gate. The complete pinned runtime closure contains 14 files. No
provider credential, user, grant or schedule was created. There were no active
Phone schedules, and `PHONE_SCHEDULE_SECRET` remains absent: the scheduler is
**deployed but unconfigured**, not an active capture service.

All **18 actual HTTP checks** pass: missing/anonymous authority, method handling,
retired-fixture capture pause, zero-duration window refusal, anonymous RPC denial,
missing-run RPC refusal and the unconfigured scheduler's fail-closed response.
The HTTP checks preserve all 75 datasets and leave both new tables empty. Downloaded
published code passes **39 relevant handler tests** with synthetic ports; the
compound pause test also exercises the unchanged local pipeline handler. Fifteen
release/deployment tests pass. A path-selection bug in the readback harness was
fixed before the successful published-code run; no runtime redeployment was needed.

This supersedes the preceding local-only deployment status. Real provider capture,
authorized configured scheduler HTTP dispatch, paid processing, signed-in user
acceptance and production promotion remain unverified. Per-recording concurrency
and automatic reconciliation of all unknown outcomes remain separate work.

Package SHA-256: `1cebbbe0f05f4cee9b026663dbc0dc8e2d9f70b2b309b623267156e9bb11fe85`.
Runtime bundle SHA-256: `2f1240af960444e7266ffc54ed880c32f6252b7c9ed658356e2786a402f7869e`.
Full Phone catalog: `dff384a353e7dfa581173586a0d7cbe5` (42 ledger entries).
Runtime catalog: `f27bc878a6d07993fb40647b44d5a72d`.
[Release evidence](evidence/learn-phone-settlement-release-2026-10-10.json).


## Phone operator evidence — TEST release 044 installed at 21:24 UTC

OpenFolk can now distinguish receipt-confirmed scheduled Phone capture from
company-wide recording processing. Confirmation requires agreement between the
account, job, import window, settlement receipt and completion time. A timestamp
alone cannot claim successful capture. Pending downloads, transcription, analysis,
review holds, retry delays and provider waits have separate counts.

The exact hosted rollback rehearsal and installation passed. A synthetic probe
uses the actual service-role publication, import completion and scheduler settlement
path, checks the resulting evidence and deliberately mismatched windows, then
rolls every fixture record back. Existing operator grants and ownership are retained;
the two evidence helpers remain private. Six actual HTTP checks confirm anonymous
and service-role denial. All **78 monitored datasets** retain their fingerprints,
including the real Commusoft records and paused checkpoint. Five release tests,
seven client-model tests and the local operator/publication/concurrency suites pass.

The existing protected TEST frontend already contains this evidence UI, so no new
frontend deployment was needed. Fresh signed-in operator and visual acceptance
remain pending. This release creates no login, access grant, provider request or
paid processing, and does not configure or activate a Phone schedule. Production
is unchanged. It does not establish complete Phone/voicemail coverage.
[Release evidence](evidence/learn-phone-operator-evidence-test-2026-10-10.json).

Package SHA-256: `2f4ab8b1809f9227ca5978c1a136117d640bcae788444a994f0289bb86e9e5f3`.
Catalog after installation: `9ee01e0acbf88bba5667ca80c429ea19` (45 ledger entries).

## Pipeline completion acknowledgement — local verification, 11 October

The pipeline previously returned success even if its terminal `phone_sync_runs`
write failed or returned an error. It now conditions that write on the exact
company, run, provider, pipeline type and running status. Success requires the
returned row to match the status, timestamp, counts, error and complete metadata.
A lost acknowledgement triggers one exact readback; it never repeats the mutation
or any processing child. An unmatched or unavailable result returns a safe 503
`phone_pipeline_completion_unconfirmed`, preserves completed-stage information and
does not publish a misleading success audit. Recovery jobs treat that code as
requiring review, rather than automatically retrying paid/provider processing within that job.
This does not create a durable recording-level hold: a separate scheduled/manual
job can still select an incomplete recording after the existing running timeout.
Per-recording ownership and review/reconciliation remain release requirements.

**71 focused local checks pass:** 58 actual-handler checks and 13 completion/recovery
checks. Cases include unchanged successful processing, both success/failure writes,
lost replies, missing/foreign/conflicting terminal rows, PostgreSQL JSON key order
and timestamp formatting, and no automatic retry after uncertain completion.
Strict TypeScript passes for the affected handler, helper, recovery worker and tests.
These are synthetic database/provider checks, not hosted or live-call acceptance.

A fresh read-only TEST endpoint inventory confirms an additional release gap:
`phone-process-pipeline`, `phone-transcribe-recording` and
`phone-analyse-transcript` are absent. Existing TEST endpoints include download v3,
sync calls/recordings v6, scheduler v1, pending processor v1 and platform worker v6.
Database catalogs still match diagnostic release 054. The processing handlers
must be reviewed, tested and released together with their complete dependency
closures and the matching recovery handlers before claiming the full journey.
In particular, child transcription/analysis terminal-write handling and per-recording
concurrency still need review; this change does not assert their durability.
No TEST/production runtime, data, credentials, schedules or permissions changed.
[Local and TEST inventory evidence](evidence/learn-phone-pipeline-completion-local-2026-10-11.json).


## Download ownership, retained versions and recovery — local, 11 October

A forced download previously uploaded to the existing path with overwrite enabled.
The candidate now records exclusive ownership before the provider request, prepares
an immutable attempt-specific path and SHA-256, uploads with `upsert: false`, then
reads and hashes that exact object. Only verified bytes may advance the recording
pointer. One SQL transaction publishes that pointer, finishes the run and records
an immutable completion receipt containing the previous path. Prior audio stays
in storage. Cached returns and preflight failures also require a confirmed run write.
Provider bodies are bounded while streaming, including when Content-Length is absent.

An upload with an uncertain outcome retains ownership in `needs_review`; expiry
never permits another attempt to take over. The pending selector excludes held
incomplete recordings in later manual/scheduled batches. New claim, preparation
and publication recheck the company capture switch, account registry and source
snapshot. Completed receipt replay does not restart capture and remains readable
while capture is paused. Private attempt definitions are service-only; application
roles cannot read or change this journal.

The download endpoint accepts `resume_run_id` for owner/admin recovery. It requires
the matching authenticated company and recording, loads the server journal's file
path/hash/size, reads and verifies that file, and completes only the original attempt.
It creates no run, obtains no provider credential, calls no provider and uploads no
file. Missing/corrupt bytes, changed source, paused capture or unavailable account
leave publication unconfirmed. `force` cannot be combined with resume. A running
attempt without a prepared file cannot be resumed this way and stays held for
operator investigation; no unsafe automatic abandonment or lease stealing is added.

**83 focused local checks pass:** 62 actual-handler checks and 21 helper/recovery
checks, plus strict TypeScript. A disposable, network-disabled PostgreSQL 15 run
verifies real SQL concurrency, tenant isolation, exact receipt replay, paused and
changed-source refusal before publication, account disablement, held selection,
atomic rollback on injected failure, restricted privileges, and migration rollback
including the prior readiness function body/owner/ACL. The fixture uses current
readiness semantics; it is not a full hosted-schema release rehearsal.

Still required before coordinated Phone TEST activation: equivalent transcription
and analysis ownership/completion and output history; links between derived results
and their precise audio version; full-schema integration; operator UI for inspecting
and reconciling attempts, including forced downloads of otherwise completed records;
real-provider, signed-in and recurring-capture acceptance. The journal supports stage
names for future integration, but existing transcription/analysis handlers do not
claim it yet. This must not be represented as full pipeline concurrency protection.
TEST/production runtimes, source data, credentials and capture schedules are unchanged.
[Download evidence](evidence/learn-phone-download-attempts-local-2026-10-11.json).


## Transcription, analysis and attribution versions — local and TEST rehearsal, 11 October

Both actual processing handlers now use the same exclusive recording journal as
new downloads. A confirmed dispatch is permission for one provider request only.
A lost dispatch acknowledgement stops before a paid call; a lost provider response
keeps a review hold that expiry cannot steal. Confirmed provider rejection (such
as rate limiting) can close the attempt for later retry. Existing results are never
marked failed or replaced merely because their forced replacement failed.

Returned outputs are prepared privately before publication, including when capture
has been paused since dispatch. Paused or changed sources cannot publish. An exact
owner/admin `resume_run_id` request reads the saved attempt and publishes its already
prepared output, or returns its exact completion receipt, without obtaining a key or
repeating the provider request. A dispatched attempt without a saved output remains
held; operator investigation and an explicit, reviewed disposition are still needed.

Publication is one transaction: archive the prior projection, write the new current
transcript/insight, retain source path/content hashes and the prepared model output,
finish the run and save the receipt. Current row IDs and relationships remain stable.
Legacy observations are retained without fabricated historical content hashes.
After a new audio version, older transcript/insight content remains stored but no
longer counts as current processing. Analysis is tied to the exact transcript hash.

Participant attribution previously used separate unchecked writes, including deleting
current participant rows before knowing the replacement could be stored. It now
prepares a server-derived publication with the analysis. The same SQL transaction
checks call/recording linkage and the call-source snapshot, archives old direction,
participant and normalisation rows, and publishes their replacements and the identity
summary. A failed participant insertion rolls back the entire analysis publication.
Raw model output cannot assert that attribution was published: health uses the database
receipt. Missing context remains explicitly uncomputed. Partial model analysis cannot
replace the prior result by filling all other fields with defaults.

The provider helpers now refuse redirects, bound request duration, and keep private
network-error prose out of responses. Existing model configuration is retained.
Transcription refuses files above the documented 25 MB input limit before dispatch;
larger files still need a conversion/chunking workflow, not silent truncation.
[Official file-transcription documentation](https://developers.openai.com/api/docs/guides/speech-to-text).
The analysis instruction now uses the supplied company context rather than assuming
all future clients operate in heating and plumbing.

**Verification:** 68 actual-handler tests and 33 helper/recovery/provider-error tests
pass (101 total). Strict Edge TypeScript, application TypeScript and the application
build pass. Isolated PostgreSQL 15 checks exercise complete transcription-to-analysis
publication, preserved old text/summary/identity rows, source hashes, stale-audio and
stale-summary detection, pause-after-dispatch retention, exact reconciliation,
confirmed rejection vs uncertain outcome, rollback after partial failure, restricted
roles and real concurrent transcription/analysis claims sharing one recording owner.

The hosted TEST inspection found five missing Phone Intelligence foundation tables
and no configured OpenAI key. Production secret-name metadata confirms an existing
key is configured; no secret values were read. The prepared schema candidate includes
the existing Phone Intelligence and endpoint-directory migrations, followed by the
new download and processing migrations. Its full TEST-schema rehearsal at 09:42 UTC
completed and rolled back, preserving the original schema and 101 checked data sets.
Fingerprints retain all pre-existing columns; only newly added schema fields are
excluded from the before/after rollback comparison. No runtime, schedule, credential,
login or persistent hosted change was made. No OpenAI request was made.

Still required: package and install the coordinated TEST schema/runtime release;
exercise it through deployed handlers and signed-in operator/customer journeys;
expose retained history, held-attempt review and safe reconciliation in the operator
controller; mark stale historical results honestly in customer readers; verify real
provider processing and recurring capture after secure credential reuse. A held
unknown paid request must never be silently restarted to make a queue appear healthy.
[Evidence](evidence/learn-phone-derived-versions-2026-10-11.json).


## Coordinated TEST processing release — 11 October, 10:10 UTC

Release **055** is installed in TEST only. Its exact package hash is
`2a5b63da46ede92ec2e5c73dd3928e060e1955ae996765696e4dce540310b35c`;
installed catalog fingerprint is `7d31c2f3169a9a3da7298a131a7058eb`.
The TEST ledger contains 56 rows including its initial entry. Production is unchanged.

Positive behavioral assertions now run against the complete hosted schema inside
an always-rolled-back probe. This caught missing server read permissions under
TEST's hardened default ACLs. The candidate now explicitly permits server reads
of current transcript/insight projections and the tenant directory/vocabulary.
It adds no browser result access or direct result mutation rights. The exact
attribution-loader projections are checked under the service role. Private history
and attempt RPCs remain unavailable to ordinary authenticated clients.

The release runner pins source hashes, the prior complete catalog, the SQL package
and generated assertion. It requires a recent exact rehearsal before apply,
journals before submission, and compares all 101 pre-existing data sets before and
after the transaction. It never repeats an uncertain submission; exact catalog and
ledger readback establish the result. The release's synthetic probe is rolled back
before commit. Five local release-safety checks and isolated PostgreSQL assertions
pass, including genuinely concurrent claims. The hosted rehearsal and installed
catalog matched their expected fingerprints.

The matching 115-file runtime closure deployed at 10:06 UTC:

| Endpoint | TEST version |
| --- | --- |
| simwood-download-recording | 4 |
| phone-transcribe-recording | 1 |
| phone-analyse-transcript | 1 |
| phone-process-pipeline | 1 |
| phone-process-pending | 2 |
| platform-worker | 7 |

Its source bundle is
`6de94e2033c6a816ee68e01faf75f1b2ef6470cae22487c3a03aad56c12d14e0`.
The deployer checked the exact preceding versions, unchanged unrelated endpoints,
unchanged schema and 108 retained data sets, including the new tables. It neither
configured provider credentials nor enabled capture/schedules.

At 10:10 UTC, a deployed HTTP check verified the full retained-result chain in a
marked, archived synthetic tenant. Download/transcription/analysis returned their
existing results, four parent/child runs settled successfully, two saved receipts
reconciled without new runs or paid requests, and forced processing was refused.
Sixteen negative authority/method/tenant checks passed. All 108 non-fixture data
sets remained unchanged. No auth users, access grants or storage files were created.
The first fixture lacked a required provider recording ID; both rejected runs were
confirmed terminal, retained in their archived synthetic tenant, and a corrected
fixture passed. Neither fixture made a provider request.

This is **retained-result reuse acceptance**, not real transcription, playable-audio
or call-to-card acceptance. The fixture has no source call and no interaction is
claimed. Chris approved creation of a dedicated TEST OpenAI key; the secure picker
is awaiting selection. Operator history/review/reconciliation UI, customer stale
indicators, real provider processing, signed-in journeys and recurring capture
remain open. Do not promote production on the basis of this synthetic check.

Operational recovery: if TEST processing is unhealthy, pause Phone capture and
inspect held attempts before retrying; preserve the journals, versions and current
source rows. Do not drop these tables or edit receipts to make a queue appear clear.
A replacement runtime must be packaged against the installed schema and current
endpoint versions. Existing one-shot release/deploy journals prevent accidental
resubmission; inspect current state after any uncertain response. Production still
requires its separate migration/rollback review and promotion approval.

[Release and HTTP evidence](evidence/learn-phone-processing-test-release-2026-10-11.json).

## Operator attempt review — local and rolled-back TEST, 11 October

The new operator panel lists held and completed processing attempts, including
replacement attempts whose older result remains usable. It exposes safe metadata
only. Existing OpenFolk viewers can inspect; current administrators can reconcile
a saved transcription/analysis result after a reason and explicit review. The
server rechecks authority, source and capture permission. Result publication and
the immutable operator receipt are atomic. Cancellation leaves a request tombstone
and preserves the original processing hold. An uncertain provider outcome with no
saved result cannot be released by this action.

The browser retains requests before submission, scopes them by backend, actor and
tenant, and checks the original receipt after a lost reply. Six client tests and
the offline PostgreSQL suite pass. The actual local component verified lost-reply
recovery and read-only controls; application TypeScript/build passed. At 10:31 UTC,
the same SQL assertions passed against the complete hosted TEST schema in a
rolled-back transaction, preserving 111 datasets including Auth users/sessions.
Synthetic identities had no password/session and were never committed.

This is not installed in TEST or production. A pinned TEST release and signed-in
hosted acceptance remain required. Download recovery still requires the existing
server-side audio verification path; its operator UI and the governed disposition
of no-output uncertain attempts are unfinished.

[Sanitized evidence](evidence/learn-phone-operator-rehearsal-2026-10-11.json).

## Operator recovery — TEST release 056, 11 October

The pinned release rehearsal passed at 10:36 UTC and installation at 10:37 UTC.
All 111 monitored datasets, including Auth identities, sessions, prior sources and
operator grants, were preserved. The release repeats the positive SQL assertions
in a rolled-back savepoint; no synthetic login or authority survives. Ledger now
has 57 entries. Five release-runner tests cover uncertain acknowledgement, exact
readback, preservation, target/rehearsal checks and durable journaling.

Seven real HTTP authority-denial checks passed at 10:38 UTC, with all 112 datasets
(including the new empty audit journal) unchanged. No provider requests occurred.
The matching protected frontend is READY at 10:39 UTC from backed-up commit
`48999ca`, at `serviceos-learn-test-c6le93r67-allkin.vercel.app`. Three HTTP
route-protection checks and actual same-origin client/operator login redirects
passed, with zero observed browser errors. Signed-in
hosted operator acceptance remains open; HTTP denials do not replace it.

[Release evidence](evidence/learn-phone-operator-test-2026-10-11.json).


## Saved transcript and analysis on cards — TEST 058, 11 October

The customer-card recording panel now includes an explicit saved-result reader.
It shows a transcript and advisory AI summary without dispatching capture or model
processing. Transcript pages contain at most 12,000 Unicode characters and bind
continuation to the complete retained text hash. A changed transcript forces a
fresh read instead of joining different revisions. The client admits transcripts
up to 1,048,576 characters; larger records report unavailable rather than pretending
completion. Summaries are bounded at 20,000 characters and explicitly marked if shortened.

Each result says whether its retained provenance matches, has changed, or is
unverified. Historical text remains visible with its warning. A matching transcript
requires its recorded path, SHA-256 and retained publication version to agree;
a conflicting retained download hash marks it stale. Analysis requires the exact
current transcript identity/hash and propagates transcript uncertainty. This is
provenance verification, not a fresh byte-level audio integrity check or a guarantee
of model accuracy. The panel makes that limit explicit. Existing legacy `/app`
call detail/feed surfaces still need equivalent freshness treatment.

The new `learn_phone_saved_results_read` RPC checks the actual caller's current
owner/admin profile and exact company/recording. It returns no storage path,
provider response or raw model payload, adds no browser table grants, and refuses
anonymous or service-role invocation. The browser clears failed reads and ignores
late replies after company/source changes or closing the result panel.

The actual migration and SQL assertions pass locally and against the full hosted
TEST schema in a rolled-back transaction. Release 058's pinned package rehearsal
passed at 12:29 UTC; installation passed at 12:30 UTC with 113 preserved datasets,
59 ledger entries and catalog `6632f3df219ea27a9ccc3f668f198f00`.
No persistent synthetic identities, provider requests or production changes.
Nine client/release checks, application TypeScript and build pass. Local actual
component browser verification covers full two-page text, stale/legacy labels,
read errors and delayed-response isolation. Positive signed-in hosted and real
Drummonds data acceptance remain outstanding.

[Release and browser evidence](evidence/learn-phone-saved-results-test-2026-10-11.json).

The matching protected TEST frontend is READY at 12:32 UTC from GitHub commit
`508dc13172f80fa565e52802105951e01a6687b5`, at
https://serviceos-learn-test-ea944wgld-allkin.vercel.app. Readback confirms the
existing TEST project, staging target and backend binding. Three route-protection
checks pass. The actual browser redirects to same-origin app sign-in with zero
console errors. Three real RPC checks deny no-session/anonymous/service callers.
This does not substitute for positive signed-in result reading; the earlier
playback login remains retired and was not reused.

## Phone-to-LEARN handoff — 11 October, 15:55 UTC

The pipeline could return `success:true` after its finaliser failed to create the
canonical interaction or publish its downstream event. A fresh read-only TEST
check found no `platform_events`, no `interactions.source_version`, and no
`phone_projection_version(uuid,uuid)`. Earlier cached-stage success therefore
must not be interpreted as completed delivery to a LEARN card.

The local pipeline now reports `phone_handoff_unconfirmed` with `failed_step=handoff`
when canonical storage or required event publication is unconfirmed. It retains
all three completed-stage flags and the transcript/insight IDs in the run metadata.
It does not delete or automatically repeat saved audio, transcription or analysis.
The finaliser also checks insight/inventory reads and linkage acknowledgements,
requires the source-version function, scopes call lookup by provider, and sends
changed content back to downstream processing even when an older version was
enriched. Existing person/company attribution is preserved. These corrections are
**local/Git only**, not deployed.

Seventy actual-handler checks, five finaliser cases and three settlement cases
pass; strict backend TypeScript passes. Handler tests cover failed finalisation,
missing event acknowledgement, retained completed stages, no repeated child
requests, and unchanged already-enriched data. Finaliser tests cover failed reads,
failed/conflicting insight linkage and changed-version re-enrichment.

A full hosted TEST rollback rehearsal of the three authoritative legacy schema
migrations reached the actual service-role interaction insert, then correctly
failed because direct INSERT is denied. The test did not weaken that restriction.
Independent readback confirmed the original catalog, all 113 retained datasets,
fixture absence and the original denied privilege. The temporary event table,
projection objects and its service-role privileges are absent after rollback.
No identity, grant, schedule or provider request persisted.

**Next implementation:** replace the legacy multi-request finaliser with a scoped
transactional publisher that validates exact tenant/provider/call/recording,
transcript and insight provenance, preserves source/identity fields, and saves
canonical projection plus downstream event atomically. Rehearse source-version
changes, competing publications, event failure rollback and lost acknowledgements.
Install only through a fresh pinned TEST release; do not grant general direct
interaction writes merely to make the legacy path pass. A durable pending event
still does not prove identity resolution, customer-card refresh or live coverage.
Real provider-to-card acceptance remains open.

[Readiness and rollback evidence](evidence/learn-phone-handoff-readiness-2026-10-11.json).


## Atomic handoff installed in TEST — 11 October, 16:21 UTC

This supersedes the missing-schema and local-only status in the preceding section.
Release `061_phone_atomic_handoff` installs the original event/projection dependencies
and a restricted `learn_phone_handoff` RPC. Pipeline v2 passes exact run, recording,
transcript and insight IDs, requires the matching committed receipt, and saves it
with its own terminal result. It never writes interactions/events directly. A lost
publication reply triggers one receipt inspection, not another publication.

The database locks and validates source provenance, refuses superseded recording
analysis, preserves prior identity/operator metadata, and commits the canonical
row, pending event and receipt together. Exact unchanged enrichment needs no new
event; changed content returns to ready. Unknown legacy provenance remains held.
The receipt is historical evidence and does not promise that later source edits,
identity processing or cards are current. Authenticated clients cannot invoke the
publisher or read raw receipts; service has only the scoped RPC, not raw receipt DML.

The package SHA is `4adc5c61c1949ccff1786c2b3c5c312f78351dcd8528268287c23599ffb53e6b`.
Full catalog: `9780c9f11e60e5219a52088e53a4e6ff`; runtime catalog:
`4246b7cc2a9984347873e0ff4ec9d92d`. Installed at 16:18 UTC after exact rollback
rehearsal. All 113 prior datasets were preserved. For this transition only, the
fingerprint excluded the two newly added nullable interaction columns and asserted
that both remain NULL in every retained row; no existing field was excluded.
Subsequent preservation includes both columns and the two new tables (115 datasets).

Hosted acceptance at 16:21 UTC used one synthetic tenant and cached source rows,
no new login or grant, no storage object, no provider calls and no production writes.
It verified four successful stage/parent runs, one ready interaction, one pending
event, exact parent/handoff receipt agreement, preserved source text and zero
provider dispatches. The fixture is archived and retained for evidence. The
non-fixture 115 datasets and catalog remain unchanged. All seven downloaded modules
match the tested closure; eight downloaded pipeline-related checks pass.

Remaining delivery: correct the identity worker's early enriched marker, unchecked
card writes and subject-wide event consumption; add source-revision-aware settlement
and prove a complete source-to-card journey. Review the independent legacy repair
projector before allowing it to touch authoritative phone handoffs. Real provider
coverage, real audio provenance and signed-in user acceptance remain open.

Rollback/recovery: keep capture paused and do not re-run this one-shot release after
an uncertain response. Inspect the journal, ledger and catalog first. Preserve
receipts and event/source records; do not drop the new tables or remove nullable
columns as an automated rollback. Reverting to the old pipeline would reintroduce
unconfirmed success, so repair forward or disable the affected TEST input. Production
promotion and its separately verified rollback plan remain outside this TEST release.

[Sanitized release evidence](evidence/learn-phone-atomic-handoff-test-2026-10-11.json).


## Phone-to-card TEST acceptance — 11 October, 16:40 UTC

The next dependency is now installed: release 062 plus platform-worker v9 performs
identity resolution, provisional contact/card/recommendation writes and exact-event
acknowledgement in a single revision-bound transaction. The prior early enriched
marker and unchecked identity worker writes are superseded in TEST. Receipt replay
is historical evidence; currentness is separately checked before new work.

The hosted pipeline-to-worker check passed: cached synthetic call results produced
one card containing the source summary, a provisional contact, an enriched linked
interaction, one consumed event and a confirmed terminal queue job. The fixture is
archived, and all 116 non-fixture datasets remain unchanged. This demonstrates the
hosted stored-source-to-card path, without claiming real provider/audio/AI processing
or signed-in acceptance. Unresolved identities remain retained for operator review;
the operator requeue journey and legacy repair-projector compatibility still need
completion before activating real capture.

[Detailed evidence and limitations](evidence/learn-identity-card-test-2026-10-11.json).
