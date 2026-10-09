# LEARN Slack history ingestion

## Current implementation and limits

The local `slack.history_sync` transport now requires an owned, unexpired queue
claim. Its `learn_slack_read_credential` resolver checks the exact existing Vault
reference and tenant-qualified credential name, approved connection revision and
running job before returning the token to the server. It neither creates nor
rotates credentials, accepts tokens or URLs from jobs, nor falls back to either
notification bot. No live Slack connection was found in the Drummonds registries
checked on 9 October.

The fenced worker and credential resolver are implemented and verified locally,
including real Vault encryption in a disposable offline database. They are **not
yet installed or deployed in TEST**. Only their earlier storage and approval
dependencies are installed; see [release 009 and signed-in acceptance](LEARN-TEST-SLACK.md).
Do not deploy the new transport against release 009 alone: the new page RPC has
eight arguments and the old six-argument writer becomes private.

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
- The reviewed storage/setup release plus pending worker/credential migrations
  `20261030100000_learn_slack_worker.sql` and
  `20261030110000_learn_slack_credential_binding.sql`. These require a separate
  catalog-checked TEST release and hosted acceptance before deployment. Storage
  checks happen before resolving credentials. Do not apply all pending migrations.

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

The pending `learn-slack-worker` endpoint accepts only an empty POST authenticated
with the existing project service key, in addition to gateway JWT verification.
User JWTs and caller-supplied job selectors cannot trigger it. Responses contain
queue outcomes, not credentials or source content. It does not create a schedule.
The original broad worker must not be deployed as a shortcut for this path.

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
rows or credential values. Release packaging, hosted rollback rehearsal and actual
JWT/Edge acceptance of this new path are the next gate. Existing release-009
acceptance helpers will need to recognize the new RPC signature at that gate.
