# Input Reliability: Verification & Acceptance

The input layer turns raw Signals into canonical Interactions. This document is the
single acceptance authority for both input connectors: the Phone / VoIP pipeline and
the Email connectors (Gmail OAuth and Google Workspace domain-wide delegation). Each
must run a full working day with **no manual intervention** — no reconnect, no
delegation re-test, no mailbox discovery, no catch-up, no manual processing buttons.

The two connectors are structural twins. They share one acceptance framework, one
health philosophy, one projection model, and one queue. Only the ingestion mechanics
differ, so the connector-specific mechanics live in their own sections (§4, §5) and
everything else is stated once.

Terminology follows [../architecture/00_GLOSSARY.md](../architecture/00_GLOSSARY.md):
a **Signal** is one raw thing that happened; a connector normalises it into an
**Interaction** row; the canonical Interaction lifecycle is `pending -> ready ->
enriched`. "Analysed" is a retired synonym for `ready` and is not used here.

---

## 1. Acceptance framework (shared)

The bar for both connectors is the same one-day test:

> Run a full working day. Every real Signal becomes an Interaction and flows through
> identity, graph, cards and recommendations, with no manual step, no false stale
> warning, no duplicate, and no starved backlog.

### 1.1 Shared dataflow

```
scheduler (*/N)  ──enqueue──▶ platform_jobs  ──claim──▶ platform-worker (*/1)
                                                            │ runs connector handler
                                                            ▼
                                 source rows (phone_recordings | email_messages)
                                                            │ projection (content-versioned)
                                                            ▼
                                 interactions  ──interaction.ready──▶ identity ──▶ graph
                                                            ──▶ cards ──▶ recommendations
```

Every stage is a queued job. Schedulers only **enqueue and return**; the single
`platform-worker` process claims jobs and runs the connector handlers. No connector
does inline work on the scheduler tick, so one failing mailbox or one bad recording
never blocks a tenant, and retries, backoff and dead-letter are uniform across
connectors (`platform_jobs.available_at`: 1m -> 5m -> 15m -> 60m -> dead-letter).

### 1.2 Content-versioned projection (how we got here)

Selection into `interactions` is driven by a **content hash**, not a timestamp. This
is the durable architectural decision behind both connectors and is worth stating in
full because a timestamp-based projector is subtly broken.

A projector keyed on `interactions.source_updated_at = max(source.updated_at, ...)`
chases a moving target. The phone poller (`phone-scheduled-sync -> simwood-sync-calls`)
re-upserts `phone_calls` every 5 minutes, and `set_updated_at` bumps
`updated_at = now()` on every **no-op** re-upsert. So `source.updated_at >
source_updated_at` is true again every cycle, and the same rows re-project forever
(the classic "phone_selected / updated = 221 on every run" symptom).

The fix, now the standing model, is `interactions.source_version`: a deterministic
`md5` of the **projected content** (the source fields plus the latest derived summary
and sentiment), computed once in SQL and used by the selector, the projector and the
finaliser alike.

- No-op re-upsert -> identical content -> identical hash -> **not selected**.
- Genuine change -> new hash -> selected **exactly once**.
- No `now()`, no timestamp comparison, so re-upsert churn cannot cause re-projection.

For phone, the version function is `phone_projection_version`; for email, the
unprojected selector is `email_select_unprojected`. Both carry `source_version` and
`source_updated_at` on the `interactions` row. After a deploy, one repair pass sets
`source_version` for existing rows, and the **next** projection run reports
`{processed: 0, upserted: 0}` while the poller keeps re-upserting underneath. A new
Signal produces exactly one projection and exactly one `interaction.ready` event; a
changed derived insight produces exactly one refresh; then zero again. No duplicate
Interaction, no duplicate event.

### 1.3 Honest connector health (how we got here)

Health is computed **database-side** and must never lie. Two failure modes are
designed out:

**No false stale.** When schedulers were rewritten to enqueue-and-return, they stopped
writing the heartbeat rows the health reader keys on, so healthy connectors reported
"stale / expected every 5 min". The standing rule: every scheduler writes a
lightweight per-tenant heartbeat every tick, and **a no-op run is a healthy run**. A
successful poll (including a no-op poll) refreshes the connector card. The five
signals stay separated — scheduler acceptance, worker execution, provider ingestion,
useful processing, last interaction — so a no-op success on any one never reads as
stale on the others.

**Dead-letter currentness.** A dead-letter counts as **current** only when no later
succeeded job exists for the same `job_key`; older dead-letters resolved by a
subsequent success are historical, not current.

The golden rule enforced everywhere: **a later success resolves an earlier failure.**
Self-healing writes clear latched flags rather than waiting for an operator (see §5.2).

### 1.4 Initial service targets

The targets in §4 and §5 are **initial** service levels. They are the first honest
guess at acceptable latency and are to be tuned once real production throughput is
observed. Treat a miss as a signal to investigate or retune, not as a hard contract.

### 1.5 Automated verification

Two mechanisms verify these guarantees without pasting SQL into the dashboard:

- The [Remote Verification Harness](./REMOTE_VERIFICATION_HARNESS.md) is the
  repository-owned runner (`npm run verify:*`). It asserts schema, registry and
  behaviour against the linked remote project and cleans up its own fixtures. The
  connector SQL below is for hands-on inspection; the harness is the repeatable proof.
- The **golden-loop** suite (`npm run verify:golden-loop`) exercises the continuous
  Signal -> Interaction -> intelligence loop end-to-end, of which input reliability is
  the first leg.

See also [./OBSERVABILITY_HEALTH.md](./OBSERVABILITY_HEALTH.md) for how these signals
render on the Operations Centre, and [./SCHEDULER_OPERATIONS.md](./SCHEDULER_OPERATIONS.md)
for scheduler cadence and deployment.

---

## 2. Real artefacts (shared index)

| Kind | Phone | Email |
| --- | --- | --- |
| Schedulers | `phone-scheduled-sync`, `phone-processing-scheduled-sync` | `email-scheduled-sync`, `email-workspace-scheduled-sync`, `email-workspace-backfill-scheduled-sync` |
| Worker handler | `handlePhoneProcessPending` (`_shared/worker_handlers/phone_process_pending.ts`) via `platform-worker` | `email.*` handlers via `platform-worker` |
| Selection fn | `phone_select_pending` | `email_select_unprojected` (oldest-first) |
| Version fn | `phone_projection_version` | (hash carried on `email_select_unprojected`) |
| Health fn | `phone_pipeline_health`, `phone_pipeline_diagnostics` | `email_connector_health`, `email_connector_diagnostics` |
| Status endpoint | `phone-pipeline-status` | `email-connector-status` |
| Source table | `phone_recordings` | `email_messages` |
| Canonical table | `interactions` (`source_version`, `source_updated_at`) | `interactions` (`source_version`, `source_updated_at`) |
| Queue table | `platform_jobs` | `platform_jobs` |

Code lives under [../../supabase/functions/](../../supabase/functions/) and
[../../supabase/migrations/](../../supabase/migrations/); tests under
[../../supabase/tests/](../../supabase/tests/).

---

## 3. Security (shared)

Service-role only on internal handlers and RPCs; tenant is bound server-side, never
from the browser. OAuth tokens, the service-account private key, provider credentials,
signed URLs, transcript text and audio URLs are server-side only and are **never**
written into job metadata, safe errors, or diagnostics. New functions are granted to
`service_role` only, RLS is preserved, and admin actions are role-gated.

---

## 4. Phone pipeline (download -> transcribe -> analyse -> finalise)

### 4.1 Architecture

```
phone-scheduled-sync ──▶ simwood-sync-recordings ──▶ phone_recordings (storage_path=null)
        (every 5 min)
phone-processing-scheduled-sync ──enqueue──▶ platform_jobs (phone.process_pending)
        (every 2 min)
platform-worker ──claim──▶ handlePhoneProcessPending
        (every 1 min)          │
                               ├─ phone_select_pending()  ← OLDEST incomplete first
                               └─ per recording: phone-process-pipeline
                                     download → transcribe → analyse → finalise
```

Selection and health math are database-side (migration
`20260711120000_phone_pipeline_selection.sql`): the view
`phone_recording_pipeline_state` and functions `phone_select_pending`,
`phone_pipeline_health`, `phone_pipeline_diagnostics`. There is no bounded scan window,
so old recordings can never starve and "failed" always means _currently blocked_,
never all-time history.

### 4.2 Selection and fairness

1. **Oldest incomplete first** — `phone_select_pending` orders by
   `coalesce(started_at, created_at) ASC`; the longest-waiting work is always chosen.
2. **Bounded batch** — default 5, max 10 per worker tick.
3. **Download readiness delay** — a recording in the `download` stage waits
   `MIN_DOWNLOAD_AGE_SECONDS` (120s) before its first fetch, because provider audio may
   not be ready immediately. The delay applies **only** to the download stage;
   already-downloaded recordings needing transcription or analysis are never delayed,
   so it never blocks older eligible work.
4. **Retry backoff respected** — a retryable failure re-queues with exponential backoff
   via `platform_jobs.available_at`.
5. **Non-retryable excluded** — `provider_recording_missing`, `invalid_recording`,
   `malformed_provider_id`, `cross_tenant_mismatch`, `unsupported_format` dead-letter
   immediately and await operator action.

### 4.3 Download retry classification

| Provider outcome | Safe code | Retryable |
| --- | --- | --- |
| 404 within retention window | `recording_not_ready` | yes |
| 404 past retention (45d) | `provider_recording_missing` | no |
| 429 | `provider_rate_limited` | yes |
| network / timeout | `provider_timeout` | yes |
| 5xx / read error | `download_failed` | yes |
| storage upload failure | `storage_failed` | yes |
| no `provider_recording_id` | `invalid_recording` | no |

### 4.4 Initial targets (one-day test)

| Metric | Target |
| --- | --- |
| Scheduler acceptance | >= 99% of ticks enqueue (or dedupe) cleanly |
| Worker success | >= 99% of claimed jobs complete (succeed or intentional no-op) |
| Download latency | 95% downloaded within 10 min of availability |
| Transcription latency | 95% of transcripts within 15 min |
| Analysis latency | 95% of analyses within 20 min |
| Interaction-ready latency | 95% finalised within 25 min |
| Oldest eligible age | no eligible item older than 30 min in normal operation |
| Backlog trend | no unexplained queue growth over the day |
| Current failure rate | 0 unresolved failures at end of day (after retries) |
| Dead-letter count | 0 (any dead-letter is an operator alert) |
| Manual processing | none required during the test day |

`phone-pipeline-status` maps these to health: **warning** at 15 min oldest / >10
backlog / any current failure / stale worker; **critical** at 30 min oldest / any
dead-letter / backlog with no worker run yet.

### 4.5 Verification SQL

Run in the Supabase SQL editor (service role). Replace `<tenant>`.

```sql
-- Backlog snapshot (run before and after a worker tick)
select
  count(*) as total,
  count(*) filter (where storage_path is null) as not_downloaded,
  count(*) filter (where storage_path is not null) as downloaded,
  min(started_at) filter (where storage_path is null) as oldest_not_downloaded,
  max(started_at) filter (where storage_path is null) as newest_not_downloaded
from phone_recordings where tenant_id = '<tenant>';

-- Stage backlog (DB-side, no scan window)
select stage, count(*) from phone_recording_pipeline_state
where tenant_id = '<tenant>' and is_incomplete group by stage order by stage;

-- Prove starvation is fixed: what SHOULD run vs what NOW runs (same oldest-first order)
select id, started_at, storage_path from phone_recordings
where tenant_id = '<tenant>' and storage_path is null order by started_at asc limit 10;
select id, stage, sort_at from phone_select_pending('<tenant>', 5, 120);

-- Authoritative health (the numbers both UIs render)
select jsonb_pretty(phone_pipeline_health('<tenant>'));

-- Unresolved-item diagnostics (per recording)
select * from phone_pipeline_diagnostics('<tenant>', 50);

-- Recent queue runs (skipped:40 must be gone)
select status, attempt_count, claimed_by, records_processed, result, last_error, created_at
from platform_jobs where job_type = 'phone.process_pending' order by created_at desc limit 30;
```

A healthy no-op now reads `{"processed":0,"skipped":0,"eligible_backlog":0,
"reason":"no_eligible_recordings"}` — never `skipped:40`.

### 4.6 Automatic-recovery acceptance test

1. Confirm old undownloaded recordings exist (backlog snapshot: `not_downloaded > 0`,
   `oldest_not_downloaded` days old).
2. Let the scheduler enqueue `phone.process_pending` (or trigger
   `phone-processing-scheduled-sync` once).
3. The worker claims the job and calls `phone_select_pending` -> oldest eligible rows.
4. At least one old recording advances a stage.
5. Re-run the backlog snapshot: `not_downloaded` **decreases** and
   `oldest_not_downloaded` **moves forward**.
6. The worker job completes successfully — no manual button pressed.

Repeat over a working day; `eligible_backlog` should trend to 0 and stay there.

### 4.7 Deployment runbook

```bash
supabase db push                       # applies 20260711120000_phone_pipeline_selection.sql
supabase functions deploy platform-worker phone-process-pending \
  phone-pipeline-status simwood-download-recording
# frontend
bun run lint && bun run build
```

`platform-worker` redeploys because it imports the changed shared handler
(`_shared/worker_handlers/phone_process_pending.ts`); `phone-process-pipeline` imports
the changed finaliser. No secrets, cron schedule or `serviceos_schedule_defs()` change
is required; the cadence is unchanged. Tests:
`psql "$DATABASE_URL" -f supabase/tests/phone_projection.test.sql`.

---

## 5. Email connectors (Gmail OAuth + Workspace DWD)

### 5.1 Architecture

```
email-scheduled-sync            (*/5)  ──enqueue email.gmail_sync per OAuth mailbox──┐
email-workspace-scheduled-sync  (*/5)  ──enqueue email.workspace_sync per DWD mailbox ├─▶ platform_jobs
                                        + throttled email.mailbox_discovery per tenant┘        │
email-workspace-backfill-…      (*/15) ──enqueue email.workspace_backfill (low priority)──────┘
platform-worker                 (*/1)  ──claim──▶ email.* handlers ──▶ existing sync fns
   → email_messages → interactions-sync (email_select_unprojected, oldest-first)
   → interactions → interaction.ready → identity → graph → cards → recommendations
```

Selection and health math are database-side (migration
`20260712120000_email_reliability.sql`): `email_select_unprojected`,
`email_connector_health`, `email_connector_diagnostics`. The explicit connector-state
enum is derived by the pure, unit-tested `_shared/email_health.ts` and served by the
single `email-connector-status` endpoint that both surfaces read. Backfill runs at
lower priority than live sync and never blocks it; the oldest-first
`email_select_unprojected` means old mail can never starve.

### 5.2 Honest connector states

| State | Evidence required |
| --- | --- |
| `needs_setup` | no OAuth account / no Workspace connection |
| `connected_healthy` | a successful sync within the last 15 min, no current failure |
| `connected_stale` | connected + authed, but no success in 15 min (or never yet) |
| `connected_failing` | latest sync failure is newer than latest success |
| `auth_expired` (Gmail) | an account with `auth_state in {revoked, needs_reconnect, expired}` |
| `delegation_failed` (Workspace) | latest delegated-op failure newer than latest success, or `status='error'` never proved |
| `no_mailboxes` | delegation healthy, zero enabled mailboxes |
| `backfill_running` / `backfill_failed` | reported as a separate dimension — never worsens live health |
| `disabled` | connector / account disabled — not a failure |
| `unknown` | evidence unavailable |

The `isCurrentFailure(failAt, successAt)` rule and self-healing writes are the email
expression of the shared health philosophy (§1.3). A successful delegated sync resets
`google_workspace_connections.status` from `error` to `active`; a successful token
refresh sets `email_accounts.auth_state='ok'`. Backfill health is a separate dimension
and never worsens live health.

Connector-specific hardening that this state model depends on:

- Gmail refresh failures are classified (`classifyRefreshError`): `invalid_grant` is a
  permanent reconnect, 5xx / 429 are transient retries, persisted as `auth_state`.
- A reconnect that lacks a fresh refresh token omits the column rather than nulling the
  stored one, so a partial callback never destroys a working token.
- Gmail uses an incremental cursor (`historyId` via `users.history.list`, recent-window
  fallback) that advances **only after** persistence, so a crash cannot skip mail.
- Mailbox discovery is scheduled (`email.mailbox_discovery`) with prune
  (`last_seen_at` -> `status='removed'`), preserving admin `sync_enabled` choices.

### 5.3 Initial targets (one-day test)

| Metric | Target |
| --- | --- |
| Scheduler acceptance | >= 99% of ticks enqueue / dedupe cleanly |
| Worker completion | >= 99% of claimed jobs complete (excl. provider outages) |
| New email ingested | 95% within 5 min |
| Canonical interaction created | 95% within 7 min |
| Identity / card update | 95% within 10 min |
| Manual reconnect / discovery / catch-up | none during normal operation |
| Cursor gaps / duplicate messages / duplicate interactions | none |
| Oldest eligible backlog item | < 15 min |
| Live sync vs backfill | live unaffected by backfill |
| Unresolved dead-letter jobs | 0 without visible operator guidance |

### 5.4 Verification SQL

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

### 5.5 One real email end-to-end proof

Send one real email to a monitored Gmail OAuth mailbox and one to a Workspace mailbox,
then capture timestamps and compute latency:

```sql
-- occurred → source row
select provider_message_id, received_at as email_occurred, created_at as source_row_created
from email_messages where provider_message_id = '<MESSAGE_ID>';
-- source → interaction
select occurred_at, created_at as interaction_created
from interactions where source_external_id = '<MESSAGE_ID>';
-- interaction → enrichment: check identity/graph/card/recommendation tables' updated_at
-- after interaction_created (identity_*, business_graph_*, customer_cards, recommendations)
```

Total latency = recommendation / card update - email_occurred. Run once per connector.
If a connector is not actually in use for this tenant, record that honestly rather than
fabricating a proof.

### 5.6 Automated tests

- Pure logic (Deno, zero install):
  `deno test supabase/functions/_shared/email_health_test.ts` — stale-failure resolved
  by later success, refreshed-token-no-reconnect, delegation-cleared, disabled-not-failed,
  refresh / delegation classification.
- DB logic: `psql "$DATABASE_URL" -f supabase/tests/email_reliability.test.sql` —
  starvation-free selection, idempotent message + interaction, health shape. Runs in a
  rolled-back transaction; never mutates real data.

### 5.7 Deployment runbook

```bash
supabase db push
supabase functions deploy platform-worker email-connector-status \
  email-scheduled-sync email-workspace-scheduled-sync email-workspace-backfill-scheduled-sync \
  gmail-oauth-callback gmail-sync-messages gmail-workspace-sync-messages \
  google-workspace-test-connection google-workspace-discover-mailboxes
# frontend
bun run lint && bun run build
```

No cron / `serviceos_schedule_defs()` change (cadence unchanged; `platform-worker`
redeploys because it imports the new handlers). No new secrets. **Rollback**: redeploy
the previous function versions; the additive migration is inert if unused. **Disable
one mailbox without stopping all email**: set that mailbox's
`google_workspace_mailboxes.sync_enabled=false` (or `email_accounts.status='disabled'`);
the scheduler stops enqueuing it and every other mailbox keeps flowing.

---

## 6. Post-deploy verification sequence (both connectors)

Run one step, confirm the expected result, then continue.

1. `supabase db push` -> migration applied. Confirm:
   `select exists(select 1 from pg_proc where proname='phone_projection_version');` -> `t`.
2. Diagnose projection before the handler redeploy:
   `select dirty_reason, count(*) from phone_projection_diagnostics('<tenant>', 500) group by 1;`
   -> expect mostly `version_changed` or `missing_source_marker`.
3. Deploy functions. Wait one `interactions.sync` cycle, then:
   `select result from platform_jobs where job_type='interactions.sync' order by created_at desc limit 1;`
   -> expect `phone_processed:0, interactions_upserted:0` (after the one repair pass).
4. Re-run step 2 -> expect all `clean`.
5. `select dirty_reason from phone_projection_diagnostics('<tenant>',500) where dirty_reason<>'clean';`
   -> expect 0 rows, even though `phone-scheduled-sync` keeps re-upserting calls.
6. Deploy the frontend. Open the Operations Centre: Phone, Gmail and Workspace cards
   show Healthy with no "stale" / "expected every 5 min" / "Reconnect" / "Re-test"
   unless a genuine current condition exists.
7. Scheduler health panel: all email and phone rows show a recent `lastRunAt` and
   `healthy`.

For the repeatable, source-controlled version of this proof, run the
[Remote Verification Harness](./REMOTE_VERIFICATION_HARNESS.md) and the golden-loop
suite instead of pasting SQL.
