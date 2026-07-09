-- ServiceOS — Scheduler deployment (pg_cron + pg_net), config-as-code.
--
-- The `*-scheduled-sync` functions exist but nothing invokes them on a timer, so
-- phone/email/signal/identity/graph/card/recommendation processing only runs when
-- a human presses a button. This migration makes scheduling REPEATABLE and
-- VERSIONED without hardcoding any secret or project ref.
--
-- SAFETY / IDEMPOTENCY: this migration only CREATES a config table + two helper
-- functions — it does NOT schedule anything on apply. The helpers use dynamic SQL
-- for every cron/pg_net/vault reference, so the migration applies cleanly EVEN
-- WHEN pg_cron / pg_net / Vault are not yet enabled (nothing is resolved at
-- CREATE time). The operator enables the extensions, loads the secrets into Vault,
-- sets the base_url, and then runs `select serviceos_schedule_all();`.
--
-- See docs/SCHEDULER_DEPLOYMENT.md for the full runbook.
--
-- Secrets are NEVER stored here. The cron body reads each x-schedule-secret from
-- Supabase Vault (vault.decrypted_secrets) at RUN time. The same secret value must
-- exist in the Edge Function env (supabase secrets set …) AND in Vault (Postgres),
-- because the function compares the header the cron sends.

-- ── singleton config: the Edge Functions base URL for this project ──────────
create table if not exists scheduler_config (
  id         boolean primary key default true,
  base_url   text, -- e.g. https://<project-ref>.functions.supabase.co  (no trailing slash)
  updated_at timestamptz not null default now(),
  constraint scheduler_config_singleton check (id)
);
-- Operator-only table (project URL). No RLS policies ⇒ readable only by the
-- service-role / postgres roles that run the helpers; the browser never reads it.
alter table scheduler_config enable row level security;

-- ── the ServiceOS schedule (name, function, secret, cron expression) ────────
-- Defined once, in SQL, so the cadence is versioned. Cadence matches
-- docs/SCHEDULERS.md + docs/INPUT_RELIABILITY.md.
create or replace function serviceos_schedule_defs()
returns table (job text, fn text, secret text, sched text)
language sql immutable as $$
  select * from (values
    ('serviceos-phone-sync',          'phone-scheduled-sync',                    'PHONE_SCHEDULE_SECRET',           '*/5 * * * *'),
    ('serviceos-phone-processing',    'phone-processing-scheduled-sync',         'PHONE_PROCESSING_SECRET',         '*/2 * * * *'),
    ('serviceos-email-sync',          'email-scheduled-sync',                    'EMAIL_SCHEDULE_SECRET',           '*/5 * * * *'),
    ('serviceos-email-workspace',     'email-workspace-scheduled-sync',          'EMAIL_WORKSPACE_SCHEDULE_SECRET', '*/5 * * * *'),
    ('serviceos-email-wksp-backfill', 'email-workspace-backfill-scheduled-sync', 'EMAIL_WORKSPACE_BACKFILL_SECRET', '*/15 * * * *'),
    ('serviceos-interactions',        'interactions-scheduled-sync',             'SIGNAL_SYNC_SECRET',              '*/5 * * * *'),
    ('serviceos-identity',            'identity-scheduled-sync',                 'IDENTITY_SYNC_SECRET',            '*/5 * * * *'),
    ('serviceos-business-graph',      'business-graph-scheduled-sync',           'GRAPH_SYNC_SECRET',               '*/5 * * * *'),
    ('serviceos-customer-cards',      'customer-card-scheduled-sync',            'CARD_SYNC_SECRET',                '*/5 * * * *'),
    ('serviceos-recommendations',     'recommendation-scheduled-sync',           'RECOMMENDATION_SYNC_SECRET',      '*/5 * * * *')
  ) as t(job, fn, secret, sched);
$$;

-- ── (re)schedule every ServiceOS cron job — idempotent ──────────────────────
-- Guarded: no-ops (with a clear message) until pg_cron + pg_net are enabled and a
-- base_url is configured. Re-running safely re-schedules (unschedule then
-- schedule), so cadence changes are one edit + one re-run.
create or replace function serviceos_schedule_all(p_base_url text default null)
returns text
language plpgsql
as $fn$
declare
  v_base   text;
  r        record;
  v_body   text;
  v_count  int := 0;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return 'pg_cron is not installed — enable it (Supabase → Database → Extensions), then re-run serviceos_schedule_all().';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return 'pg_net is not installed — enable it (Supabase → Database → Extensions), then re-run serviceos_schedule_all().';
  end if;

  v_base := coalesce(
    nullif(p_base_url, ''),
    (select base_url from scheduler_config where id order by updated_at desc limit 1)
  );
  if v_base is null or v_base = '' then
    return 'No base_url set. Run:  insert into scheduler_config (base_url) values (''https://<project-ref>.functions.supabase.co'') on conflict (id) do update set base_url = excluded.base_url, updated_at = now();  then re-run serviceos_schedule_all().';
  end if;
  v_base := rtrim(v_base, '/');

  for r in select * from serviceos_schedule_defs() loop
    -- Idempotent: drop any existing job of this name first.
    begin
      execute format('select cron.unschedule(%L)', r.job);
    exception
      when others then null; -- not scheduled yet → ignore
    end;

    -- Cron body: POST the scheduled function with its gate secret read from Vault
    -- at run time (never stored in this migration). '{}' body; JSON headers.
    v_body := format(
      $body$select net.http_post(
  url := %L,
  headers := jsonb_build_object(
    'content-type', 'application/json',
    'x-schedule-secret', (select decrypted_secret from vault.decrypted_secrets where name = %L)
  ),
  body := '{}'::jsonb
);$body$,
      v_base || '/' || r.fn,
      r.secret
    );

    execute format('select cron.schedule(%L, %L, %L)', r.job, r.sched, v_body);
    v_count := v_count + 1;
  end loop;

  return format('Scheduled %s ServiceOS cron jobs against %s. Verify with: select jobname, schedule, active from cron.job order by jobname;', v_count, v_base);
end;
$fn$;

-- ── pause / rollback: unschedule every ServiceOS cron job — idempotent ──────
create or replace function serviceos_unschedule_all()
returns text
language plpgsql
as $fn$
declare
  r       record;
  v_count int := 0;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return 'pg_cron is not installed — nothing to unschedule.';
  end if;
  for r in select job from serviceos_schedule_defs() loop
    begin
      execute format('select cron.unschedule(%L)', r.job);
      v_count := v_count + 1;
    exception
      when others then null; -- wasn't scheduled → ignore
    end;
  end loop;
  return format('Unscheduled %s ServiceOS cron jobs.', v_count);
end;
$fn$;
