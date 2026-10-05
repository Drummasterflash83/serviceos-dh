-- Intelligence Nervous System — system health / ingestion reliability layer.
--
-- A UNIFIED current-state rollup of sensor health per tenant, complementing the existing
-- per-run ledgers (phone_sync_runs, email_sync_runs, platform_jobs) and pull-only health
-- RPCs (phone_pipeline_health, email_connector_health). This is the single "can I trust my
-- AI today?" surface: one row per (tenant, component), continuously emitted by the pipeline
-- and read by the Command Centre. Additive + idempotent; nothing is seeded for a real tenant.
--
-- NOTE (audit finding this makes visible): `intelligence.ingest_interaction` is registered
-- but never enqueued (deferred in 20260724120000), so calls/emails never become
-- intelligence_objects. Once emission is wired, `intelligence_processing` will show as
-- never-healthy for tenants — the reliability layer surfaces the severed nerve rather than
-- hiding it. Wiring the bridge is a separate, deliberate change.

-- 1) Canonical component registry (the 8 sensors + human labels).
create table if not exists system_health_components (
  component   text primary key,
  label       text not null,
  category    text not null, -- session | ingestion | intelligence | automation
  sort_order  int  not null default 100
);
insert into system_health_components (component, label, category, sort_order) values
  ('auth',                    'Authentication',       'session',      10),
  ('tenant_context',          'Tenant context',       'session',      20),
  ('phone_ingestion',         'Calls',                'ingestion',    30),
  ('recording_extraction',    'Recording extraction', 'ingestion',    40),
  ('transcription',           'Transcription',        'ingestion',    50),
  ('email_sync',              'Email',                'ingestion',    60),
  ('intelligence_processing', 'Intelligence',         'intelligence', 70),
  ('automation_execution',    'Automation',           'automation',   80)
on conflict (component) do nothing;

-- 2) Current-state health per tenant + component (the "real health object").
create table if not exists system_health_checks (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  component       text not null references system_health_components(component),
  status          text not null default 'unknown'
                    check (status in ('healthy','degraded','failed','unknown')),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count   int not null default 0, -- consecutive failures since the last success
  last_error      text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, component)
);
create index if not exists shc_tenant on system_health_checks (tenant_id, component);

-- 3) RLS — tenant read + OpenFolk provider read; writes are service-role via the RPC.
alter table system_health_components enable row level security;
drop policy if exists shc_components_select on system_health_components;
create policy shc_components_select on system_health_components
  for select to authenticated using (true);

alter table system_health_checks enable row level security;
drop policy if exists shc_select on system_health_checks;
create policy shc_select on system_health_checks
  for select to authenticated using (tenant_id = current_tenant_id() or is_openfolk());

-- 4) Emit — atomic upsert of a component's current health. `healthy` clears the failure
-- state and stamps last_success_at; `degraded`/`failed` increments the consecutive-failure
-- counter, records the error and stamps last_failure_at. Idempotent per (tenant, component).
create or replace function serviceos_record_health_check(
  p_tenant    uuid,
  p_component text,
  p_status    text,
  p_error     text  default null,
  p_metadata  jsonb default '{}'::jsonb
) returns void language plpgsql as $$
begin
  if p_status not in ('healthy','degraded','failed','unknown') then
    raise exception 'invalid health status %', p_status using errcode = 'check_violation';
  end if;
  insert into system_health_checks as h
    (tenant_id, component, status, last_success_at, last_failure_at, failure_count, last_error, metadata, updated_at)
  values (
    p_tenant, p_component, p_status,
    case when p_status = 'healthy' then now() end,
    case when p_status in ('degraded','failed') then now() end,
    case when p_status in ('degraded','failed') then 1 else 0 end,
    case when p_status in ('degraded','failed') then p_error end,
    coalesce(p_metadata, '{}'::jsonb), now()
  )
  on conflict (tenant_id, component) do update set
    status          = excluded.status,
    last_success_at = case when p_status = 'healthy' then now() else h.last_success_at end,
    last_failure_at = case when p_status in ('degraded','failed') then now() else h.last_failure_at end,
    failure_count   = case
                        when p_status = 'healthy' then 0
                        when p_status in ('degraded','failed') then h.failure_count + 1
                        else h.failure_count
                      end,
    last_error      = case
                        when p_status in ('degraded','failed') then p_error
                        when p_status = 'healthy' then null
                        else h.last_error
                      end,
    metadata        = coalesce(p_metadata, '{}'::jsonb),
    updated_at      = now();
end $$;

revoke all on function serviceos_record_health_check(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function serviceos_record_health_check(uuid, text, text, text, jsonb)
  to service_role;
