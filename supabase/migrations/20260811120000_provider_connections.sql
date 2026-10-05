-- ServiceOS — Provider connection metadata + audit (additive, tenant-scoped).
--
-- The NON-secret half of the credential broker. Secrets themselves live only in Vault
-- (see 20260810120000_provider_secret_broker.sql); this table stores what is safe to show:
-- connection status, masked account reference, non-secret config, WHICH secret fields are
-- set (names only), and the Vault secret *references* (uuids — useless without service_role
-- execute on the read RPC). One row per (tenant, provider). RLS: tenant SELECT (metadata),
-- writes are service-role only via the Edge Function. The Edge Function additionally masks
-- account_ref and never returns secret material.
--
-- provider_connection_events is the append-only audit trail. detail jsonb NEVER holds secret
-- values — the broker/edge function are responsible for that, and the security tests prove it.
--
-- ROLLBACK:
--   drop table if exists provider_connection_events;
--   drop table if exists provider_connections;

create table if not exists provider_connections (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  provider          text not null,
  status            text not null default 'not_configured',
    -- not_configured | configured | manual | revoked | error
  auth_mode         text,
  account_ref       text,                              -- masked/opaque, non-secret
  non_secret_config jsonb not null default '{}'::jsonb, -- declared non-secret fields only
  configured_fields text[] not null default '{}',       -- secret field NAMES that are set
  secret_refs       jsonb not null default '{}'::jsonb,  -- field -> vault secret id (reference)
  verified_at       timestamptz,                        -- last successful connection test
  last_test         jsonb,                              -- last diagnostics summary (no secrets)
  created_by        uuid,
  updated_by        uuid,
  revoked_by        uuid,
  revoked_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists provider_connections_tenant_provider_uk
  on provider_connections (tenant_id, provider);

create table if not exists provider_connection_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  provider    text not null,
  event       text not null,
    -- provider_selected | credentials_configured | credentials_replaced | connection_tested
    -- | discovery_started | discovery_completed | discovery_failed | inventory_imported
    -- | mapping_confirmed | mapping_replaced | mapping_rejected | gaps_accepted
    -- | test_call_completed | onboarding_completed | onboarding_reopened
    -- | provider_disconnected | oauth_started | oauth_completed | oauth_failed
  actor_id    uuid,
  detail      jsonb not null default '{}'::jsonb,       -- NEVER secret values
  created_at  timestamptz not null default now()
);
create index if not exists provider_connection_events_tenant_idx
  on provider_connection_events (tenant_id, provider, created_at desc);

-- ── triggers + RLS ──────────────────────────────────────────────────────────
do $$
declare t text;
begin
  execute 'drop trigger if exists provider_connections_set_updated_at on provider_connections;';
  execute 'create trigger provider_connections_set_updated_at before update on provider_connections
             for each row execute function set_updated_at();';
  foreach t in array array['provider_connections','provider_connection_events'] loop
    execute format('alter table %s enable row level security;', t);
    execute format('drop policy if exists %1$s_select_tenant on %1$s;', t);
    execute format(
      'create policy %1$s_select_tenant on %1$s
         for select to authenticated using (tenant_id = current_tenant_id());', t);
    -- Explicit grants (portable): service-role does all writes; authenticated SELECT is
    -- gated by the RLS policy above. Hosted Supabase grants these via default privileges,
    -- but postgres-owned tables applied by `migration up` locally do not — so we grant
    -- explicitly to keep local and remote identical. anon gets nothing.
    execute format('grant select, insert, update, delete on %s to service_role;', t);
    execute format('grant select on %s to authenticated;', t);
  end loop;
end $$;
