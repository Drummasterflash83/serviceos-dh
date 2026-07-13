-- ============================================================================
-- Universal Intelligence Foundation — P0 BACKBONE
-- ============================================================================
-- The three load-bearing mechanisms + the missing tenant anchor. Additive and
-- idempotent: no existing table is dropped; `profiles.role` CHECK is only WIDENED.
-- See docs/UNIVERSAL_INTELLIGENCE_FOUNDATION.md §0.2, §2, §10.
-- ============================================================================

-- ── The missing anchor. `tenant_id` stops being a floating uuid. ─────────────
create table if not exists tenants (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  display_name text not null,
  industry     text,                 -- a template KEY (data), never a code path
  status       text not null default 'active' check (status in ('active','suspended','archived')),
  metadata     jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Seed the existing Drummond tenant (was a bare uuid literal across the schema).
insert into tenants (id, slug, display_name, industry)
values ('00000000-0000-0000-0000-000000000001', 'drummonds', 'Drummond Heating', 'hvac')
on conflict (id) do nothing;

-- ── Universal versioning lifecycle for EVERY config artifact (§10.1). ────────
create table if not exists config_versions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references tenants(id),   -- null = platform / industry layer
  artifact_kind text not null,                 -- operating_profile|policy|domain_pack|subscription|feature_flag
  artifact_key  text not null,
  version       int  not null,
  status        text not null default 'draft'
                  check (status in ('draft','simulation','review','published','archived')),
  supersedes    uuid references config_versions(id),
  author        text not null default 'system',
  note          text,
  payload_hash  text,
  published_at  timestamptz,
  created_at    timestamptz not null default now()
);
-- exactly one PUBLISHED version per artifact (the "current" pointer)
create unique index if not exists config_versions_published_uk
  on config_versions (artifact_kind, artifact_key)
  where status = 'published';
create index if not exists config_versions_lookup
  on config_versions (tenant_id, artifact_kind, artifact_key);

-- ── Provider (OpenFolk) scope — mirrors current_tenant_id()/current_user_role(). ─
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add  constraint profiles_role_check
  check (role in ('owner','admin','ops','viewer','openfolk'));

create or replace function is_openfolk() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'openfolk' from public.profiles where id = auth.uid()), false);
$$;

-- ── RLS: tenant-scoped reads; platform-layer (tenant_id null) config is a
--    non-secret default readable by any authenticated user; provider sees all.
alter table tenants enable row level security;
drop policy if exists tenants_select on tenants;
create policy tenants_select on tenants for select to authenticated
  using (id = current_tenant_id() or is_openfolk());

alter table config_versions enable row level security;
drop policy if exists config_versions_select on config_versions;
create policy config_versions_select on config_versions for select to authenticated
  using (tenant_id is null or tenant_id = current_tenant_id() or is_openfolk());

-- ── updated_at trigger (reuses the platform primitive). ─────────────────────
drop trigger if exists tenants_set_updated_at on tenants;
create trigger tenants_set_updated_at before update on tenants
  for each row execute function set_updated_at();
