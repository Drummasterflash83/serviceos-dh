-- ServiceOS — Provider secret broker (Vault-backed, tenant-scoped). Minimal & reversible.
--
-- The secure indirection behind telephony_onboarding.connection_ref: per-tenant provider
-- credentials are encrypted at rest by Supabase Vault (pgsodium AEAD). This migration adds
-- ONLY the three SECURITY DEFINER RPCs that are the sole path to write/read/revoke those
-- secrets. No plaintext ever leaves Postgres: the decrypt path (provider_secret_read) is
-- callable exclusively by service_role — never anon/authenticated — so the frontend and any
-- user JWT physically cannot reach a decrypted credential. The vault schema itself is not
-- exposed to the Data API (anon/authenticated lack USAGE), so vault.decrypted_secrets is
-- unreachable except through these narrowly scoped functions.
--
-- Naming makes cross-tenant / cross-provider collision impossible: every secret is stored
-- under  provider_secret:<tenant_uuid>:<provider>:<field>  — unique by construction.
-- Descriptions and names carry NO secret material.
--
-- Owner/admin authorization and tenant binding are enforced by the calling Edge Function
-- (requireTenantUser + assertSameTenant) which passes an already-verified tenant_id; these
-- RPCs additionally scope every operation by that tenant_id so a wrong tenant can never
-- resolve another tenant's secret. Reversible — see ROLLBACK.
--
-- ROLLBACK:
--   drop function if exists public.provider_secret_revoke(uuid, text);
--   drop function if exists public.provider_secret_read(uuid, text, text);
--   drop function if exists public.provider_secret_store(uuid, text, text, text);

-- Composed, collision-proof secret name for one (tenant, provider, field).
create or replace function public.provider_secret_name(p_tenant uuid, p_provider text, p_field text)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'provider_secret:' || p_tenant::text || ':' || lower(p_provider) || ':' || lower(p_field);
$$;

-- Store (create or replace) one secret field. Returns the Vault secret id (a reference,
-- never the secret). Replacement updates the existing Vault row in place — no duplicate,
-- and the ciphertext/nonce are rotated by Vault.
create or replace function public.provider_secret_store(
  p_tenant   uuid,
  p_provider text,
  p_field    text,
  p_secret   text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := public.provider_secret_name(p_tenant, p_provider, p_field);
  v_id   uuid;
begin
  if p_tenant is null or coalesce(p_provider, '') = '' or coalesce(p_field, '') = '' then
    raise exception 'provider_secret_store: tenant, provider and field are required';
  end if;
  if coalesce(p_secret, '') = '' then
    raise exception 'provider_secret_store: empty secret rejected';
  end if;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    v_id := vault.create_secret(
      p_secret,
      v_name,
      'ServiceOS provider credential (' || lower(p_provider) || '/' || lower(p_field) || ')'
    );
  else
    perform vault.update_secret(v_id, p_secret, v_name);
  end if;
  return v_id;
end;
$$;

-- Resolve (decrypt) one secret field. SERVICE-ROLE ONLY (see grants below): this is the
-- only decrypt path and it is unreachable from the frontend. Returns null if absent.
create or replace function public.provider_secret_read(
  p_tenant   uuid,
  p_provider text,
  p_field    text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name   text := public.provider_secret_name(p_tenant, p_provider, p_field);
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = v_name;
  return v_secret;
end;
$$;

-- Revoke every secret field for one (tenant, provider). Returns the count removed. Used by
-- disconnect / credential replacement teardown. Scoped to the tenant+provider prefix only.
create or replace function public.provider_secret_revoke(
  p_tenant   uuid,
  p_provider text
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text := 'provider_secret:' || p_tenant::text || ':' || lower(p_provider) || ':';
  v_count  integer;
begin
  with removed as (
    delete from vault.secrets where name like v_prefix || '%' returning 1
  )
  select count(*) into v_count from removed;
  return coalesce(v_count, 0);
end;
$$;

-- Lock down execution: only the service role (Edge Functions) may touch these. The frontend
-- holds only the anon key + a user JWT — never service_role — so it cannot invoke any of them.
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.provider_secret_store(uuid, text, text, text)',
    'public.provider_secret_read(uuid, text, text)',
    'public.provider_secret_revoke(uuid, text)',
    'public.provider_secret_name(uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public;', fn);
    execute format('revoke all on function %s from anon;', fn);
    execute format('revoke all on function %s from authenticated;', fn);
    execute format('grant execute on function %s to service_role;', fn);
  end loop;
end $$;
