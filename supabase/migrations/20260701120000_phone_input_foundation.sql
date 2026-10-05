-- ServiceOS — Phone Input (Simwood/Sipcentric) foundation — Phase Phone-0
--
-- Creates the tenant-scoped schema for the VoIP Phone Input module plus a
-- shared audit_logs table. No data sync happens yet; these are the tables the
-- later phases (call sync, recordings, transcription, AI insight) write into.
--
-- Security posture:
--   * Every tenant-owned table carries `tenant_id` and has Row Level Security
--     ENABLED with NO permissive policies yet -> denies all anon/authenticated
--     access by default. The Edge Functions use the service-role key, which
--     bypasses RLS. Tenant-scoped read policies land with the auth model.
--   * Credentials are NEVER stored here; Simwood secrets live in Supabase
--     secrets and are read server-side only.
--
-- `tenant_id` is a plain uuid (no FK) because a `tenants` table does not exist
-- yet; a FK can be added once tenancy is formalised.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- Auto-maintain updated_at on row updates.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- audit_logs  (create only if missing, per task)
-- ---------------------------------------------------------------------------
create table if not exists audit_logs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid,                          -- nullable: some system events are tenant-agnostic
  actor        text,                          -- who/what performed the action, e.g. "edge:simwood-test-connection"
  action       text not null,                 -- e.g. "simwood.test_connection"
  resource_type text,
  resource_id  text,
  status       text,                          -- "success" | "failed" | ...
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists audit_logs_tenant_id_idx on audit_logs (tenant_id);
create index if not exists audit_logs_created_at_idx on audit_logs (created_at);
create index if not exists audit_logs_action_idx on audit_logs (action);

alter table audit_logs enable row level security;

-- ---------------------------------------------------------------------------
-- phone_accounts  — one row per connected Simwood/Sipcentric account
-- ---------------------------------------------------------------------------
create table if not exists phone_accounts (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  provider             text not null default 'simwood',
  provider_customer_id text,                  -- resolved from GET /customers
  display_name         text,
  status               text not null default 'pending',  -- pending | active | error | disabled
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, provider, provider_customer_id)
);

create index if not exists phone_accounts_tenant_id_idx on phone_accounts (tenant_id);

create trigger phone_accounts_set_updated_at
  before update on phone_accounts
  for each row execute function set_updated_at();

alter table phone_accounts enable row level security;

-- ---------------------------------------------------------------------------
-- phone_endpoints  — extensions / numbers under an account
-- ---------------------------------------------------------------------------
create table if not exists phone_endpoints (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  account_id           uuid references phone_accounts (id) on delete cascade,
  provider             text not null default 'simwood',
  provider_endpoint_id text,
  endpoint_type        text,                  -- e.g. phone | did | user
  label                text,
  extension            text,
  e164_number          text,
  status               text,
  raw_payload          jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, provider, provider_endpoint_id)
);

create index if not exists phone_endpoints_tenant_id_idx on phone_endpoints (tenant_id);
create index if not exists phone_endpoints_account_id_idx on phone_endpoints (account_id);

create trigger phone_endpoints_set_updated_at
  before update on phone_endpoints
  for each row execute function set_updated_at();

alter table phone_endpoints enable row level security;

-- ---------------------------------------------------------------------------
-- phone_calls  — CDR mirror
-- ---------------------------------------------------------------------------
create table if not exists phone_calls (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  provider         text not null default 'simwood',
  provider_call_id text,                      -- API `callId`
  linked_id        text,                      -- API `linkedId` (groups multi-leg calls)
  direction        text,                      -- IN | OUT
  from_number      text,
  to_number        text,
  started_at       timestamptz,
  duration_seconds integer,
  outcome          text,
  cost             numeric(12, 4),
  raw_payload      jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, provider, provider_call_id)
);

create index if not exists phone_calls_tenant_id_idx on phone_calls (tenant_id);
create index if not exists phone_calls_linked_id_idx on phone_calls (tenant_id, linked_id);
create index if not exists phone_calls_started_at_idx on phone_calls (tenant_id, started_at);
create index if not exists phone_calls_from_number_idx on phone_calls (tenant_id, from_number);

create trigger phone_calls_set_updated_at
  before update on phone_calls
  for each row execute function set_updated_at();

alter table phone_calls enable row level security;

-- ---------------------------------------------------------------------------
-- phone_recordings  — recording metadata + storage pointer (no audio blobs)
-- ---------------------------------------------------------------------------
create table if not exists phone_recordings (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null,
  provider              text not null default 'simwood',
  provider_recording_id text,
  provider_call_id      text,                 -- links to phone_calls.provider_call_id
  linked_id             text,
  recording_uri         text,                 -- upstream API uri
  file_size             bigint,
  started_at            timestamptz,
  duration_seconds      integer,
  storage_path          text,                 -- object-storage key, null until downloaded
  raw_payload           jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tenant_id, provider, provider_recording_id)
);

create index if not exists phone_recordings_tenant_id_idx on phone_recordings (tenant_id);
create index if not exists phone_recordings_provider_call_id_idx on phone_recordings (tenant_id, provider_call_id);

create trigger phone_recordings_set_updated_at
  before update on phone_recordings
  for each row execute function set_updated_at();

alter table phone_recordings enable row level security;

-- ---------------------------------------------------------------------------
-- phone_transcripts  — one transcript per recording
-- ---------------------------------------------------------------------------
create table if not exists phone_transcripts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  recording_id    uuid references phone_recordings (id) on delete cascade,
  transcript_text text,
  language        text,
  status          text not null default 'pending',  -- pending | processing | completed | failed
  model           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists phone_transcripts_tenant_id_idx on phone_transcripts (tenant_id);
create index if not exists phone_transcripts_recording_id_idx on phone_transcripts (recording_id);

create trigger phone_transcripts_set_updated_at
  before update on phone_transcripts
  for each row execute function set_updated_at();

alter table phone_transcripts enable row level security;

-- ---------------------------------------------------------------------------
-- phone_ai_insights  — advisory AI enrichment per call/recording
-- ---------------------------------------------------------------------------
create table if not exists phone_ai_insights (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  call_id         uuid references phone_calls (id) on delete cascade,
  recording_id    uuid references phone_recordings (id) on delete cascade,
  intent          text,
  urgency         text,
  sentiment       text,
  summary         text,
  action_required boolean,
  suggested_owner text,
  confidence      numeric(5, 4),
  raw_payload     jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists phone_ai_insights_tenant_id_idx on phone_ai_insights (tenant_id);
create index if not exists phone_ai_insights_call_id_idx on phone_ai_insights (call_id);
create index if not exists phone_ai_insights_recording_id_idx on phone_ai_insights (recording_id);

create trigger phone_ai_insights_set_updated_at
  before update on phone_ai_insights
  for each row execute function set_updated_at();

alter table phone_ai_insights enable row level security;

-- ---------------------------------------------------------------------------
-- phone_sync_runs  — observability / audit of every sync + connection test
-- ---------------------------------------------------------------------------
create table if not exists phone_sync_runs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  provider          text not null default 'simwood',
  sync_type         text not null,            -- test_connection | calls | recordings | transcripts | insights
  status            text not null default 'running',  -- running | success | failed
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  records_processed integer not null default 0,
  error_message     text,
  metadata          jsonb not null default '{}'::jsonb
);

create index if not exists phone_sync_runs_tenant_id_idx on phone_sync_runs (tenant_id);
create index if not exists phone_sync_runs_type_status_idx on phone_sync_runs (tenant_id, sync_type, status);
create index if not exists phone_sync_runs_started_at_idx on phone_sync_runs (started_at);

alter table phone_sync_runs enable row level security;
