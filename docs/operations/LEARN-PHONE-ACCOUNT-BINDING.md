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
