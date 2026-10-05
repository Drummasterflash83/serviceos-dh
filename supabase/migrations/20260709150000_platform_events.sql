-- ServiceOS — Platform Events v1 (the event-bus seed).
--
-- ServiceOS is evolving from a set of features into an event-driven operating
-- system. Every connector (phone, email, and later Slack / WhatsApp / forms /
-- Commusoft / calendar) does the same thing: it produces a canonical
-- `interactions` row, marks it READY, and PUBLISHES an event. From that point on
-- enrichment is event-driven — independent workers (Identity Engine, Customer
-- Card Engine, Recommendation Engine, Business Graph, Search Index, …) subscribe
-- to the event and each runs, retries and reports independently. A producing
-- pipeline therefore NEVER grows a dependency on a downstream engine.
--
-- `platform_events` is that bus, expressed as a durable, queryable append log
-- (there is no dispatcher engine yet — subscribers poll by (event_type, status)).
-- It is the exact analogue of `platform_jobs`: TRACKING + VISIBILITY first, so the
-- architecture is real and observable today and a real dispatcher can be added
-- later without a rewrite. Non-destructive & idempotent.
--
-- RLS: tenant-scoped SELECT for authenticated users; NO write policies (service
-- role Edge Functions own all writes, bypassing RLS). Reuses set_updated_at()
-- (Phone-0) and current_tenant_id() (Security-2).

create table if not exists platform_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  event_type   text not null,                    -- e.g. interaction.ready
  subject_type text not null,                    -- e.g. interaction
  subject_id   uuid not null,                    -- PK of the subject (e.g. interactions.id)
  source       text,                             -- publisher, e.g. phone-process-pipeline (nullable)
  status       text not null default 'pending',  -- pending | consumed | dead
  attempts     int not null default 0,
  payload      jsonb not null default '{}'::jsonb,
  metadata     jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  consumed_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists platform_events_tenant_type_status_idx
  on platform_events (tenant_id, event_type, status, published_at desc);
create index if not exists platform_events_tenant_subject_idx
  on platform_events (tenant_id, subject_type, subject_id);

-- At most one PENDING event per (tenant, event_type, subject) so re-running a
-- producer (idempotent pipelines are re-run freely) never stacks duplicate
-- unconsumed events. The shared publisher relies on this to no-op cleanly.
create unique index if not exists platform_events_pending_subject_uk
  on platform_events (tenant_id, event_type, subject_id)
  where status = 'pending';

drop trigger if exists platform_events_set_updated_at on platform_events;
create trigger platform_events_set_updated_at
  before update on platform_events
  for each row execute function set_updated_at();

alter table platform_events enable row level security;

-- Tenant-scoped SELECT only. Writes are service-role via Edge Functions.
drop policy if exists platform_events_select_tenant on platform_events;
create policy platform_events_select_tenant on platform_events
  for select to authenticated using (tenant_id = current_tenant_id());

-- Document the canonical interaction lifecycle now that phone analysis publishes
-- interaction.ready. The column stays free-text (no CHECK) so connectors can add
-- states without a migration, but the intended vocabulary is:
--   pending  → projected, not yet fully processed (awaiting transcript/AI, etc.)
--   ready    → fully processed at source (AI analysis done); interaction.ready
--              published; awaiting downstream enrichment subscribers
--   enriched → identity/customer-card enrichment complete (terminal)
-- ('analysed' is the pre-events synonym for 'ready' and is still accepted.)
comment on column interactions.processing_status is
  'Canonical interaction lifecycle: pending → ready → enriched. See platform_events (interaction.ready).';
