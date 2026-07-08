-- ServiceOS — Platform Connector Config (Phase: Operational Truth).
--
-- Introduces per-tenant connector configuration so provider identity (e.g. the
-- Simwood customer id) and durable sync cursors live in the DATABASE, not in
-- hardcoded constants inside Edge Functions. This is what lets the scheduled
-- phone sync become tenant-aware and cursor-based (no missed calls on a skipped
-- cron tick), replacing the previous fixed tenant + fixed 10-minute window.
--
-- Non-destructive & idempotent: creates two new tables and (in an isolated,
-- clearly-marked block) seeds ONLY the existing Drummond tenant's Simwood
-- connector from the previously-hardcoded values. No existing table or row is
-- altered or dropped.
--
-- RLS follows the established codebase pattern (cf. google_workspace_*): a
-- tenant-scoped SELECT policy for authenticated users, and NO write policies —
-- all writes go through service-role Edge Functions, which bypass RLS. Reuses
-- set_updated_at() (Phone-0) and current_tenant_id() (Security-2).

-- ---------------------------------------------------------------------------
-- tenant_connectors — one row per (tenant, connector). The connector's enabled
-- flag, rolled-up status/health and last sync watermarks live here.
-- ---------------------------------------------------------------------------
create table if not exists tenant_connectors (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null,
  connector_id            text not null,                       -- e.g. simwood | gmail | google_workspace
  provider                text not null,                       -- e.g. simwood | google
  category                text not null,                       -- e.g. communications
  status                  text not null default 'disabled',    -- disabled | active | error | ...
  health_status           text not null default 'unknown',     -- unknown | healthy | warning | critical
  enabled                 boolean not null default false,
  settings                jsonb not null default '{}'::jsonb,
  last_successful_sync_at timestamptz,
  last_failed_sync_at     timestamptz,
  last_error              text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (tenant_id, connector_id)
);

create index if not exists tenant_connectors_tenant_id_idx on tenant_connectors (tenant_id);

drop trigger if exists tenant_connectors_set_updated_at on tenant_connectors;
create trigger tenant_connectors_set_updated_at
  before update on tenant_connectors
  for each row execute function set_updated_at();

alter table tenant_connectors enable row level security;

-- ---------------------------------------------------------------------------
-- connector_accounts — one row per account/mailbox/customer under a connector.
-- `settings` holds provider identity (e.g. provider_customer_id); `sync_cursor`
-- holds the durable watermark (e.g. { "last_synced_until": "<iso>" }).
-- ---------------------------------------------------------------------------
create table if not exists connector_accounts (
  id                      uuid primary key default gen_random_uuid(),
  tenant_connector_id     uuid not null references tenant_connectors (id) on delete cascade,
  tenant_id               uuid not null,
  account_key             text not null,                       -- stable provider id, e.g. Simwood customer id
  display_name            text,
  status                  text not null default 'active',      -- active | disabled | error
  settings                jsonb not null default '{}'::jsonb,
  sync_cursor             jsonb not null default '{}'::jsonb,
  last_successful_sync_at timestamptz,
  last_failed_sync_at     timestamptz,
  last_error              text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (tenant_connector_id, account_key)
);

create index if not exists connector_accounts_tenant_id_idx on connector_accounts (tenant_id);
create index if not exists connector_accounts_tenant_connector_idx
  on connector_accounts (tenant_connector_id);

drop trigger if exists connector_accounts_set_updated_at on connector_accounts;
create trigger connector_accounts_set_updated_at
  before update on connector_accounts
  for each row execute function set_updated_at();

alter table connector_accounts enable row level security;

-- ---------------------------------------------------------------------------
-- Tenant-scoped SELECT policies (read-only). Owner/admin/ops "manage" these via
-- service-role Edge Functions (which bypass RLS), consistent with every other
-- connector table in this schema — no direct client writes, no cross-tenant leak.
-- ---------------------------------------------------------------------------
drop policy if exists tenant_connectors_select_tenant on tenant_connectors;
create policy tenant_connectors_select_tenant on tenant_connectors
  for select to authenticated using (tenant_id = current_tenant_id());

drop policy if exists connector_accounts_select_tenant on connector_accounts;
create policy connector_accounts_select_tenant on connector_accounts
  for select to authenticated using (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- ENVIRONMENT SEED (isolated, idempotent) — the existing Drummond tenant's
-- Simwood connector. This moves the previously-hardcoded customer id (3950) out
-- of code and into connector config. Touches ONLY this one tenant/connector and
-- is safe to re-run.
--
-- TODO(onboarding): replace this seed with an admin-driven connector onboarding
-- flow so no tenant id is hardcoded anywhere.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tenant uuid := '00000000-0000-0000-0000-000000000001';
  v_tc_id  uuid;
begin
  insert into tenant_connectors
    (tenant_id, connector_id, provider, category, status, health_status, enabled)
  values
    (v_tenant, 'simwood', 'simwood', 'communications', 'active', 'unknown', true)
  on conflict (tenant_id, connector_id) do update
    set provider = excluded.provider,
        category = excluded.category,
        enabled  = true,
        updated_at = now()
  returning id into v_tc_id;

  insert into connector_accounts
    (tenant_connector_id, tenant_id, account_key, display_name, status, settings)
  values
    (v_tc_id, v_tenant, '3950', 'Simwood 3950', 'active',
     jsonb_build_object('provider_customer_id', '3950'))
  on conflict (tenant_connector_id, account_key) do update
    set status   = 'active',
        settings = connector_accounts.settings
                   || jsonb_build_object('provider_customer_id', '3950'),
        updated_at = now();
end $$;
