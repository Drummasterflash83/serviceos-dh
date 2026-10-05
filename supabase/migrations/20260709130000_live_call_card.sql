-- ServiceOS — Live Call Card v1 (real-time operational surface).
--
-- When an inbound call rings on a VoIP extension, ServiceOS surfaces a live card
-- to ONLY the logged-in user mapped to that extension. This migration adds the
-- data foundation (additive, non-destructive):
--   • user_voice_endpoints — maps a user ↔ VoIP extension (Mary → 102)
--   • live_call_events     — every raw webhook event
--   • live_call_sessions   — one row per live call, assigned to a user, with
--                            evidence-led match state + a provider-agnostic
--                            `context` model (Commusoft-ready: related_jobs/sites/
--                            assets/tasks/notes/documents/financials — empty in v1)
--
-- RLS: tenant-scoped SELECT for authenticated users; NO write policies (the
-- secret-gated webhook + service-role management functions own writes). Per-user
-- visibility of live calls is applied by the frontend query (assigned_user_id =
-- current user); RLS guarantees tenant isolation. Reuses set_updated_at() +
-- current_tenant_id().

-- ---------------------------------------------------------------------------
-- user_voice_endpoints — user ↔ extension mapping
-- ---------------------------------------------------------------------------
create table if not exists user_voice_endpoints (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  user_id      uuid not null,
  provider     text not null default 'simwood',
  extension    text not null,
  display_name text,
  enabled      boolean not null default true,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, provider, extension),
  unique (tenant_id, user_id, provider, extension)
);
create index if not exists user_voice_endpoints_tenant_idx on user_voice_endpoints (tenant_id);
create index if not exists user_voice_endpoints_tenant_user_idx
  on user_voice_endpoints (tenant_id, user_id);

drop trigger if exists user_voice_endpoints_set_updated_at on user_voice_endpoints;
create trigger user_voice_endpoints_set_updated_at
  before update on user_voice_endpoints for each row execute function set_updated_at();
alter table user_voice_endpoints enable row level security;

-- ---------------------------------------------------------------------------
-- live_call_events — every normalised webhook event (audit + replay)
-- event_type: initiated | ringing | answered | completed | missed | failed
-- ---------------------------------------------------------------------------
create table if not exists live_call_events (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  provider         text not null,
  provider_call_id text,
  event_type       text not null,
  caller_number    text,
  callee_number    text,
  extension        text,
  direction        text,
  occurred_at      timestamptz not null default now(),
  raw_payload      jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists live_call_events_tenant_occurred_idx
  on live_call_events (tenant_id, occurred_at desc);
create index if not exists live_call_events_tenant_call_idx
  on live_call_events (tenant_id, provider_call_id);
create index if not exists live_call_events_tenant_ext_idx
  on live_call_events (tenant_id, extension, occurred_at desc);
alter table live_call_events enable row level security;

-- ---------------------------------------------------------------------------
-- live_call_sessions — one live call, assigned to a user
-- status:       ringing | answered | completed | missed | failed
-- match_status: unmatched | possible | likely | confirmed | rejected
-- context (provider-agnostic; Commusoft/other job systems fill later):
--   { related_jobs:[], related_sites:[], related_assets:[], related_tasks:[],
--     related_notes:[], related_documents:[], related_financials:[] }
-- ---------------------------------------------------------------------------
create table if not exists live_call_sessions (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  provider          text not null,
  provider_call_id  text not null,
  caller_number     text,
  callee_number     text,
  extension         text,
  direction         text,
  assigned_user_id  uuid,
  status            text not null default 'ringing',
  started_at        timestamptz not null default now(),
  answered_at       timestamptz,
  completed_at      timestamptz,
  latest_event_at   timestamptz not null default now(),
  dismissed_at      timestamptz,
  match_status      text not null default 'unmatched',
  matched_person_id uuid,
  matched_company_id uuid,
  matched_job_id    uuid,
  confidence        numeric,
  evidence          jsonb not null default '[]'::jsonb,
  context           jsonb not null default '{}'::jsonb,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, provider, provider_call_id)
);
create index if not exists live_call_sessions_tenant_user_idx
  on live_call_sessions (tenant_id, assigned_user_id, latest_event_at desc);
create index if not exists live_call_sessions_tenant_status_idx
  on live_call_sessions (tenant_id, status, latest_event_at desc);
create index if not exists live_call_sessions_tenant_caller_idx
  on live_call_sessions (tenant_id, caller_number);
create index if not exists live_call_sessions_tenant_ext_idx
  on live_call_sessions (tenant_id, extension);

drop trigger if exists live_call_sessions_set_updated_at on live_call_sessions;
create trigger live_call_sessions_set_updated_at
  before update on live_call_sessions for each row execute function set_updated_at();
alter table live_call_sessions enable row level security;

-- ---------------------------------------------------------------------------
-- Tenant-scoped SELECT policies (read-only). Writes are secret-gated webhook /
-- service-role management functions. Per-user live-call filtering is applied by
-- the frontend query; RLS guarantees no cross-tenant leakage.
-- ---------------------------------------------------------------------------
drop policy if exists user_voice_endpoints_select_tenant on user_voice_endpoints;
create policy user_voice_endpoints_select_tenant on user_voice_endpoints
  for select to authenticated using (tenant_id = current_tenant_id());

drop policy if exists live_call_events_select_tenant on live_call_events;
create policy live_call_events_select_tenant on live_call_events
  for select to authenticated using (tenant_id = current_tenant_id());

drop policy if exists live_call_sessions_select_tenant on live_call_sessions;
create policy live_call_sessions_select_tenant on live_call_sessions
  for select to authenticated using (tenant_id = current_tenant_id());

-- Realtime: let the browser subscribe to live session changes (RLS still applies).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table live_call_sessions';
  end if;
exception
  when duplicate_object then null; -- already in the publication
end $$;
