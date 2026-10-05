-- ServiceOS — Telephony provider onboarding + canonical inventory (additive).
--
-- Makes connecting a company's phone system a resumable configuration workflow rather
-- than an engineering project. Two additive, tenant-scoped tables:
--   telephony_onboarding — one resumable onboarding record per (tenant, provider)
--   telephony_inventory  — canonical discovered objects (endpoints/trunks/DDIs/…)
-- Provider-neutral: adapters translate provider objects into these canonical rows.
-- No credentials/secrets are stored here (connection_ref is an opaque, masked handle;
-- secrets live in Edge Function secrets / Vault). RLS: tenant SELECT for authenticated;
-- writes are service-role. Idempotent & non-destructive.
--
-- ROLLBACK:
--   drop table if exists telephony_inventory;
--   drop table if exists telephony_onboarding;

-- ── Resumable onboarding state ──────────────────────────────────────────────
create table if not exists telephony_onboarding (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  provider            text not null,                 -- adapter key: sipcentric|mock|…
  stage               text not null default 'provider_selected',
    -- provider_selected|connection_configured|connection_verified|inventory_discovered
    -- |inventory_imported|mappings_reviewed|behaviour_configured|test_call_verified|complete
  stage_status        text not null default 'in_progress', -- in_progress|blocked|done|error
  completion_pct      int not null default 0,
  connection_ref      text,                          -- opaque/masked handle, NEVER a secret
  discovered_count    int not null default 0,
  imported_count      int not null default 0,
  confirmed_mappings  int not null default 0,
  unresolved_mappings int not null default 0,
  blockers            jsonb not null default '[]'::jsonb,
  last_error          text,
  last_success_action text,
  accepted_gaps       boolean not null default false, -- completed with unresolved items
  started_by          uuid,
  updated_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists telephony_onboarding_tenant_provider_uk
  on telephony_onboarding (tenant_id, provider);

-- ── Canonical telephony inventory (discovered objects) ──────────────────────
create table if not exists telephony_inventory (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  provider           text not null,
  provider_object_id text not null,                  -- provider's id/URI (opaque)
  canonical_type     text not null,
    -- provider_account|trunk|ddi|sip_identity|endpoint|extension|device|user
    -- |ring_group|hunt_group|queue|pickup_group|voicemail_route|transfer_route
  label              text,
  parent_object_id   text,
  status             text not null default 'active',  -- active|inactive
  discovery_source   text not null default 'call_metadata',
  provisioning_state text not null default 'discovered', -- discovered|configured|manual
  confidence         numeric not null default 1.0,
  capabilities       jsonb not null default '{}'::jsonb,
  provider_metadata  jsonb not null default '{}'::jsonb, -- safe reference only, no secrets
  first_seen         timestamptz not null default now(),
  last_seen          timestamptz not null default now(),
  synced_at          timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- Idempotent discovery: one row per (tenant, provider, provider_object_id).
create unique index if not exists telephony_inventory_object_uk
  on telephony_inventory (tenant_id, provider, provider_object_id);
create index if not exists telephony_inventory_tenant_type_idx
  on telephony_inventory (tenant_id, canonical_type) where status = 'active';

-- ── triggers + RLS ──────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['telephony_onboarding','telephony_inventory'] loop
    execute format('drop trigger if exists %1$s_set_updated_at on %1$s;', t);
    execute format(
      'create trigger %1$s_set_updated_at before update on %1$s
         for each row execute function set_updated_at();', t);
    execute format('alter table %s enable row level security;', t);
    execute format('drop policy if exists %1$s_select_tenant on %1$s;', t);
    execute format(
      'create policy %1$s_select_tenant on %1$s
         for select to authenticated using (tenant_id = current_tenant_id());', t);
  end loop;
end $$;
