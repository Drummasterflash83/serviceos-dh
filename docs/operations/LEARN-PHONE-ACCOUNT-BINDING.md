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
