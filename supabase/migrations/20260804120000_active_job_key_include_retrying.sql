-- ServiceOS — Enqueue uniqueness: treat 'retrying' as ACTIVE (duplicate-job fix).
--
-- BUG. The one-active-row invariant was enforced by
--   platform_jobs_active_job_key_uk (tenant_id, job_key) WHERE status IN ('queued','running')
-- but the worker CLAIMS jobs whose status is IN ('queued','retrying') — and both
-- failJob() (exponential backoff) and releaseExpiredLeases() (dead-worker reclaim)
-- move a job to 'retrying'. So a job sitting in 'retrying' is fully ACTIVE (it WILL
-- be claimed and run), yet the uniqueness guard did not cover it. A scheduler firing
-- again while a job was in its retry backoff would enqueue a SECOND 'queued' row for
-- the same (tenant, job_key): two active jobs, duplicate work. This is the source of
-- the observed duplicate active jobs.
--
-- FIX (smallest safe change). Recreate the SAME partial unique index with 'retrying'
-- added to the active predicate, so the DB enforces exactly what the enqueue helper
-- already assumes (enqueueJob's duplicate-recovery lookup already queries
-- status IN ('queued','running','retrying') — this closes the gap it relied on).
--
-- SAFETY. The index is rebuilt (drop + create) inside this migration's transaction,
-- so the invariant is never absent to concurrent writers mid-migration. Before the
-- rebuild we DEFENSIVELY soft-cancel any straggler duplicate active jobs so the
-- stricter unique index cannot fail to build — keeping the most-advanced row per
-- (tenant, job_key) and cancelling the rest. This is idempotent and additive: it
-- touches ONLY rows that would violate the new invariant, and only ever transitions
-- an extra duplicate to 'cancelled' (never deletes, never touches a unique job).
-- platform_jobs is small; the non-concurrent index build is momentary.
--
-- ROLLBACK. Reverting is a one-liner (the previous invariant):
--   drop index if exists platform_jobs_active_job_key_uk;
--   create unique index platform_jobs_active_job_key_uk
--     on platform_jobs (tenant_id, job_key)
--     where job_key is not null and status in ('queued','running');
-- The defensive soft-cancels above are NOT undone by rollback (a cancelled duplicate
-- stays cancelled), which is safe: the surviving row remains the single active job.

-- 1) Defensive de-dup: keep one active row per (tenant, job_key); cancel extras.
--    Rank prefers the most-advanced / first-enqueued row so in-flight work is kept:
--    running (0) < retrying (1) < queued (2), then oldest created_at, then id.
with ranked as (
  select
    id,
    row_number() over (
      partition by tenant_id, job_key
      order by
        case status when 'running' then 0 when 'retrying' then 1 else 2 end,
        created_at asc,
        id asc
    ) as rn
  from platform_jobs
  where job_key is not null
    and status in ('queued', 'running', 'retrying')
)
update platform_jobs p set
  status           = 'cancelled',
  cancelled_at     = now(),
  lease_expires_at = null,
  error_code       = 'superseded_duplicate',
  last_error       = 'Superseded duplicate active job (retrying-uniqueness backfill).'
from ranked
where p.id = ranked.id
  and ranked.rn > 1;

-- 2) Recreate the invariant with 'retrying' included as ACTIVE.
drop index if exists platform_jobs_active_job_key_uk;

create unique index if not exists platform_jobs_active_job_key_uk
  on platform_jobs (tenant_id, job_key)
  where job_key is not null and status in ('queued', 'running', 'retrying');
