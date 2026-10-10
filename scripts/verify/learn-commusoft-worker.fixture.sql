-- Extend only the disposable synthetic queue contract. The original claim
-- function is then loaded from the repository's real queue migration.
alter table platform_jobs alter column id set default gen_random_uuid();
alter table platform_jobs alter column attempt_count set default 0;
alter table platform_jobs add column job_key text,add column priority integer default 50,
  add column created_at timestamptz default now(),add column max_attempts integer default 3,
  add column available_at timestamptz,add column dead_lettered_at timestamptz,
  add column failed_at timestamptz,add column error_code text,add column claimed_at timestamptz,
  add column last_attempt_at timestamptz,add column started_at timestamptz,
  add column completed_at timestamptz,add column result jsonb default '{}',
  add column records_processed integer default 0,add column error_count integer default 0,
  add column connector_id text,add column module_id text,add column parent_job_id uuid;
create unique index platform_jobs_active_job_key_uk on platform_jobs(tenant_id,job_key)
  where job_key is not null and status in ('queued','running','retrying');
grant select,insert,update on platform_jobs to service_role;
update platform_jobs set job_key='commusoft.source:'||fixture_id(3)||':'||fixture_id(6),
  status='queued',attempt_count=0,claimed_by=null,lease_expires_at=null;
