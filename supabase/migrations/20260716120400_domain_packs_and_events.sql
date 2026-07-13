-- ============================================================================
-- Universal Intelligence Foundation — P6/P7/P8 DOMAIN PACKS · EVENTS · CONTROL
-- ============================================================================
-- Domain packs = DATA + generic extractors, never tenant/industry code (§11).
-- Event envelope hardened for automations/agents + simulation (§9). Control-plane
-- feature flags (§8). Outbox/dispatcher deferred (schema-ready).
-- ============================================================================

-- ── Domain packs ────────────────────────────────────────────────────────────
create table if not exists domain_packs (
  id           text primary key,             -- 'serviceos' | 'productos'
  display_name text not null,
  description  text,
  version_id   uuid references config_versions(id),
  enabled      boolean not null default true,
  created_at   timestamptz not null default now()
);

create table if not exists domain_entity_types (   -- graph node_types the pack introduces
  domain            text not null,
  node_type         text not null,               -- Job|Visit|Asset / Product|SKU|PurchaseOrder ...
  label             text not null,
  properties_schema jsonb not null default '{}',  -- JSON Schema for graph_nodes.properties
  is_high_integrity boolean not null default false, -- true ⇒ backed by a dedicated SoR table projected into the graph
  primary key (domain, node_type)
);

create table if not exists domain_terminology (    -- Business terminology (Part 1)
  id        uuid primary key default gen_random_uuid(),
  domain    text not null,
  tenant_id uuid references tenants(id) on delete cascade,   -- null = pack default
  term_key  text not null,
  label     text not null
);
-- A nullable column can't sit in a PRIMARY KEY, so uniqueness is enforced by two
-- partial indexes: one pack-default row per (domain, term_key) + per-tenant overrides.
create unique index if not exists domain_terminology_default_uk
  on domain_terminology (domain, term_key) where tenant_id is null;
create unique index if not exists domain_terminology_tenant_uk
  on domain_terminology (domain, term_key, tenant_id) where tenant_id is not null;

-- ── Per-tenant pack enablement (replaces the useModules TODO(openfolk)). ────
create table if not exists tenant_domain_packs (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  domain     text not null references domain_packs(id) on delete cascade,
  enabled    boolean not null default true,
  version_id uuid references config_versions(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, domain)
);

-- ── Event subscriptions (future automations/agents register here). ──────────
create table if not exists subscriptions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references tenants(id) on delete cascade,  -- null = platform subscriber
  event_type       text not null,
  handler_job_type text not null,               -- a WORKER_HANDLERS key
  enabled          boolean not null default true,
  version_id       uuid references config_versions(id),
  created_at       timestamptz not null default now()
);
create index if not exists subscriptions_by_event on subscriptions (event_type, enabled);
create unique index if not exists subscriptions_natural_uk on subscriptions (
  coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), event_type, handler_job_type
);

-- ── Control-plane feature flags (§8). ───────────────────────────────────────
create table if not exists feature_flags (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid references tenants(id) on delete cascade,  -- null = global default
  flag       text not null,
  value      jsonb not null,
  version_id uuid references config_versions(id),
  created_at timestamptz not null default now()
);
-- Nullable tenant_id: coalesce so a global (null) flag is unique per name too.
create unique index if not exists feature_flags_natural_uk on feature_flags (
  coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), flag
);

-- ── Harden the event envelope (adds actor / occurred_at / domain / trace). ──
-- Existing platform_events kept intact; these are additive, nullable columns.
alter table platform_events add column if not exists actor          jsonb;
alter table platform_events add column if not exists occurred_at    timestamptz;   -- real event time (vs published_at)
alter table platform_events add column if not exists domain         text;
alter table platform_events add column if not exists correlation_id uuid;          -- trace a causal chain

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Pack registries are non-secret platform metadata.
alter table domain_packs enable row level security;
drop policy if exists domain_packs_select on domain_packs;
create policy domain_packs_select on domain_packs for select to authenticated using (true);

alter table domain_entity_types enable row level security;
drop policy if exists det_select on domain_entity_types;
create policy det_select on domain_entity_types for select to authenticated using (true);

alter table domain_terminology enable row level security;
drop policy if exists dterm_select on domain_terminology;
create policy dterm_select on domain_terminology for select to authenticated
  using (tenant_id is null or tenant_id = current_tenant_id() or is_openfolk());

alter table tenant_domain_packs enable row level security;
drop policy if exists tdp_select on tenant_domain_packs;
create policy tdp_select on tenant_domain_packs for select to authenticated
  using (tenant_id = current_tenant_id() or is_openfolk());

alter table subscriptions enable row level security;
drop policy if exists subs_select on subscriptions;
create policy subs_select on subscriptions for select to authenticated
  using (tenant_id is null or tenant_id = current_tenant_id() or is_openfolk());

-- Feature flags: provider-managed; tenants may read their own + global.
alter table feature_flags enable row level security;
drop policy if exists ff_select on feature_flags;
create policy ff_select on feature_flags for select to authenticated
  using (tenant_id is null or tenant_id = current_tenant_id() or is_openfolk());
