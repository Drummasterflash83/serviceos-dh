# LEARN phone account binding — local, 10 October 2026

Call and recording sync, connection tests and recording downloads previously
accepted an arbitrary requested provider customer or fell back to the first
customer visible through the shared Simwood credentials. A signed-in company
boundary therefore did not itself establish which provider account would be read.

The local implementation now resolves accounts through the existing server-managed
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

No schema migration, production write, Edge deployment, provider request, credential
change, schedule or paid processing occurred. Before release, inspect the target
registry/schema and deployed function versions, exercise authenticated TEST handlers,
and verify all intended recording URL shapes. Deploy only reviewed phone functions
and their dependency bundles; do not blindly apply pending migrations or change Emma.
Missing provider accounts must be configured through an authorized operator flow,
not guessed from the first provider customer or silently enabled.

Voicemail discovery still needs the existing provider-credential environment and a
verified message/audio API contract. This account resolver does not discover or
capture voicemail. Provider reconciliation, failed-audio repair, backup restoration,
continuous coverage, tenant credential lifecycle and the wider LEARN V1 scope remain.
