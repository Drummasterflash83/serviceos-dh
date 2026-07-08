-- ServiceOS — Platform Jobs v1 (Execution Backbone).
--
-- The first first-class, durable job table. Today every job-like process (phone
-- sync, recording sync, transcription, workspace DWD sync, backfill, …) tracks
-- itself in its own sync-run/metadata table, so Operations Centre can only INFER
-- what's running/failed and retry/cancel/progress aren't real. `platform_jobs`
-- gives the platform one durable, queryable execution record.
--
-- Jobs v1 is TRACKING + VISIBILITY only: Edge Functions create/update rows via
-- the shared helper (service role); there is no executor/queue engine yet, and
-- retry/cancel are contract-only. Existing sync-run tables are UNCHANGED — jobs
-- supplement them, they do not replace them. Non-destructive & idempotent.
--
-- RLS: tenant-scoped SELECT for authenticated users; NO write policies (service
-- role Edge Functions own all writes, bypassing RLS). Reuses set_updated_at()
-- (Phone-0) and current_tenant_id() (Security-2).

create table if not exists platform_jobs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  connector_id      text,                              -- e.g. simwood | google-workspace (nullable)
  module_id         text,                              -- e.g. communications.phone (nullable)
  job_type          text not null,                     -- e.g. phone.scheduled_sync
  job_key           text,                              -- idempotency key for active de-dup (nullable)
  status            text not null default 'queued',    -- queued|running|succeeded|failed|cancelled|retrying|skipped
  priority          int not null default 100,
  progress_current  int not null default 0,
  progress_total    int,
  records_processed int not null default 0,
  error_count       int not null default 0,
  attempt_count     int not null default 0,
  max_attempts      int not null default 3,
  started_at        timestamptz,
  completed_at      timestamptz,
  failed_at         timestamptz,
  cancelled_at      timestamptz,
  next_run_at       timestamptz,
  last_error        text,
  payload           jsonb not null default '{}'::jsonb,
  result            jsonb not null default '{}'::jsonb,
  metadata          jsonb not null default '{}'::jsonb,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists platform_jobs_tenant_status_idx
  on platform_jobs (tenant_id, status, created_at desc);
create index if not exists platform_jobs_tenant_connector_idx
  on platform_jobs (tenant_id, connector_id, created_at desc);
create index if not exists platform_jobs_tenant_type_idx
  on platform_jobs (tenant_id, job_type, created_at desc);
create index if not exists platform_jobs_tenant_next_run_idx
  on platform_jobs (tenant_id, next_run_at);

-- At most one ACTIVE (queued|running) job per (tenant, job_key) — the idempotency
-- guard the shared helper relies on to gracefully no-op duplicate active runs.
-- Tenant-scoped to prevent any cross-tenant key collision.
create unique index if not exists platform_jobs_active_job_key_uk
  on platform_jobs (tenant_id, job_key)
  where job_key is not null and status in ('queued', 'running');

drop trigger if exists platform_jobs_set_updated_at on platform_jobs;
create trigger platform_jobs_set_updated_at
  before update on platform_jobs
  for each row execute function set_updated_at();

alter table platform_jobs enable row level security;

-- Tenant-scoped SELECT only. Writes are service-role via Edge Functions.
drop policy if exists platform_jobs_select_tenant on platform_jobs;
create policy platform_jobs_select_tenant on platform_jobs
  for select to authenticated using (tenant_id = current_tenant_id());
