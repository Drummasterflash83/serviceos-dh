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
