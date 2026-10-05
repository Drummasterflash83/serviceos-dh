-- ============================================================================
-- Universal Intelligence Foundation — P1 TENANT OPERATING PROFILE (layered)
-- ============================================================================
-- The profile is not one blob. It is resolved from ordered layers (platform →
-- industry → domain → tenant → department → team → user) into an effective
-- snapshot. Industry is a DATA layer, never a code path — this is the structural
-- guarantee behind "no hard-coded industries". See docs §2.
-- ============================================================================

-- ── Org structure that needs referential integrity (kinds are DATA). ────────
create table if not exists org_units (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  kind       text not null,                 -- 'department' | 'team' | 'crew' | ... (from pack/profile)
  parent_id  uuid references org_units(id) on delete set null,
  name       text not null,
  metadata   jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists org_units_tenant on org_units (tenant_id);

create table if not exists org_unit_members (
  org_unit_id uuid not null references org_units(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  role_in_unit text,                          -- 'lead' | 'member' | ... (data)
  created_at  timestamptz not null default now(),
  primary key (org_unit_id, user_id)
);

-- ── Every profile fact is a scoped, versioned key/value. Scope = the layer. ──
-- The brief's long list (SLA, escalation, approval, AI permissions, risk
-- appetite, confidence thresholds, terminology, ...) are NAMESPACES, not columns.
create table if not exists operating_profile_entries (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references tenants(id) on delete cascade,   -- null = platform/industry default
  scope_kind  text not null
                check (scope_kind in ('platform','industry','domain','tenant','department','team','user')),
  scope_ref   text,                            -- industry key / domain id / org_unit id / user id
  domain      text,                            -- null = applies to all domains
  namespace   text not null,                   -- 'sla' | 'escalation' | 'ai_permissions' | 'confidence' | ...
  key         text not null,
  value       jsonb not null,
  version_id  uuid not null references config_versions(id),
  created_at  timestamptz not null default now()
);
create index if not exists ope_lookup on operating_profile_entries (tenant_id, namespace, key);
create index if not exists ope_scope  on operating_profile_entries (scope_kind, scope_ref, domain);
-- Natural key (nullable parts coalesced) so seeds are idempotent under re-apply.
create unique index if not exists ope_natural_uk on operating_profile_entries (
  coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
  scope_kind, coalesce(scope_ref, ''), coalesce(domain, ''), namespace, key
);

-- ── The resolved snapshot the ENGINE reads (never re-derives from tenant id). ─
-- input_hash makes point-in-time replay possible (simulation, §10.2).
create table if not exists effective_profiles (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  domain      text not null,
  resolved    jsonb not null,                  -- deep-merged layers
  input_hash  text not null,                   -- hash of contributing version ids
  computed_at timestamptz not null default now(),
  primary key (tenant_id, domain)
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table org_units enable row level security;
drop policy if exists org_units_select on org_units;
create policy org_units_select on org_units for select to authenticated
  using (tenant_id = current_tenant_id() or is_openfolk());

alter table org_unit_members enable row level security;
drop policy if exists org_unit_members_select on org_unit_members;
create policy org_unit_members_select on org_unit_members for select to authenticated
  using (exists (select 1 from org_units u
                 where u.id = org_unit_id
                   and (u.tenant_id = current_tenant_id() or is_openfolk())));

alter table operating_profile_entries enable row level security;
drop policy if exists ope_select on operating_profile_entries;
create policy ope_select on operating_profile_entries for select to authenticated
  using (tenant_id is null or tenant_id = current_tenant_id() or is_openfolk());

alter table effective_profiles enable row level security;
drop policy if exists effprof_select on effective_profiles;
create policy effprof_select on effective_profiles for select to authenticated
  using (tenant_id = current_tenant_id() or is_openfolk());

-- ── triggers ────────────────────────────────────────────────────────────────
drop trigger if exists org_units_set_updated_at on org_units;
create trigger org_units_set_updated_at before update on org_units
  for each row execute function set_updated_at();
