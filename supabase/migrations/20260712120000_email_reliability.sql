-- ServiceOS — Email Reliability v2 (honest state, cursor, starvation-free projection).
--
-- WHY: email had no honest connector-health model. A latched
-- google_workspace_connections.status='error' recurred as "Re-test delegation"
-- forever; Gmail had no auth state (a revoked token looked "active"); there was no
-- incremental cursor; and the email→interaction projection selected the NEWEST 500
-- messages, so older unprojected mail could starve. This migration adds the DB
-- foundation to fix all of that:
--   * per-account incremental cursor + honest auth state columns,
--   * mailbox prune-detection (last_seen_at),
--   * starvation-free unprojected-message selection (oldest first),
--   * one authoritative health/diagnostics evidence source both surfaces read.
--
-- The state ENUM logic itself lives in a pure, unit-tested Deno module
-- (_shared/email_health.ts deriveConnectorState); these functions return raw
-- EVIDENCE only, so there is one place for the numbers and one place for the logic.
--
-- Non-destructive & idempotent: additive columns + read-only functions. No table
-- drops, no data mutation. Service-role-only grants (Edge Functions read these; the
-- browser reads the derived summary via the email-connector-status function).

-- ---------------------------------------------------------------------------
-- email_accounts — incremental cursor + honest auth/sync state (per mailbox)
-- ---------------------------------------------------------------------------
alter table email_accounts
  add column if not exists history_id                    text,          -- Gmail incremental cursor
  add column if not exists auth_state                    text not null default 'unknown',
                                                                        -- unknown | ok | expired | revoked | needs_reconnect
  add column if not exists auth_error                    text,          -- safe code, never a token
  add column if not exists auth_state_at                 timestamptz,
  add column if not exists last_incremental_success_at   timestamptz,
  add column if not exists last_incremental_attempt_at   timestamptz,
  add column if not exists last_sync_error               text;          -- safe code, never content

-- ---------------------------------------------------------------------------
-- google_workspace_mailboxes — prune detection (discovery stamps present rows)
-- ---------------------------------------------------------------------------
alter table google_workspace_mailboxes
  add column if not exists last_seen_at timestamptz;

-- ---------------------------------------------------------------------------
-- email_select_unprojected — starvation-free projection selection (§16)
-- ---------------------------------------------------------------------------
-- OLDEST unprojected email_messages first (those with no canonical interaction
-- yet), bounded. Replaces the former newest-500 window so old mail can never
-- starve behind newer already-projected rows. Idempotent upsert stays downstream.
create or replace function email_select_unprojected(
  p_tenant_id uuid,
  p_limit int default 200
)
returns setof email_messages
language sql
stable
as $$
  select m.*
  from email_messages m
  where m.tenant_id = p_tenant_id
    and not exists (
      select 1
      from interactions i
      where i.tenant_id = m.tenant_id
        and i.source_table = 'email_messages'
        and i.source_id = m.id
    )
  order by coalesce(m.received_at, m.sent_at, m.created_at) asc
  limit greatest(1, least(2000, p_limit));
$$;

-- ---------------------------------------------------------------------------
-- email_connector_health — raw EVIDENCE for gmail + workspace + shared pipeline
-- ---------------------------------------------------------------------------
-- Returns one jsonb object. The state enum is derived from this by the pure
-- _shared/email_health.ts deriveConnectorState(). "current failure" is expressed
-- as (last_failure_at vs last_success_at) so a later success always resolves it.
-- DWD mailboxes are email_accounts with status pending_tokenless_dwd|active_dwd;
-- OAuth Gmail accounts are the rest.
create or replace function email_connector_health(p_tenant_id uuid)
returns jsonb
language sql
stable
as $$
with
-- OAuth Gmail accounts (exclude the DWD sync units)
gmail_accts as (
  select *
  from email_accounts
  where tenant_id = p_tenant_id
    and provider = 'gmail'
    and status not in ('pending_tokenless_dwd', 'active_dwd')
),
gmail_agg as (
  select
    count(*)                                                          as accounts_total,
    count(*) filter (where status = 'active')                        as accounts_active,
    count(*) filter (where status = 'disabled')                      as accounts_disabled,
    count(*) filter (where auth_state in ('revoked','needs_reconnect','expired')) as accounts_auth_failing,
    count(*) filter (where auth_state = 'ok')                        as accounts_auth_ok,
    min(last_incremental_success_at)                                 as min_last_success
  from gmail_accts
),
gmail_runs as (
  select
    max(completed_at) filter (where status = 'success')              as last_success_at,
    max(started_at)   filter (where status = 'failed')               as last_failure_at,
    max(completed_at) filter (where status = 'success' and records_processed > 0) as last_useful_at,
    (array_agg(error_message order by started_at desc)
       filter (where status = 'failed'))[1]                          as last_failure_message
  from email_sync_runs
  where tenant_id = p_tenant_id
    and sync_type in ('messages', 'scheduled_sync')
),
-- Workspace DWD
wksp_conn as (
  select status, error_message, last_verified_at
  from google_workspace_connections
  where tenant_id = p_tenant_id
  order by updated_at desc
  limit 1
),
wksp_mbx as (
  select
    count(*)                                             as mailboxes_total,
    count(*) filter (where sync_enabled and status <> 'removed') as mailboxes_enabled,
    count(*) filter (where status = 'disabled')          as mailboxes_disabled,
    count(*) filter (where status = 'removed')           as mailboxes_removed
  from google_workspace_mailboxes
  where tenant_id = p_tenant_id
),
-- any successful delegated operation proves delegation is currently healthy
wksp_deleg as (
  select
    max(completed_at) filter (where status = 'success')  as last_ok_at,
    max(started_at)   filter (where status = 'failed')   as last_fail_at
  from email_sync_runs
  where tenant_id = p_tenant_id
    and sync_type in ('workspace_test','workspace_messages','workspace_scheduled_sync','workspace_discover','workspace_backfill')
),
wksp_sync as (
  select
    max(completed_at) filter (where status = 'success')  as last_success_at,
    max(started_at)   filter (where status = 'failed')   as last_failure_at,
    max(completed_at) filter (where status = 'success' and records_processed > 0) as last_useful_at,
    (array_agg(error_message order by started_at desc)
       filter (where status = 'failed'))[1]              as last_failure_message
  from email_sync_runs
  where tenant_id = p_tenant_id
    and sync_type in ('workspace_messages','workspace_scheduled_sync')
),
wksp_disc as (
  select
    max(completed_at) filter (where status = 'success')  as last_success_at,
    max(started_at)   filter (where status = 'failed')   as last_failure_at
  from email_sync_runs
  where tenant_id = p_tenant_id and sync_type = 'workspace_discover'
),
wksp_backfill as (
  select
    count(*) filter (where backfill_status = 'running')  as running,
    count(*) filter (where backfill_status = 'error')    as errored
  from email_accounts
  where tenant_id = p_tenant_id
    and status in ('pending_tokenless_dwd','active_dwd')
),
-- shared email pipeline (projection + enrichment + queue)
unprojected as (
  select
    count(*)                                             as backlog,
    min(coalesce(received_at, sent_at, created_at))      as oldest_at
  from email_messages m
  where m.tenant_id = p_tenant_id
    and not exists (
      select 1 from interactions i
      where i.tenant_id = m.tenant_id
        and i.source_table = 'email_messages'
        and i.source_id = m.id
    )
),
recent_msgs as (
  select count(*) as n
  from email_messages
  where tenant_id = p_tenant_id
    and coalesce(received_at, created_at) > now() - interval '60 minutes'
),
email_interactions as (
  select count(*) as n, max(created_at) as last_at
  from interactions
  where tenant_id = p_tenant_id and interaction_type = 'email_message'
),
email_jobs as (
  select
    max(created_at)                                      as scheduler_last_at,
    max(completed_at) filter (where status = 'succeeded') as worker_last_success_at,
    count(*) filter (where status = 'dead_letter')       as dead_letter_count,
    count(*) filter (where status in ('queued','running','retrying')) as active_jobs
  from platform_jobs
  where tenant_id = p_tenant_id and job_type like 'email.%'
)
select jsonb_build_object(
  'gmail', jsonb_build_object(
    'configured', (ga.accounts_total > 0),
    'accounts_total', ga.accounts_total,
    'accounts_active', ga.accounts_active,
    'accounts_disabled', ga.accounts_disabled,
    'accounts_auth_ok', ga.accounts_auth_ok,
    'accounts_auth_failing', ga.accounts_auth_failing,
    'last_success_at', gr.last_success_at,
    'last_failure_at', gr.last_failure_at,
    'last_useful_at', gr.last_useful_at,
    'last_failure_message', left(gr.last_failure_message, 300)
  ),
  'workspace', jsonb_build_object(
    'configured', (select count(*) > 0 from google_workspace_connections where tenant_id = p_tenant_id),
    'connection_status', (select status from wksp_conn),
    'connection_error', left((select error_message from wksp_conn), 300),
    'connection_last_verified_at', (select last_verified_at from wksp_conn),
    'mailboxes_total', wm.mailboxes_total,
    'mailboxes_enabled', wm.mailboxes_enabled,
    'mailboxes_disabled', wm.mailboxes_disabled,
    'mailboxes_removed', wm.mailboxes_removed,
    'delegation_last_ok_at', wd.last_ok_at,
    'delegation_last_fail_at', wd.last_fail_at,
    'last_success_at', ws.last_success_at,
    'last_failure_at', ws.last_failure_at,
    'last_useful_at', ws.last_useful_at,
    'last_failure_message', left(ws.last_failure_message, 300),
    'discovery_last_success_at', wdi.last_success_at,
    'discovery_last_failure_at', wdi.last_failure_at,
    'backfill_running', wb.running,
    'backfill_errored', wb.errored
  ),
  'pipeline', jsonb_build_object(
    'unprojected_backlog', up.backlog,
    'oldest_unprojected_at', up.oldest_at,
    'oldest_unprojected_age_seconds',
      case when up.oldest_at is null then null
           else greatest(0, floor(extract(epoch from (now() - up.oldest_at))))::int end,
    'messages_last_60m', rm.n,
    'email_interactions_total', ei.n,
    'last_email_interaction_at', ei.last_at,
    'scheduler_last_at', ej.scheduler_last_at,
    'worker_last_success_at', ej.worker_last_success_at,
    'active_jobs', ej.active_jobs,
    'dead_letter_count', ej.dead_letter_count
  )
)
from gmail_agg ga, gmail_runs gr, wksp_mbx wm, wksp_deleg wd, wksp_sync ws,
     wksp_disc wdi, wksp_backfill wb, unprojected up, recent_msgs rm,
     email_interactions ei, email_jobs ej;
$$;

-- ---------------------------------------------------------------------------
-- email_connector_diagnostics — per account/mailbox rows for the admin table (§13)
-- ---------------------------------------------------------------------------
-- One row per email_account (sync unit). Codes + timestamps only — never a token,
-- private key or email body. `enabled` for DWD units joins the discovered mailbox.
create or replace function email_connector_diagnostics(
  p_tenant_id uuid,
  p_limit int default 200
)
returns table (
  email_account_id uuid,
  connector text,
  email_address text,
  enabled boolean,
  account_status text,
  auth_state text,
  history_cursor text,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  backfill_status text,
  backfill_total_fetched int
)
language sql
stable
as $$
  select
    a.id                                                        as email_account_id,
    case when a.status in ('pending_tokenless_dwd','active_dwd')
         then 'workspace' else 'gmail' end                     as connector,
    a.email_address,
    coalesce(mb.sync_enabled, a.status <> 'disabled')          as enabled,
    a.status                                                   as account_status,
    a.auth_state,
    case when a.history_id is not null then 'history' else 'window' end as history_cursor,
    a.last_incremental_success_at                              as last_success_at,
    a.last_incremental_attempt_at                              as last_attempt_at,
    coalesce(a.last_sync_error, a.auth_error)                  as last_error,
    a.backfill_status,
    a.backfill_total_fetched
  from email_accounts a
  left join google_workspace_mailboxes mb
    on mb.tenant_id = a.tenant_id
   and lower(mb.email_address) = lower(a.email_address)
  where a.tenant_id = p_tenant_id
  order by a.last_incremental_success_at asc nulls first
  limit greatest(1, least(1000, p_limit));
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role only (Edge Functions). Never authenticated/public.
-- ---------------------------------------------------------------------------
revoke all on function email_select_unprojected(uuid, int) from public;
revoke all on function email_connector_health(uuid) from public;
revoke all on function email_connector_diagnostics(uuid, int) from public;
grant execute on function email_select_unprojected(uuid, int) to service_role;
grant execute on function email_connector_health(uuid) to service_role;
grant execute on function email_connector_diagnostics(uuid, int) to service_role;
