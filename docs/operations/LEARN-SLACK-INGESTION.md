# LEARN Slack history ingestion

## Current implementation and limits

The `slack.history_sync` transport now requires an owned, unexpired queue
claim. Its `learn_slack_read_credential` resolver checks the exact existing Vault
reference and tenant-qualified credential name, approved connection revision and
running job before returning the token to the server. It neither creates nor
rotates credentials, accepts tokens or URLs from jobs, nor falls back to either
notification bot. No live Slack connection was found in the Drummonds registries
checked on 9 October.

Release 010 installed the fenced worker functions and credential resolver in TEST
at 22:29 UTC. The `learn-slack-worker` endpoint is active at runtime version 3 and
passed actual JWT/HTTP acceptance at 22:38 UTC, including missing-credential refusal
and saved-page recovery. TEST has 87 public tables and eleven release receipts.
The page RPC now has eight arguments; the old six-argument writer is private.
The earlier storage/approval foundation is documented in
[release 009](LEARN-TEST-SLACK.md). No live Slack credential or schedule was created.
The installed transport has not fetched a real Slack page.

This is one approved internal public channel, one window of at most 24 hours,
and an explicit budget of 1–10 pages. Each job imports at most one page of 15
messages. If more pages remain within the approved budget, the worker requests
a continuation no earlier than 60 seconds later, using the durable account cursor.
Reaching the budget is an incomplete window, not a complete import. Thread replies,
private channels, Slack Connect channels, downloaded attachments and message
deletions are not yet supported. A continuous scheduler and multi-window backfill
remain required for the full LEARN communications objective.

## Required existing records

Before a job can make a provider request, all of these must agree:

- A running durable `platform_jobs` row for this tenant with type
  `slack.history_sync` and `payload.connector_account_id`, with matching
  `claimed_by`, `attempt_count` and an unexpired lease.
- An active `connector_accounts` row under an enabled, active Slack
  `tenant_connectors` row belonging to the same tenant.
- A `settings.slack_history` object containing `approved: true`, `connectionId`,
  `teamId`, `channelId`, `oldest`, `latest`, `consentReference`, `expiresAt` and
  `maxPages`. Timestamps for the provider window remain strings. The stored
  checkpoint must match the exact window and consent reference.
- A matching `provider_connections` row with provider `slack`, status
  `configured`, no revocation, `non_secret_config.team_id`, a `bot_token` field
  in `configured_fields`, and its valid Vault reference in `secret_refs`.
- The reviewed storage/setup release plus worker/credential migrations
  `20261030100000_learn_slack_worker.sql` and
  `20261030110000_learn_slack_credential_binding.sql`, installed in TEST through
  `supabase/release/learn-test/010_slack_durable_worker.sql`. Storage checks happen
  before resolving credentials. Production has not received this release.

The LEARN Slack card now opens an owner/admin import form for an existing
configured connection. It accepts a public-channel link or ID, a past window up
to 24 hours, a page budget and a reason. `learn_slack_start_import` rechecks the
owner/admin's tenant, rejects active client-preview sessions, checks the connection
revision, and writes an immutable approval with its queued job in one transaction.
The client retains the same request ID when retrying an uncertain response.
An active or incomplete earlier window cannot have its checkpoint overwritten.
Starting a new window after completion retains the previous scope/checkpoint in
the new approval's `previous_state`.

These are server prerequisites, not instructions to fabricate consent or change
the live database manually. Apply the reviewed setup migration
`20261029140000_learn_slack_import_setup.sql` with the storage migration. The UI
does not install a Slack app or create a credential. Existing credentials should be
reused where available. A new or broader Slack permission grant requires the
workspace owner's normal Slack installation/consent flow.

## Request and preservation behavior

The transport verifies the bot's workspace with `auth.test`, checks actual
membership and channel sharing with `conversations.info`, then reads history.
Only the fixed Slack API host and these methods are callable; redirects are
rejected. Tokens stay in the authorization header, and provider error prose and
message bodies never enter job error output. Response size and time are bounded.
Connection revision and stored consent are rechecked before and after requests;
the publication transaction also locks and checks the credential connection.
These checks do not constitute an atomic transaction with Slack itself.

`inclusive=true` retains messages on the approved time boundaries. The storage
RPC deduplicates source identities, retains observed provider JSON revisions, and
updates the existing interaction alongside the checkpoint in one transaction.
Ordinary retries resume from the last committed page. An older edited-message
payload remains in revision history without replacing newer current content.

The new Slack-only worker uses `platform_jobs`, with one page/job per request and
a 180-second lease. Its claim function reclaims only due Slack work, skips locked
jobs and enforces the existing attempt budget. The migration reserves Slack from
the generic claim function without changing other job types. It grants no new
table privileges and changes no schedules.

Publication records a durable page receipt in the same transaction as the source
and cursor. Exact uncertain-response replays are accepted; a second, different
page in the same job is refused. A recovered receipt skips provider requests.
Completion derives the result and delayed successor from that receipt and creates
both in one transaction. A failed successor insert rolls completion back; replay
returns the original successor. Expired/replaced workers cannot publish or settle.
The worker probes durable completion after a handler error to resolve a publication
whose HTTP response was lost.

HTTP 429 retains Slack's minimum delay alongside normal backoff. Exhausted
attempts become retained dead letters requiring review; this is a finite recovery
budget, not a promise of automatic recovery from every persistent failure. Pacing
is per account/job chain, not a workspace-wide reservation. Shared-workspace pacing,
scheduler activation and live acceptance remain required.

The deployed `learn-slack-worker` endpoint accepts an empty POST with gateway JWT
verification and an explicit `x-serviceos-worker-key` header. TEST's
`LEARN_SLACK_WORKER_KEY` reuses its existing service credential; the value was bound
through CLI stdin without entering arguments, local files or reports. The worker
does not compare the gateway bearer to its runtime-injected service key: hosted
acceptance demonstrated those values differ. Native empty request streams are
accepted; non-empty bodies are refused before claiming work. User JWTs alone and
caller-supplied job selectors cannot trigger it. Responses contain queue outcomes,
not credentials or source content. No schedule was created. The broad worker must
not be deployed as a shortcut for this path.

Provider contracts checked against the official documentation:
[auth.test](https://docs.slack.dev/reference/methods/auth.test/),
[conversations.info](https://docs.slack.dev/reference/methods/conversations.info/),
and [conversations.history](https://docs.slack.dev/reference/methods/conversations.history/).
The history documentation distinguishes internal/Marketplace applications from
new commercially distributed non-Marketplace installations; the conservative
15-message page and 60-second continuation do not claim a universally required
Slack limit.

## Verification

```sh
node --test supabase/functions/_shared/slack/*.test.ts supabase/functions/_shared/worker_handlers/slack_history.test.ts supabase/functions/_shared/platform_queue.test.ts
python3 scripts/verify/learn-slack-sql.py
python3 scripts/verify/learn-foundation-release.py --rules --conflicts --measurements --work --actions --slack --slack-worker
```

The setup UI was reviewed with synthetic fixtures, including a wrong-workspace
channel link and a queued acknowledgement. The preview never queues a real job.
Client validation tests are in `src/lib/learn-slack-setup.test.ts`. The SQL runner
also checks owner/role/tenant/preview boundaries, atomic setup, idempotent request
retries and preservation of unfinished and previous windows.

The transport tests use synthetic HTTP responses and database fixtures. They cover
tenant/connection checks, credential scope, restricted requests, continuation,
rate limits, malformed/oversized responses, resumed cursors and in-flight
revocation. SQL tests run in disposable offline PostgreSQL and include the real
existing interaction-table migration. Neither suite establishes deployed-schema
compatibility, actual Slack grants, complete provider coverage or live user access.

The worker verification adds actual two-session claim/replacement ordering,
expired-claim refusal, exact publication replay, crash-after-publication recovery,
injected continuation failure/rollback, bounded retries, unchanged email data and
unchanged existing table definitions/privileges. Real Vault tests use synthetic
non-credential strings and cover tenant/reference/name/revision/revocation/lease
checks and browser execution denial. The standalone metadata inventory is retained
in `evidence/learn-test-worker-prerequisites-2026-10-09.json`; it contains no source
rows or credential values. The exact release bundle passed an injected receipt
failure/rollback, real-schema assertions and hosted rollback rehearsal. Seven
release-tool tests cover wrong targets, changed functions/privileges, stale
rehearsals, uncertain writes, missing receipts and the verified runtime refresh.
The focused transport/worker/queue suite has 45 passing tests.

Hosted acceptance retained two approvals, one source message/version/interaction,
a missing-credential dead letter and a recovered completed job with one cancelled
delayed successor. Fixture users are banned with rotated passwords and viewer
roles; connections/accounts are disabled and no active fixture job remains. Old
JWT approval was denied. Tenant-level source reads still follow their existing
policy until JWT expiry. The previous failed authentication attempt is retained too.

Secret configuration incremented all three TEST runtime versions; the two existing
endpoints retained identical source hashes, entrypoints, JWT settings and timestamps.
The catalog verifier recognizes only that recorded refresh. The replacement worker
deployment CLI returned exit 1 despite creating active runtime version 3. No blind
redeploy followed: the deployed bundle was downloaded, all eleven runtime source-map
contents matched the repository exactly, and real HTTP acceptance passed. The
source download CLI timed out after the bundle was written; source comparison used
that complete artifact. No existing local database/container was altered.

Authoritative records:

- [Release and catalog preservation](evidence/learn-test-worker-release-2026-10-09.json)
- [Deployment resolution and source readback](evidence/learn-test-worker-deployment-confirmed-2026-10-09.json)
- [Actual JWT/Edge acceptance](evidence/learn-test-worker-acceptance-2026-10-09.json)
- [Current installed schema](evidence/learn-test-worker-installed-schema-2026-10-09.json)

The local actual-UI server/fixture guards now recognize release 010. Historical
release-009 acceptance scripts intentionally require their original schema. Live
Slack permission and source acceptance, threads, continuous history, workspace-wide
pacing and operator recovery controls remain required for full ingestion.

## Observed thread windows — implementation and initial local verification

The next worker version handles `slack.thread_sync` alongside channel history.
It reads replies through Slack's separately paginated
[conversations.replies API](https://docs.slack.dev/reference/methods/conversations.replies/).
Each request binds the exact company, workspace, public internal channel, observed
parent timestamp and approved time window. Parent candidates come from retained
provider reply counts or reply/broadcast references, including parents older than
the selected window. Arbitrary timestamps do not establish approval. Out-of-window
provider content is rejected; live behavior still needs acceptance with the actual
workspace and app grants.

`20261030120000_learn_slack_thread_storage.sql` adds retained thread approvals and
separate page checkpoints. It extracts the existing source/version/interaction
writer into a private shared function, preserving its previous validation and
history behavior. New thread interactions identify an observed thread page; that
provenance does not claim the whole thread is complete. Thread pages leave the
channel checkpoint untouched.

`20261030130000_learn_slack_thread_worker.sql` reserves thread jobs for the scoped
worker, reuses the existing connection's Vault reference and tenant-qualified
secret name, and atomically settles each page with a delayed continuation. A
replacement worker can finish a retained page without fetching it again. Expired
or replaced claims cannot publish or complete. Rate-limit retries retain their
minimum delay. Approval, source, version and terminal queue evidence remains.

Current approval is explicitly per observed thread/window, with the reviewed
source version and connection revision retained. This is not yet automatic thread
discovery/backfill in the operator UI. `observed_thread_window_complete` means the
provider pages for that approval have ended; `ingestion_complete` remains false.
It does not establish all threads were discovered, all historical time was covered,
or attachments were downloaded.

Local verification:

```sh
node --test supabase/functions/_shared/slack/*.test.ts supabase/functions/_shared/worker_handlers/slack_history.test.ts supabase/functions/_shared/platform_queue.test.ts scripts/verify/learn-test-worker-release.test.mjs scripts/verify/learn-test-worker-deploy.test.mjs
python3 scripts/verify/learn-foundation-release.py --rules --conflicts --measurements --work --actions --slack --slack-worker --slack-threads
```

The focused Node suite passes 63 tests. SQL exercises synthetic retained roots and
replies, source-version approval, cross-company denial, real Vault with synthetic
values, exact replay, crash recovery, injected successor failure, delayed retries,
independent cursors and unchanged existing email evidence. Both draft migrations
are tested together in an offline disposable PostgreSQL instance. A standalone
TypeScript check cannot resolve the existing Deno URL import of Supabase; Node's
runtime tests are not a full Deno typecheck.
Both migrations rolled back cleanly, and the applied schema preserved every
existing table definition and privilege. See the
[local verification record](evidence/learn-slack-threads-local-2026-10-09.json).

At this local milestone, TEST was still release 010 and its previously verified history-only runtime v3.
The release-010 deploy helper now pins its known runtime source hash and refuses
newer thread source before network access. The thread schema needs a separate
reviewed release bundle, hosted rehearsal, a complete endpoint dependency manifest,
deployment and actual authenticated acceptance. No thread job, live provider
request, credential, schedule or production change was made by this local work.

## Current TEST state — thread release 011, 10 October

Release 011 is installed in TEST: 88 public tables and twelve retained release
receipts. The release SHA-256 is
`c476f687762c1bb648c7ecdd7bd9bdb054b1d7f5ccc9cb43af17468991edf5ce`.
Its exact transaction passed offline injected-failure/rollback checks and a hosted
rollback rehearsal before installation. The installed table, functions and grants
match the independently generated PostgreSQL projection. Existing table definitions,
privileges, source catalogs and unrelated queue completion remain unchanged.

The matching `learn-slack-worker` is active at runtime version 4 with JWT
verification. Its 13-file source bundle includes twelve runtime files and the
type-only worker contract. Deployment returned success, and all twelve first-party
runtime source-map entries from the downloaded deployed bundle match the reviewed
repository source exactly. The download CLI timed out after writing the complete
bundle; no deployment retry followed. Existing secrets were reused and the other
two TEST endpoints were unchanged.

Actual hosted Auth/RPC/Edge acceptance passed for both history and threads. It
verified owner approval, viewer/foreign-owner denial, exact request retry, changed
request conflicts, reserved queue claims, missing-credential refusal, page replay,
expired-claim refusal, separate thread/channel checkpoints and Edge recovery of a
saved thread page with one delayed successor. Two messages, two immutable versions,
two interactions, two history approvals and two thread approvals remain as synthetic
evidence. Fixture logins are banned with rotated passwords and viewer roles;
connections are disabled and no active fixture job remains. Existing source-read
policies remain subject to JWT expiry.

The focused Node suite now passes 72 tests, including nine new release/deployment
checks. Actual-UI server and fixture guards recognize release 011. The prior
release-010 deployment and acceptance helpers retain their original restrictions.

Evidence:

- [Exact hosted rehearsal](evidence/learn-test-threads-rehearsal-2026-10-10.json)
- [Installation and preservation](evidence/learn-test-threads-release-2026-10-10.json)
- [Worker deployment](evidence/learn-test-threads-deploy-2026-10-10.json)
- [Deployed source comparison](evidence/learn-test-threads-readback-2026-10-10.json)
- [Actual signed-in and Edge acceptance](evidence/learn-test-threads-acceptance-2026-10-10.json)
- [Installed schema](evidence/learn-test-threads-installed-schema-2026-10-10.json)

No real Slack credential or provider fetch was used. Source pages in acceptance
were supplied to the real service RPC; the deployed worker exercised refusal and
saved-page recovery. Live provider permission and reply behavior, operator thread
discovery/import controls, continuous history, workspace pacing and recovery UI
remain required. No production change or schedule was made.

## Thread operator controls — local UI and read models

The Slack dialog now separates channel messages and thread replies. The thread
view browses retained channels, including disabled ones, and pages through observed
parents. It shows each thread's latest approved window, captured-page count,
queue status and safe error reference. A page limit is never presented as a known
message total; window completion applies only to that observed thread and window.

Owners/admins can select up to twenty displayed threads and approve a shared time
window and per-thread page limit. Each selected thread uses the existing release-011
approval RPC with its own immutable request ID, reviewed source version and
connection revision. The form freezes after submission, reports partial confirmation,
stops at an uncertain response, and retries only unconfirmed requests with the same
IDs. Closing/reloading the panel does not retain its in-memory request review;
operators are told to inspect the latest status before preparing another request.
This is not a durable browser outbox or a full queue recovery interface.

The draft `20261030140000_learn_slack_operator_reads.sql` adds two company-scoped,
read-only RPCs. It does not broaden raw queue/table grants or return credential
references, provider payloads or arbitrary error prose. Parent discovery prefers
stored root evidence and deduplicates replies; it describes observed current
sources, not every thread or every prior import revision.

Local SQL checks passed for paging, deduplication, status projection, disabled
connections, foreign-company refusal and unchanged existing tables/privileges and
email evidence. Eleven setup/thread client tests, both application/preview
TypeScript checks and the preview build passed. Browser verification used synthetic
fixtures: three selected requests, a simulated lost second response recovered by
same-ID retry, queued status after refresh, disabled import controls with visible
evidence, and explicit unavailable state on read failure.

This UI/read-model increment has not been released to hosted TEST or production.
TEST remains release 011/runtime v4. Its next step is a reviewed reader release and
actual authenticated UI acceptance. Live provider access, continuous ingestion,
workspace pacing and full recovery controls remain separate requirements.
