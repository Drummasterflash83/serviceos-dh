# LEARN Slack history ingestion

## Recurring channel capture — TEST backend installed, 10 October 2026

`20261101003000_learn_slack_recurring.sql` adds an explicit ongoing approval for
an existing captured public channel. Tenant owner/admin or active OpenFolk admin approval binds the company,
account, workspace, channel and connection revision. The request ledger supports
exact lost-response replay and optimistic revision checks. Viewer and View-As
sessions cannot change it; browsers cannot call the service-only scheduler.

The scheduler queues successive windows of up to 15 minutes, ending at least two
minutes behind the current time. Each retains the preceding approval/checkpoint
and uses the existing `slack.history_sync` page worker with its conservative quota
and ten-page budget. A completed boolean alone cannot advance capture: it needs a
matching saved page receipt from a succeeded job. Unfinished or unverified windows,
changed connections, withdrawn approvals and paused capture are held. Account and
tenant setup locks prevent duplicate windows across simultaneous scheduler calls.
Queue insertion, approval creation and checkpoint changes are one transaction.

Disabling withdraws the current recurring window's request authority without
deleting its cursor or evidence. Re-enabling that same paused window restores its
approval without extending expiry or page limits. Dead-letter or exhausted work
still requires the existing explicit recovery flow. After a manual replacement or
recovery approval changes the scope, recurring capture holds for a fresh review;
it does not silently skip the retained window.

The new `learn-slack-schedule` endpoint only enqueues bounded work and exposes
aggregate outcomes. It uses gateway JWT verification and the existing dedicated
Slack worker trigger header. It never reads a provider credential or calls Slack.
No schedule, channel approval or credential is installed by these files.

Client LEARN and the OpenFolk module controller now share an Ongoing capture panel.
It shows the last checked setting separately from processing progress, requires a
reason and confirmation to change it, and restricts editing to current authority.
A scoped browser outbox retains an uncertain request across reloads; check, retry
and cancellation use the same immutable request identity. Cancellation fences a
late apply. Status reads are tenant scoped and paginated, with a normalized public
projection. Viewers can read status; View-As cannot edit. OpenFolk access requires
an active platform grant, checked again by SQL.

Validation: **62 Slack Node tests pass**, along with TypeScript and the preview
frontend build. The actual component was tested in a browser against a synthetic
fixture: lost reply, reload, receipt recovery without duplicate apply, pause, and
revoked editing access. An offline disposable PostgreSQL test
exercises actual recurring/storage/setup SQL, the real capture predicate, recorded
tenant/role helper definitions, and minimal Auth/queue fixtures. It checks request
replay, viewer/preview denial, successive boundaries, receipt requirements,
module/credential/approver pauses, injected queue failure rollback, pause/resume,
retained synthetic source/version fingerprints and two concurrent scheduler
sessions producing one job. Completion receipts in this fixture are synthetic;
this does not establish actual provider-to-worker execution.

Release **035** installed the recurring schema in TEST at **17:26:21 UTC**, after
a successful rollback rehearsal. All **65** monitored datasets remained unchanged.
The `learn-slack-schedule` endpoint is ACTIVE at version 1, with gateway JWT and
existing dedicated worker-key checks. Seven actual HTTP cases passed, including an
authorized empty scheduler call and refusal of missing keys, wrong keys, incorrect
methods and supplied work selectors. Hosted SQL also denied an unassigned identity.
The two recurring tables remain empty. No channel, credential or trigger was added.

**Not activated.** The controls are included in the protected TEST frontend built
from `3f96f523bdf109570f147b67df405350dad82028`; its homepage/sign-in checks passed.
Authenticated hosted client and operator empty-channel states also pass; the
temporary operator session is retired ([evidence](evidence/learn-hosted-operator-acceptance-2026-10-10.json)).
Remaining work includes populated hosted channel-control acceptance, explicit
trigger activation and real Slack workspace/channel access. This path
covers channel-history windows only: automatic thread discovery, older message
edit/delete reconciliation, other channel types and attachment capture remain
separate requirements. See [local verification evidence](evidence/learn-slack-recurring-local-2026-10-10.json) and
[controls verification](evidence/learn-slack-recurring-controls-2026-10-10.json) and
[hosted release evidence](evidence/learn-slack-recurring-hosted-2026-10-10.json).

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

## Current TEST state — operator reader release 012, 10 October

The two operator readers are now installed in TEST through release 012
`learn_slack_operator_reads_v1`, checksum
`e37839d9be63ff9ee9db8b0ada2c25c676546cb108a3882c57d1ec58aa8300b1`.
This supersedes the local-only status above. There are still 88 public tables,
now thirteen migration receipts. All existing table definitions/privileges and
endpoints match the prior catalog; the Slack worker remains runtime v4.
No source, credential, schedule or production change is included in the release.

The exact bundle passed a disposable, network-isolated database run, including
injected receipt failure, rollback rehearsal, duplicate-install refusal, reader
pagination, company isolation and retained email checks. Eighteen release/client
Node tests passed. Hosted rollback rehearsal and one installation were acknowledged;
the final installed definitions and existing catalog match the reviewed projection.

Actual signed-in TEST owner/viewer sessions read the stored channels and one
root/reply-deduplicated parent with its latest queued successor and checkpoint.
Foreign-company, anonymous and service-role reads were refused; invalid cursors
failed closed. Browser users still cannot select the raw queue. Disabling the
channel left the retained thread and checkpoint readable. The existing real
Auth/RPC/Edge acceptance also passed under the new schema; it used synthetic
sources and no real Slack credential or provider fetch.

The actual application, served locally against the hosted TEST backend, was checked
with a temporary synthetic viewer. It displayed disabled channels, the retained
thread's cancelled latest import, its approved window, one captured page against a
three-page budget, and disabled selection/approval controls. An empty channel showed
“No observed threads” without claiming there are no replies. The browser signed out,
and its temporary login was banned and password rotated. All fixture sources and
approvals remain; no fixture jobs or connections remain active.

Browser scope is deliberately precise: this verified actual hosted reads and
read-only controls. Multi-selection and uncertain-response UI retry were verified
in the earlier synthetic preview, while actual owner approval/replay was verified
through hosted RPCs. This was not an end-to-end owner browser import or live Slack
ingestion. The viewer also saw unavailable launch-summary counts; TEST's existing
metadata-view launch mode restricts that endpoint to owner/admin. The reader
release does not change that separate policy.

Evidence:

- [Rollback rehearsal](evidence/learn-test-operator-rehearsal-2026-10-10.json)
- [Installation and catalog preservation](evidence/learn-test-operator-release-2026-10-10.json)
- [Authenticated reader and worker acceptance](evidence/learn-test-operator-acceptance-2026-10-10.json)
- [Installed schema](evidence/learn-test-operator-installed-schema-2026-10-10.json)
- [Actual browser view](evidence/learn-test-operator-browser-2026-10-10.jpg)
- [Temporary browser login retired](evidence/learn-test-operator-browser-retired-2026-10-10.json)
- [Combined verification record](evidence/learn-test-operator-confirmation-2026-10-10.json)

Live Slack permission, provider reply behavior, continuous/multi-window ingestion,
workspace-wide pacing, durable operator retry/recovery, voicemail reconciliation,
and the remaining LEARN V1 scope still require implementation/acceptance. The
frontend remains local for this milestone; no Vercel or production deployment was made.

## Shared workspace pacing — local implementation, 10 October

The draft `20261030150000_learn_slack_workspace_pacing.sql` closes a gap between
per-job delay and workspace-wide limits. Channel history and thread jobs now share
one infrastructure-only gate for a stored Slack team ID, including when different
connections or ServiceOS companies refer to that workspace. An unrelated workspace
can proceed. Until the actual Slack app identity and rate tier are verified, the
gate conservatively combines apps too. It governs this history worker, not unrelated
Slack integrations.

Slack documents limits per method/workspace/app and requires respecting
`Retry-After` across tokens belonging to the same app/workspace:
[official rate-limit contract](https://docs.slack.dev/apis/web-api/rate-limits/).
Our conservative policy admits one bounded history-worker job per workspace at a
time, then waits at least sixty seconds after settlement. An abandoned reservation
lasts through its 180-second job lease plus sixty seconds. A recorded rate-limit
failure can extend the shared cooldown; it applies to both history and replies.
An unrecorded response lost with a crashed process cannot supply a durable header.

Waiting for the workspace does not consume attempts or increment errors. Claims
scan at most one hundred eligible candidates and lock only the candidate currently
being examined; a prefetched locking cursor would unnecessarily lock unrelated
workspaces. A transaction-scoped advisory lock serializes the first gate insert,
while competing claims skip a busy gate. Paced jobs are reconsidered within a minute
of an active reservation unless a longer recorded provider cooldown applies. A
claim rollback consumes no slot. This is admission control, not a polling schedule.

A retained published page needs no further provider request. It can be reclaimed
for settlement while the workspace is cooling down, including after exhausting its
provider-attempt budget. Its completion cannot release another job's newer gate.
Queue settlement, shared cooldown and release of the reservation commit atomically;
an exact completion retry returns the saved receipt without moving the cooldown.
The existing source writer, credential checks and publication fences are unchanged.

The full disposable SQL chain passed, including an injected migration failure,
shared channel/thread/company limits, cooldown replay, exhausted-budget saved-page
recovery, an injected gate-update failure and controlled two-session admission
races. The same tests verified unchanged existing table definitions/privileges and
unchanged synthetic email, message, version and interaction records. See
[local pacing evidence](evidence/learn-slack-pacing-local-2026-10-10.json).

This migration is **not hosted yet**. TEST remains release 012/runtime v4. Next steps
are exact release packaging, hosted rollback rehearsal and actual concurrent RPC
acceptance. No Edge source change is required for the database admission policy.
Live Slack permission, continuous/multi-window capture, durable operator recovery
and the rest of LEARN V1 are still outstanding.

## Current TEST state — workspace pacing release 013, 10 October

Release 013 `learn_slack_workspace_pacing_v1` is installed with checksum
`7191b47ec926094b2118d957cddccf6ebec6c62e10e2d04670db327d23c223a5`.
This supersedes the local-only pacing status above. TEST has 89 public tables and
fourteen receipts. Existing source/table definitions and privileges, operator
readers, approval/source-publication contracts and endpoint source hashes match
the prior catalog. The existing Slack worker remains runtime v4; it needed no
redeployment or credential change.

The exact release holds the queue table lock and refuses installation if any Slack
job is queued, running or retrying. This prevents unpaced in-flight work crossing
the changeover. The isolated release chain verified that refusal, injected receipt
failure rollback, exact rollback rehearsal, duplicate-install refusal and the
prior controlled pacing/concurrency cases. Fourteen focused release/worker Node
tests passed. Hosted rehearsal rolled back unchanged, one installation was
acknowledged, and readback matched the expected table and three changed functions.

Actual signed-in owner approvals created synthetic work in three companies with
two random Slack workspace IDs. Concurrent independent service RPCs admitted only
one job from the shared workspace, while the unrelated workspace progressed. The
waiting jobs retained zero attempts/errors. Anonymous and signed-in users could
neither claim work nor read the infrastructure gate. One synthetic root was
published through the real fenced page RPC and retained with its version and
interaction, then approved for a thread import by its signed-in company owner.

Channel completion held the new thread behind the shared cooldown; a thread
rate-limit outcome delayed channels in both companies. The existing deployed
worker returned idle during the cooldown. After advancing only a synthetic gate
and its selected job deadline, that same worker claimed one job, refused its
nonexistent Vault binding before any Slack request, and released the reservation
with the normal spacing. An old exact completion replay did not move the newer
gate; replacing a claim caused the old worker's completion to return HTTP 409.

All test sources and approvals remain. The three synthetic logins were banned,
passwords rotated and owner roles revoked; their active jobs, connections and
reservations are zero. Some fixture deadlines were explicitly advanced, so this
is hosted protocol verification rather than timed live-provider acceptance.
Controlled overlapping transactions were separately checked in isolated SQL;
the hosted concurrency check used independently dispatched HTTP requests.

Evidence:

- [Fresh baseline comparison](evidence/learn-test-pacing-before-2026-10-10.json)
- [Hosted rollback rehearsal](evidence/learn-test-pacing-rehearsal-2026-10-10.json)
- [Installation and catalog preservation](evidence/learn-test-pacing-release-2026-10-10.json)
- [Actual RPC/worker acceptance and cleanup](evidence/learn-test-pacing-acceptance-2026-10-10.json)
- [Compact installed-schema verification](evidence/learn-test-pacing-installed-2026-10-10.json)
- [Combined verification](evidence/learn-test-pacing-confirmation-2026-10-10.json)

The compact readback references the retained release-012 catalog and exact release-013
projection instead of duplicating the full catalog. Current UI/fixture launch guards
recognize release 013. Historical release-011/012 acceptance commands retain their
original schema requirements. No production write, real Slack fetch, new credential,
frontend deployment or schedule occurred. Continuous/multi-window capture, actual
provider access, durable operator recovery, voicemail and the wider LEARN V1 scope
remain outstanding.

## Reviewed channel recovery — local implementation, 10 October

An incomplete channel window can exhaust its page budget or stop with an expired
provider cursor. The new local `learn_slack_history_read` contract exposes the
retained approval, bounded window, current batch progress and safe queue status.
It excludes raw provider cursors, scope keys, credential references and private
job payloads. Company viewers can inspect it; recovery approval requires a current
owner/admin outside preview. Eligibility flags describe channel state, not the
viewer's authority to approve.

`learn_slack_resume_history` accepts a reviewed state hash, request ID, reason and
fresh budget of 1–10 pages. Continue preserves the saved cursor; restart begins the
same window from the start. Both renew consent for 24 hours without changing the
approved window bounds. The prior approval and checkpoint remain immutable in the
approval chain. `pagesThisApproval` starts at zero for the new approval and must
not be presented as lifetime history or a measure of complete company coverage.
The progress reader includes the previous approval ID and recovery mode.

Recovery refuses active imports, completed windows, stale reviews and changed
request identities. Exact retries resolve the original retained receipt even
after progress changes. Connection/account and company-authority locks protect
approval; checkpoint replacement, queue insertion and the new retained approval
commit together. Existing source/version publication remains unchanged, including
deduplication when a reviewed restart sees an already stored message.

The full isolated SQL chain passed migration rollback, permissions, expired-consent
continuation, cursor/bounds preservation, exact replay, reviewed restart, queue
failure rollback, completion and existing-source preservation. Controlled blocked
transactions verified revoked owner denial, connection revision invalidation and
one queued job from two competing approvals. Twelve focused client tests and the
strict recovery-client typecheck passed. The new client adapter validates the
company/account/state and receipt, removes unexpected private fields, and separates
unconfirmed outcomes requiring the same request ID from rejected/stale reviews.

See [local verification evidence](evidence/learn-slack-history-recovery-local-2026-10-10.json).
This is **local only**: TEST remains release 013/runtime v4. Exact release packaging,
hosted rehearsal/acceptance and a recovery review screen remain. The client adapter
does not yet provide a durable browser outbox. Thread recovery, ongoing/multi-window
capture and actual provider access remain separate work. No production data,
credential, provider request, deployment or schedule changed in this step.

## Current TEST state — channel recovery release 014, 10 October

Release 014 `learn_slack_history_recovery_v1` is installed with checksum
`0e33e36138c1e8988d13b90b32295ace2d2f3480d6fec83b2deaae919f421efc`.
This supersedes the local-only recovery status above. TEST has 89 public tables
and fifteen receipts. The three new functions match their isolated projection;
existing table definitions, privileges, source writers and endpoint hashes remain
unchanged. The Slack worker is still runtime v4, with no redeployment or new secret.

The exact bundle passed isolated injected receipt failure, rollback rehearsal,
duplicate-install refusal, existing-function preservation and the full recovery
permission/source/concurrency suite. Thirteen focused Node tests passed. Hosted
rollback rehearsal preserved the catalog, and one acknowledged installation matched
the expected definitions. The release-013 baseline is reconstructed from its prior
catalog, exact projection and retained receipt, with a matching verified fingerprint;
another full duplicate catalog is unnecessary.

Actual TEST Auth/RPC checks verified company isolation, safe viewer reads, denied
viewer approval and private-helper access, renewed expired consent, continuation
from the saved cursor and immutable prior checkpoints. Two simultaneous owner
reviews queued one job; the other conflicted. Exact retry returned the same receipt,
while changing its mode conflicted. Replaying an existing message during continuation
retained exactly two messages and two versions after adding the next message.

A reviewed restart cleared only the new cursor and retained its predecessor. The
existing Edge worker handled that recovery job and refused its nonexistent Vault
credential before any provider request. Another reviewed continuation completed the
bounded window. Completed-window recovery was refused, created no approval, and
an older exact request still resolved its original receipt after completion.

The first acceptance run incorrectly assumed HTTP 400 for SQLSTATE `55000`.
Read-only inspection found no approval for the final refused request, four retained
approvals and a complete checkpoint. The test now checks refusal by the documented
database code and absence of a new approval. A fresh full run passed and recorded
HTTP 500 with code `55000`; the client already maps that code to an unavailable
review. No release function changed and no uncertain write was replayed.

Both fixture runs retain their synthetic evidence. Each has two messages, two
versions, two interactions and four approvals. Their logins are banned, passwords
rotated, owner roles revoked and active jobs/connections/reservations zero. The
passing run also checked unchanged counts and row fingerprints for pre-existing
TEST emails, calls, recordings, transcripts, Slack messages/versions and interactions.
Fixture consent expiry and pacing deadlines were explicitly advanced; this is
protocol acceptance, not timed live-provider acceptance.

Evidence:

- [Exact isolated release checks](evidence/learn-slack-recovery-release-local-2026-10-10.json)
- [Fresh prerequisite comparison](evidence/learn-test-recovery-before-2026-10-10.json)
- [Hosted rollback rehearsal](evidence/learn-test-recovery-rehearsal-2026-10-10.json)
- [Installation and preservation](evidence/learn-test-recovery-release-2026-10-10.json)
- [Passing actual Auth/RPC/worker acceptance](evidence/learn-test-recovery-acceptance-2026-10-10.json)
- [Compact installed catalog](evidence/learn-test-recovery-installed-2026-10-10.json)
- [Combined verification and initial test correction](evidence/learn-test-recovery-confirmation-2026-10-10.json)

Current UI and fixture launch guards recognize release 014. Historical acceptance
commands retain their original release requirements. The recovery review screen,
durable browser outbox, thread recovery, live Slack access and continuous/multi-window
capture remain outstanding. No production write, real Slack fetch, frontend
deployment, credential change or schedule occurred. This completes the recovery
backend release milestone, not Slack ingestion or LEARN V1.

## Channel recovery screen and saved approvals — local, 10 October

Slack imports now opens a **Progress & recovery** view. It lists retained channels,
reads the current approved window and queue state, and distinguishes current-approval
page counts from cumulative history or coverage. Owners/admins can review continue
or restart with a fresh budget and reason. Restart explains that it reads the same
window again and retains existing evidence. Queued, completed and unavailable
windows show progress without an inactive approval form; viewers have read-only
progress. Read failures remain unavailable rather than becoming empty results.

Before calling the recovery RPC, the client saves the exact reviewed request in
browser local storage, scoped by backend URL, signed-in actor and company. One
unresolved recovery is retained per such scope. A Web Lock serializes same-browser
tabs; a different pending request cannot be overwritten. Storage write/readback
must succeed before sending, and authority/panel lifetime are rechecked after the
lock and before submission. No automatic submission occurs on reload.

Reloading or reopening restores the saved window/action/reason and offers an exact
retry. Progress refresh does not clear it. Only a matching confirmed receipt removes
it automatically. Uncertain and permission-denied outcomes retain the request;
explicit stale/invalid/unavailable responses offer a user action to clear that
rejected review and refresh. Malformed stored data blocks new recovery rather than
being silently discarded. Storage contains approval metadata/reason, not message
content, raw provider cursors or credentials. It is browser-local, not a server
outbox: clearing browser data or moving devices does not preserve the request.

Twenty-four focused tests passed, covering durable replay, scope separation,
storage failure, competing requests, malformed records, revoked authority and the
existing Slack clients. Application and synthetic-preview typechecks and the
preview build passed; the build retains its existing large-chunk warning. Browser
acceptance verified lost response → full reload → retained review → exact retry,
refresh without clearing, restart, stale review reset, viewer restrictions, complete
windows and failed reads. Same-browser lock contention was exercised in unit tests,
not an actual two-tab browser race.

See [local screen evidence](evidence/learn-slack-recovery-ui-local-2026-10-10.json)
and [synthetic screenshot](evidence/learn-slack-recovery-ui-2026-10-10.png).
The preview tab/server were closed after verification. TEST remains release 014;
the backend's actual Auth/RPC/worker acceptance is recorded above. This new screen
has not yet been accepted through a signed-in TEST browser or deployed to Vercel.
Durable requests apply only to channel recovery; initial channel and thread approval
forms still use in-memory pending state. Live provider access, thread recovery,
continuous/multi-window capture and broader LEARN V1 remain incomplete.


## Channel recovery screen — signed-in TEST acceptance, 10 October

The actual application now passed normal browser sign-in against hosted TEST
release 014. A fresh synthetic owner approved continuation with two pages and
restart with three pages for separate retained channels. Both receipts and progress
views showed the original January 1–2 window. Full reload and reopening retained
the queued continuation without another approval or unresolved-request banner.
Read-only database inspection matched the browser choices, reasons, actor, budgets
and predecessor approvals. Continue retained its cursor; restart cleared its new
cursor; both predecessor checkpoints remained intact.

The fixture retained two messages, two versions and two interactions throughout,
with four approvals after the two browser actions. Its recovery jobs were then
cancelled, connections disabled, owner role revoked and login banned/password
rotated. The browser showed disabled channels and no approval access after reload;
explicit sign-out returned to the login page. The tab and owned loopback server were
closed. Existing access-token reads are not claimed to be immediately revoked.

The reproducible helper is `scripts/verify/learn-test-recovery-browser-fixture.mjs`.
It requires the exact TEST release and explicit project guard; temporary fixture
passwords arrive on stdin, and existing CLI/API credentials remain in memory.
Create uses an exclusive manifest under `/private/tmp`, `verify` compares browser
approvals, and `retire` preserves source evidence. Do not reactivate this fixture.

See [signed-in browser evidence](evidence/learn-test-recovery-browser-2026-10-10.json)
and [actual TEST screenshot](evidence/learn-test-recovery-browser-2026-10-10.png).
This closes the actual-browser acceptance gap noted in the preceding milestone.
Lost-response recovery remains covered by the separate synthetic preview; no real
two-tab race or live Slack fetch was performed here. The browser-created jobs were
cancelled before worker execution. TEST schema/runtime are unchanged; no production
mutation, provider credential change, scheduler or frontend deployment occurred.
Live capture, thread recovery, continuous/multi-window capture and the remaining
LEARN V1 work are still outstanding.


## Durable initial channel and thread approvals — local, 10 October

Initial channel imports and observed-thread batches now save their reviewed requests
in browser local storage before sending. This closes the in-memory gap recorded
above: closing/reopening, full reload, or refreshing thread progress no longer
discards an unresolved approval. One channel request and one batch of up to twenty
threads can be retained per backend, signed-in actor and company. No automatic
submission occurs on reload. Existing pending requests lost by an older application
version cannot be reconstructed by this change.

Each thread receipt is validated and saved before sending the next request. Retry
skips confirmed requests and uses the original IDs for unresolved items. A revoked
role or closed review stops the unsent remainder. Web Locks serialize same-browser
tabs; a different unresolved batch cannot replace the saved one. Storage failure,
malformed history or unexpected replacement stops submission rather than silently
starting new work. Only allowlisted review metadata and receipts are stored, never
message excerpts, source payloads, private cursors or credentials.

The saved review is separate from current source progress, so retries remain
available even if current source discovery fails. Only an explicit conflict,
unavailable-state or invalid-input database rejection permits an operator to clear
that individual request. Confirmed and unresolved siblings remain; network failures,
unverified receipts and permission denial cannot authorize clearing. Clearing a
local rejected review does not delete source records or backend approvals.

Thirty-three focused Slack tests passed, including nine new outbox tests for lost
responses, partial batches, scope separation, storage failure, closure/revocation,
competing requests, per-item rejection and external replacement. Application and
preview typechecks passed. The preview build passed with its existing dynamic-import
and chunk-size warnings. Synthetic browser checks verified partial batch → progress
refresh → full reload → original retry, channel reload/retry, individual rejection
and viewer restrictions. The preview tab and owned loopback server were closed.

See [structured evidence](evidence/learn-slack-import-outbox-local-2026-10-10.json)
and [restored batch screenshot](evidence/learn-slack-import-outbox-2026-10-10.png).
These forms still need signed-in hosted browser acceptance. Actual two-tab browser
contention was not exercised; lock competition has unit evidence. Storage is local
to the browser, not a server outbox or cross-device queue. No hosted schema,
production data, provider, credential or schedule changed. TEST remains release
014/runtime v4. Live capture, thread recovery, continuous/multi-window capture,
frontend deployment and the broader LEARN V1 requirements remain outstanding.

## Interrupted thread recovery — local, 10 October

Incomplete observed-thread windows now have a local recovery backend and strict
client adapter. Reviewed continue/restart creates a new retained approval, preserving
the original scope, checkpoint and source evidence. Active, complete, stale and
superseded reviews are refused; exact retries retain their receipt, and competing
reviews queue once. The existing worker processes these approvals unchanged.

The full isolated SQL chain, controlled authority/connection/approval races,
39 Slack client checks, actual SQL responses through the client and application
TypeScript passed. The recovery screen and durable browser outbox subsequently
passed 46 client tests, application/preview typechecks, both builds and synthetic
browser checks for lost-response reload/retry, restart, rejected reviews, viewer
access and complete-window restrictions. Hosted release/acceptance remains next.
TEST remains release 020/runtime v4. See
[contract, evidence and limits](LEARN-SLACK-THREAD-RECOVERY.md).

Release 021 subsequently passed hosted rollback rehearsal and installation at
03:45 UTC on 10 October, preserving the preceding catalog. TEST now has the thread
recovery functions/indexes; worker runtime remains v4. Signed-in RPC/browser
acceptance and live provider capture remain next. Installation queued no imports
and changed no existing source rows. See the linked contract for release evidence.

Actual signed-in recovery acceptance subsequently passed for release 021, including
competing approvals, exact retries, retained checkpoints/messages, thread continuation
and restart, service publication deduplication, missing-credential refusal and
completed-window restrictions. The real app passed continuation, list refresh and
full reload checks. Existing TEST source/approval fingerprints stayed unchanged;
synthetic users, queues and connections were retired with evidence retained. Live
Slack provider capture remains unverified. See
[acceptance evidence](evidence/learn-slack-thread-recovery-test-acceptance-2026-10-10.json).
