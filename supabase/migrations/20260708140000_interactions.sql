-- ServiceOS — Canonical Interactions v1 (the business timeline foundation).
--
-- One shared, connector-agnostic row per communication event. Phone calls, emails
-- and (later) Slack / Teams / forms / WhatsApp all project into this single table
-- so the customer timeline, CRM, missed-response detection and journey automation
-- have ONE place to read from — instead of a silo per connector.
--
-- v1 is TRACKING only: rows are projected from the existing source tables by the
-- `interactions-sync` Edge Function (service role). The source tables are the
-- system of record and are NEVER modified or deleted; interactions references them
-- by (source_table, source_id). Non-destructive & idempotent.
--
-- RLS: tenant-scoped SELECT for authenticated users; NO write policies (service
-- role Edge Functions own all writes). Reuses set_updated_at() + current_tenant_id().

create table if not exists interactions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,

  -- Provenance — the source-of-record row this interaction projects from.
  source_connector_id text not null,                 -- simwood | google-workspace | gmail | email | …
  source_type         text not null,                 -- phone | email | chat | form | …
  source_table        text not null,                 -- phone_calls | email_messages | …
  source_id           uuid not null,                 -- PK in source_table
  source_external_id  text,                           -- provider id (call/message id)

  interaction_type    text not null,                 -- phone_call | email_message | form_submission | …
  direction           text,                           -- inbound | outbound | internal | unknown

  occurred_at         timestamptz not null,
  subject             text,
  summary             text,
  body_preview        text,

  from_address        text,
  from_name           text,
  to_addresses        text[] not null default '{}',
  cc_addresses        text[] not null default '{}',

  phone_from          text,
  phone_to            text,

  status              text not null default 'active',
  processing_status   text not null default 'pending', -- pending | analysed | …
  sentiment           text,
  priority            text,

  -- Future canonical links (People/Companies/Jobs/Tasks/Journeys) — nullable in v1.
  related_person_id   uuid,
  related_company_id  uuid,
  related_thread_id   text,
  related_job_id      uuid,
  related_task_id     uuid,

  metadata            jsonb not null default '{}'::jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- One canonical interaction per source row → idempotent upsert key.
  unique (tenant_id, source_table, source_id)
);

create index if not exists interactions_tenant_occurred_idx
  on interactions (tenant_id, occurred_at desc);
create index if not exists interactions_tenant_type_occurred_idx
  on interactions (tenant_id, interaction_type, occurred_at desc);
create index if not exists interactions_tenant_connector_occurred_idx
  on interactions (tenant_id, source_connector_id, occurred_at desc);
create index if not exists interactions_tenant_processing_idx
  on interactions (tenant_id, processing_status);
create index if not exists interactions_tenant_person_idx
  on interactions (tenant_id, related_person_id);
create index if not exists interactions_tenant_company_idx
  on interactions (tenant_id, related_company_id);

drop trigger if exists interactions_set_updated_at on interactions;
create trigger interactions_set_updated_at
  before update on interactions
  for each row execute function set_updated_at();

alter table interactions enable row level security;

-- Tenant-scoped SELECT only. Writes are service-role via Edge Functions.
drop policy if exists interactions_select_tenant on interactions;
create policy interactions_select_tenant on interactions
  for select to authenticated using (tenant_id = current_tenant_id());
