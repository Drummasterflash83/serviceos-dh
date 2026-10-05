-- ServiceOS — Email Input Phase-0: Gmail ingestion foundation.
--
-- Schema + tenant-scoped RLS for email as the second communications input.
-- Mirrors the phone_* model: SELECT-only RLS scoped to the caller's tenant,
-- NO frontend write policies (service role writes only), no anon reads.
--
-- Phase-0 is schema/shape only — no OAuth, no Gmail API, no data. Reuses
-- set_updated_at() (Phone-0) and current_tenant_id() (Security-2). Idempotent.

-- ---------------------------------------------------------------------------
-- email_accounts — one connected mailbox per tenant/provider
-- ---------------------------------------------------------------------------
create table if not exists email_accounts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  provider      text not null default 'gmail',
  email_address text,
  display_name  text,
  status        text not null default 'pending', -- pending | active | error | disabled
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, provider, email_address)
);

create index if not exists email_accounts_tenant_id_idx on email_accounts (tenant_id);

drop trigger if exists email_accounts_set_updated_at on email_accounts;
create trigger email_accounts_set_updated_at
  before update on email_accounts
  for each row execute function set_updated_at();

alter table email_accounts enable row level security;

-- ---------------------------------------------------------------------------
-- email_threads — conversation grouping
-- ---------------------------------------------------------------------------
create table if not exists email_threads (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  provider           text not null default 'gmail',
  provider_thread_id text,
  subject            text,
  participants       jsonb not null default '[]'::jsonb,
  last_message_at    timestamptz,
  raw_payload        jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, provider, provider_thread_id)
);

create index if not exists email_threads_tenant_id_idx on email_threads (tenant_id);
create index if not exists email_threads_feed_idx on email_threads (tenant_id, last_message_at desc);

drop trigger if exists email_threads_set_updated_at on email_threads;
create trigger email_threads_set_updated_at
  before update on email_threads
  for each row execute function set_updated_at();

alter table email_threads enable row level security;

-- ---------------------------------------------------------------------------
-- email_messages — individual messages
-- ---------------------------------------------------------------------------
create table if not exists email_messages (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  provider            text not null default 'gmail',
  provider_message_id text,
  provider_thread_id  text,           -- links to email_threads.provider_thread_id
  from_email          text,
  from_name           text,
  to_emails           jsonb not null default '[]'::jsonb,
  cc_emails           jsonb not null default '[]'::jsonb,
  subject             text,
  snippet             text,
  body_text           text,
  body_html           text,
  sent_at             timestamptz,
  received_at         timestamptz,
  direction           text,           -- inbound | outbound
  raw_payload         jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, provider, provider_message_id)
);

create index if not exists email_messages_tenant_id_idx on email_messages (tenant_id);
create index if not exists email_messages_received_idx on email_messages (tenant_id, received_at desc);
create index if not exists email_messages_from_idx on email_messages (tenant_id, from_email);
create index if not exists email_messages_thread_idx on email_messages (tenant_id, provider_thread_id);

drop trigger if exists email_messages_set_updated_at on email_messages;
create trigger email_messages_set_updated_at
  before update on email_messages
  for each row execute function set_updated_at();

alter table email_messages enable row level security;

-- ---------------------------------------------------------------------------
-- email_attachments — attachment metadata + storage pointer
-- ---------------------------------------------------------------------------
create table if not exists email_attachments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  message_id   uuid references email_messages (id) on delete cascade,
  filename     text,
  mime_type    text,
  size_bytes   bigint,
  storage_path text,                  -- null until downloaded (no audio/blob in DB)
  created_at   timestamptz not null default now()
);

create index if not exists email_attachments_tenant_id_idx on email_attachments (tenant_id);
create index if not exists email_attachments_message_idx on email_attachments (message_id);

alter table email_attachments enable row level security;

-- ---------------------------------------------------------------------------
-- email_ai_insights — advisory AI enrichment (per message and/or thread)
-- ---------------------------------------------------------------------------
create table if not exists email_ai_insights (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  message_id      uuid references email_messages (id) on delete cascade,
  thread_id       uuid references email_threads (id) on delete cascade,
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

create index if not exists email_ai_insights_tenant_id_idx on email_ai_insights (tenant_id);
create index if not exists email_ai_insights_message_idx on email_ai_insights (tenant_id, message_id);
create index if not exists email_ai_insights_thread_idx on email_ai_insights (tenant_id, thread_id);

drop trigger if exists email_ai_insights_set_updated_at on email_ai_insights;
create trigger email_ai_insights_set_updated_at
  before update on email_ai_insights
  for each row execute function set_updated_at();

alter table email_ai_insights enable row level security;

-- ---------------------------------------------------------------------------
-- email_sync_runs — observability / audit of sync + analysis runs
-- ---------------------------------------------------------------------------
create table if not exists email_sync_runs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  provider          text not null default 'gmail',
  sync_type         text not null,   -- oauth | messages | threads | ai_analysis | attachment_download
  status            text not null default 'running', -- running | success | failed
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  records_processed integer not null default 0,
  error_message     text,
  metadata          jsonb not null default '{}'::jsonb
);

create index if not exists email_sync_runs_tenant_id_idx on email_sync_runs (tenant_id);
create index if not exists email_sync_runs_type_status_idx on email_sync_runs (tenant_id, sync_type, status);

alter table email_sync_runs enable row level security;

-- ---------------------------------------------------------------------------
-- Tenant-scoped SELECT policies (read-only; no write policies → service role
-- only). Reuses current_tenant_id() from the Security-2 migration.
-- ---------------------------------------------------------------------------
drop policy if exists email_accounts_select_tenant on email_accounts;
create policy email_accounts_select_tenant on email_accounts
  for select to authenticated using (tenant_id = current_tenant_id());

drop policy if exists email_threads_select_tenant on email_threads;
create policy email_threads_select_tenant on email_threads
  for select to authenticated using (tenant_id = current_tenant_id());

drop policy if exists email_messages_select_tenant on email_messages;
create policy email_messages_select_tenant on email_messages
  for select to authenticated using (tenant_id = current_tenant_id());

drop policy if exists email_attachments_select_tenant on email_attachments;
create policy email_attachments_select_tenant on email_attachments
  for select to authenticated using (tenant_id = current_tenant_id());

drop policy if exists email_ai_insights_select_tenant on email_ai_insights;
create policy email_ai_insights_select_tenant on email_ai_insights
  for select to authenticated using (tenant_id = current_tenant_id());

drop policy if exists email_sync_runs_select_tenant on email_sync_runs;
create policy email_sync_runs_select_tenant on email_sync_runs
  for select to authenticated using (tenant_id = current_tenant_id());
