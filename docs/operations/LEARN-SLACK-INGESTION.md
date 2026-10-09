# LEARN Slack history ingestion

## Current implementation and limits

The registered `slack.history_sync` worker now has a real server transport. It
uses the existing `provider_secret_read` broker for the tenant's `slack/bot_token`
secret. It does not accept a token or URL from the job, use environment-wide
credentials, or fall back to either notification bot. No live Slack connection
was found in the Drummonds registries checked on 9 October. This implementation
has not been deployed or exercised with a live Slack credential.

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
  `slack.history_sync` and `payload.connector_account_id`.
- An active `connector_accounts` row under an enabled, active Slack
  `tenant_connectors` row belonging to the same tenant.
- A `settings.slack_history` object containing `approved: true`, `connectionId`,
  `teamId`, `channelId`, `oldest`, `latest`, `consentReference`, `expiresAt` and
  `maxPages`. Timestamps for the provider window remain strings. The stored
  checkpoint must match the exact window and consent reference.
- A matching `provider_connections` row with provider `slack`, status
  `configured`, no revocation, `non_secret_config.team_id`, a `bot_token` field
  in `configured_fields`, and its valid Vault reference in `secret_refs`.
- The reviewed Slack storage migration
  `20261029130000_learn_slack_history.sql` on the target database. Storage checks
  happen before resolving credentials. Do not apply unrelated pending migrations.

These are server prerequisites, not instructions to fabricate consent or change
the live database manually. Connection onboarding and scope selection still need
an authenticated owner/admin service and UI. Existing credentials should be
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

HTTP 429 produces a safe retryable error with Slack's minimum retry delay. The
generic queue takes the longer of that delay and its normal backoff; it retains
its existing finite attempt budget. Permanent permission failures stop for review.
Pacing is per account/job chain, not a workspace-wide rate reservation across
all possible integrations. Shared-workspace concurrency and continuation-enqueue
failure recovery still need live acceptance and scheduler work.

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
```

The transport tests use synthetic HTTP responses and database fixtures. They cover
tenant/connection checks, credential scope, restricted requests, continuation,
rate limits, malformed/oversized responses, resumed cursors and in-flight
revocation. SQL tests run in disposable offline PostgreSQL and include the real
existing interaction-table migration. Neither suite establishes deployed-schema
compatibility, actual Slack grants, complete provider coverage or live user access.
