# Email Input — Reliability Acceptance

Gmail (OAuth) and Google Workspace (DWD) must run for a full working day with **no
manual reconnect, delegation re-test, mailbox discovery or catch-up**. This document
defines the acceptance test, the honest connector-state model, the initial targets,
and the verification SQL. Targets are **initial** service levels — tune once real
throughput is observed.

## Architecture (after v2)

```
email-scheduled-sync            (*/5)  ──enqueue email.gmail_sync per OAuth mailbox──┐
email-workspace-scheduled-sync  (*/5)  ──enqueue email.workspace_sync per DWD mailbox ├─▶ platform_jobs
                                        + throttled email.mailbox_discovery per tenant┘        │
email-workspace-backfill-…      (*/15) ──enqueue email.workspace_backfill (low priority)──────┘
platform-worker                 (*/1)  ──claim──▶ email.* handlers ──▶ existing sync fns
   → email_messages → interactions-sync (email_select_unprojected, oldest-first)
   → interactions → interaction.ready → identity → graph → cards → recommendations
```

Selection and all health math are **database-side** (migration
`20260712120000_email_reliability.sql`): `email_select_unprojected`,
`email_connector_health`, `email_connector_diagnostics`. The explicit connector-state
enum is derived by the pure, unit-tested `_shared/email_health.ts` and served by the
single `email-connector-status` endpoint that BOTH surfaces read (§11/§12).

## Honest connector states (§2)

| State                                  | Evidence required                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `needs_setup`                          | no OAuth account / no Workspace connection                                              |
| `connected_healthy`                    | a successful sync within the last 15 min, no current failure                            |
| `connected_stale`                      | connected + authed, but no success in 15 min (or never yet)                             |
| `connected_failing`                    | latest sync failure is **newer** than latest success                                    |
| `auth_expired` (Gmail)                 | an account with `auth_state ∈ {revoked, needs_reconnect, expired}`                      |
| `delegation_failed` (Workspace)        | latest delegated-op failure newer than latest success, or `status='error'` never proved |
| `no_mailboxes`                         | delegation healthy, zero enabled mailboxes                                              |
| `backfill_running` / `backfill_failed` | reported as a **separate** dimension — never worsens live health (§7)                   |
| `disabled`                             | connector/account disabled — not a failure                                              |
| `unknown`                              | evidence unavailable                                                                    |

Golden rule enforced everywhere: **a later success resolves an earlier failure**
(`isCurrentFailure(failAt, successAt)`), and self-healing writes clear latched flags —
a successful delegated sync resets `google_workspace_connections.status error→active`;
a successful token refresh sets `email_accounts.auth_state='ok'`.

## Root causes fixed

1. Latched delegation error (`status='error'`) never cleared by sync → **self-heal on
   sync success** + resolved-by-later-success in the state model.
2. Undifferentiated Gmail refresh failures → `classifyRefreshError` (`invalid_grant` =
   permanent reconnect; 5xx/429 = transient retry) + persisted `auth_state`.
3. Reconnect could null the stored refresh token → callback now omits the column when
   absent (keeps the existing token).
4. No incremental cursor → Gmail `historyId` via `users.history.list` with recent-window
   fallback; cursor advances only after persistence.
5. Manual-only discovery → scheduled `email.mailbox_discovery` + prune (`last_seen_at` →
   `status='removed'`), preserving admin `sync_enabled` choices.
6. Inline sync → per-mailbox `platform_jobs` (retries/backoff/dead-letter); one failing
   mailbox never blocks the tenant; backfill lower priority than live sync.
7. Email→interaction projection selected newest-500 → `email_select_unprojected`
   (oldest unprojected first) — old mail can never starve.

## Initial targets (one-day test)

| Metric                                                    | Target                                                  |
| --------------------------------------------------------- | ------------------------------------------------------- |
| Scheduler acceptance                                      | ≥ 99% of ticks enqueue/dedupe cleanly                   |
| Worker completion                                         | ≥ 99% of claimed jobs complete (excl. provider outages) |
| New email ingested                                        | 95% within 5 min                                        |
| Canonical interaction created                             | 95% within 7 min                                        |
| Identity/card update                                      | 95% within 10 min                                       |
| Manual reconnect / discovery / catch-up                   | none during normal operation                            |
| Cursor gaps / duplicate messages / duplicate interactions | none                                                    |
| Oldest eligible backlog item                              | < 15 min                                                |
| Live sync vs backfill                                     | live unaffected by backfill                             |
| Unresolved dead-letter jobs                               | 0 without visible operator guidance                     |

## Verification SQL (§19)

Run in the Supabase SQL editor (service role). Replace `<tenant>`.

```sql
-- Accounts + honest auth/cursor state
select id, email_address, status, auth_state, history_id is not null as has_cursor,
       last_incremental_success_at, last_sync_error
from email_accounts order by updated_at desc;

-- Workspace connection + mailboxes (removed ones are pruned, not deleted)
select status, error_message, last_verified_at from google_workspace_connections;
select email_address, sync_enabled, status, last_seen_at
from google_workspace_mailboxes order by status, email_address;

-- Recent source messages
select id, provider_message_id, received_at, created_at
from email_messages order by created_at desc limit 50;

-- Email interactions
select id, source_id, source_connector_id, direction, subject, processing_status, occurred_at
from interactions where interaction_type = 'email_message' order by created_at desc limit 50;

-- Unprojected backlog (must be draining oldest-first; never starved)
select * from email_select_unprojected('<tenant>', 20);

-- Queue health (per-mailbox jobs; skipped:40-style no-ops must not appear)
select job_type, status, attempt_count, claimed_by, records_processed, last_error, created_at
from platform_jobs where job_type like 'email.%' or job_type = 'interactions.sync'
order by created_at desc limit 50;

-- Authoritative health (the numbers both UIs render)
select jsonb_pretty(email_connector_health('<tenant>'));
select * from email_connector_diagnostics('<tenant>', 50);
```

## One real email end-to-end proof (§15)

Send one real email to a monitored Gmail OAuth mailbox and one to a Workspace mailbox,
then capture timestamps and compute latency:

```sql
-- occurred → source row
select provider_message_id, received_at as email_occurred, created_at as source_row_created
from email_messages where provider_message_id = '<MESSAGE_ID>';
-- source → interaction
select occurred_at, created_at as interaction_created
from interactions where source_external_id = '<MESSAGE_ID>';
-- interaction → enrichment: check identity/graph/card/recommendation tables updated_at
-- after the interaction_created timestamp (identity_* , business_graph_* , customer_cards, recommendations)
```

Total latency = recommendation/card update − email_occurred. Run once per connector. If a
connector is not actually in use for this tenant, record that honestly rather than
fabricating a proof.

## Automated tests (§17)

- Pure logic (Deno, zero install): `deno test supabase/functions/_shared/email_health_test.ts`
  — stale-failure-resolved-by-later-success, refreshed-token-no-reconnect, delegation-cleared,
  disabled-not-failed, refresh/delegation classification.
- DB logic: `psql "$DATABASE_URL" -f supabase/tests/email_reliability.test.sql`
  — starvation-free selection, idempotent message + interaction, health shape. (Runs in a
  rolled-back transaction; never mutates real data.)

## Deployment & rollback (§20)

```bash
supabase db push
supabase functions deploy platform-worker email-connector-status \
  email-scheduled-sync email-workspace-scheduled-sync email-workspace-backfill-scheduled-sync \
  gmail-oauth-callback gmail-sync-messages gmail-workspace-sync-messages \
  google-workspace-test-connection google-workspace-discover-mailboxes
# frontend
bun run lint && bun run build
```

- No cron / `serviceos_schedule_defs()` change (cadence unchanged; `platform-worker`
  redeploys because it imports the new handlers). No new secrets.
- **Rollback**: redeploy the previous function versions; the additive migration is inert if
  unused (drop the new functions/columns only if you must).
- **Disable one mailbox without stopping all email**: set that mailbox's
  `google_workspace_mailboxes.sync_enabled=false` (or `email_accounts.status='disabled'`).
  The scheduler stops enqueuing it; every other mailbox keeps flowing.

## Security (§21)

Service-role only on internal handlers/RPCs; tenant bound server-side (never from the
browser); OAuth tokens + SA private key server-side only; no token/secret/full-body in
job metadata, safe errors, or diagnostics; RLS preserved (new functions granted to
`service_role` only); role-gated admin actions.

```

```
