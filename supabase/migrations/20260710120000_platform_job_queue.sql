-- ServiceOS — Async Worker Queue v1 (platform_jobs becomes the queue).
--
-- DECISION: extend `platform_jobs` rather than build a second queue. It already
-- has priority, attempt_count, max_attempts, next_run_at, error_count, last_error,
-- completed_at/failed_at/cancelled_at and the ACTIVE-job_key unique index
-- (idempotent enqueue). This migration adds ONLY the missing lease/claim columns
-- and an atomic claim function. Non-destructive; existing rows untouched.
--
-- Lifecycle: queued → running → succeeded | (retrying → running → …) → dead_letter
--            (or cancelled). 'dead_letter' is a NEW status value (status is free
--            text, so no constraint change). Existing values are unchanged.
--
-- Reused as-is: attempt_count (= attempts), max_attempts, priority, job_key
-- (= idempotency key, guarded by platform_jobs_active_job_key_uk), next_run_at,
-- last_error, completed_at / failed_at / cancelled_at.

alter table platform_jobs
  add column if not exists available_at      timestamptz, -- claimable at/after (null = immediately)
  add column if not exists claimed_at        timestamptz,
  add column if not exists claimed_by        text,        -- worker id (never a secret)
  add column if not exists lease_expires_at  timestamptz,
  add column if not exists last_attempt_at   timestamptz,
  add column if not exists dead_lettered_at  timestamptz,
  add column if not exists error_code        text,        -- machine-readable, safe
  add column if not exists parent_job_id     uuid;        -- chained/child jobs (nullable)

-- Claim scan: queued/retrying jobs that are due and unleased, best priority first.
create index if not exists platform_jobs_claim_idx
  on platform_jobs (available_at, priority, created_at)
  where status in ('queued', 'retrying');

-- Lease reclaim: expired running jobs.
create index if not exists platform_jobs_lease_idx
  on platform_jobs (lease_expires_at)
  where status = 'running';

-- Chained jobs lookup.
create index if not exists platform_jobs_parent_idx
  on platform_jobs (tenant_id, parent_job_id)
  where parent_job_id is not null;

-- ── Atomic claim ────────────────────────────────────────────────────────────
-- Claims up to p_batch due jobs in ONE statement using FOR UPDATE SKIP LOCKED so
-- two workers never claim the same job. Marks them running, stamps the lease, and
-- increments the attempt counter. Tenant isolation is preserved (each returned row
-- carries its tenant_id; the worker acts per-row). NULL available_at = due now;
-- NULL/expired lease = claimable.
create or replace function platform_jobs_claim(
  p_worker        text,
  p_batch         int default 5,
  p_lease_seconds int default 300,
  p_job_types     text[] default null
)
returns setof platform_jobs
language plpgsql
as $fn$
begin
  return query
  update platform_jobs j set
    status           = 'running',
    claimed_at       = now(),
    claimed_by       = p_worker,
    lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)),
    attempt_count    = j.attempt_count + 1,
    last_attempt_at  = now(),
    started_at       = coalesce(j.started_at, now())
  where j.id in (
    select c.id
    from platform_jobs c
    where c.status in ('queued', 'retrying')
      and (c.available_at is null or c.available_at <= now())
      and (c.lease_expires_at is null or c.lease_expires_at < now())
      and (p_job_types is null or c.job_type = any(p_job_types))
    order by c.priority asc, c.created_at asc
    for update skip locked
    limit greatest(1, least(50, p_batch))
  )
  returning j.*;
end;
$fn$;

-- The queue is infrastructure: only the service role (the worker) may claim.
-- The browser can never claim or mutate jobs (no RLS write policy exists either).
revoke all on function platform_jobs_claim(text, int, int, text[]) from public;
revoke all on function platform_jobs_claim(text, int, int, text[]) from authenticated;
grant execute on function platform_jobs_claim(text, int, int, text[]) to service_role;

-- ── Register the async queue worker on the cron schedule ────────────────────
-- Redefines serviceos_schedule_defs() (from 20260709180000_scheduler_cron.sql) to
-- add the `platform-worker` running EVERY MINUTE, gated by WORKER_SECRET. Applied
-- as this (later) migration so it takes effect even if the scheduler migration was
-- already pushed. Re-run `select serviceos_schedule_all();` after applying.
create or replace function serviceos_schedule_defs()
returns table (job text, fn text, secret text, sched text)
language sql immutable as $$
  select * from (values
    ('serviceos-worker',              'platform-worker',                         'WORKER_SECRET',                   '* * * * *'),
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
