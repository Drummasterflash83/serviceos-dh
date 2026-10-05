-- ServiceOS — Intelligence Ingestion Ledger (the interaction → observe bridge seam).
--
-- A narrow, durable lineage/idempotency ledger for the channel-neutral bridge that maps
-- an enriched canonical `interactions` row into the existing `intelligence.observe`
-- pipeline. `interactions` is the UNIVERSAL inbound boundary (phone/email/chat/form all
-- project into it), so this seam is channel-agnostic — no connector- or customer-specific
-- columns exist here.
--
-- IDEMPOTENCY / CONCURRENCY: the unique (tenant_id, interaction_id, mapper_version) is an
-- ATOMIC single-writer claim — exactly one worker wins the insert; concurrent/retry
-- workers observe the conflict and REUSE the existing row. Combined with the deterministic
-- observe job key (queue active-key dedup) this yields at-most-one logical Observation per
-- interaction per mapper version. Bumping mapper_version legitimately allows a new logical
-- Observation (a re-mapping), never a silent duplicate.
--
-- This migration ONLY creates a tracking table — it changes no engine, guard, worker,
-- execution model or existing table. Non-destructive & idempotent. Scheduling/backfill is
-- deliberately deferred (Step 1b) until the bridge is proven; nothing here enqueues.
--
-- RLS: tenant-scoped SELECT for authenticated users; NO write policies (service-role Edge
-- Functions own all writes, bypassing RLS). Reuses set_updated_at() + current_tenant_id().

create table if not exists intelligence_ingestions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  interaction_id uuid not null references interactions(id) on delete cascade,

  -- The mapper version is part of the identity: one interaction → one logical
  -- Observation PER mapper version (a bump is an intentional re-mapping).
  mapper_version text not null,
  ingest_key     text not null,                 -- deterministic ingest:{tenant}:{interaction}:{mapper}
  domain         text,                          -- horizontal domain pack used for evaluation

  -- Lineage (backfilled after the atomic claim; the claim is what's authoritative).
  observe_job_id uuid references platform_jobs(id),
  observation_id uuid,                           -- soft ref intelligence_objects.id (set later)
  correlation_id uuid,
  status         text not null default 'enqueued', -- enqueued | observed | failed

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- ATOMIC CLAIM: at most one ingestion per (tenant, interaction, mapper version).
  unique (tenant_id, interaction_id, mapper_version)
);

-- Deterministic-key lookups + per-interaction lineage.
create unique index if not exists intelligence_ingestions_ingest_key_uk
  on intelligence_ingestions (tenant_id, ingest_key);
create index if not exists intelligence_ingestions_interaction_idx
  on intelligence_ingestions (tenant_id, interaction_id, created_at desc);
create index if not exists intelligence_ingestions_job_idx
  on intelligence_ingestions (tenant_id, observe_job_id);

drop trigger if exists intelligence_ingestions_set_updated_at on intelligence_ingestions;
create trigger intelligence_ingestions_set_updated_at
  before update on intelligence_ingestions
  for each row execute function set_updated_at();

alter table intelligence_ingestions enable row level security;

-- Tenant-scoped SELECT only. Writes are service-role via Edge Functions.
drop policy if exists intelligence_ingestions_select_tenant on intelligence_ingestions;
create policy intelligence_ingestions_select_tenant on intelligence_ingestions
  for select to authenticated using (tenant_id = current_tenant_id());
