-- ServiceOS — Operational roles, responsibilities, ownership & authority (universal).
--
-- The platform had two disconnected notions of "role": the coarse auth role
-- (`profiles.role` = owner|admin|ops|viewer) and RACI `ownership_assignments` bound
-- to intelligence_objects only. Neither models a person's OPERATIONAL role, who
-- owns which objective/workflow/team, weekday-dependent cover, or the AUTHORITY to
-- govern agents/automations. This adds that layer, universally.
--
-- Design rules honoured:
--  - `profiles.role` stays AUTHORIZATION; operational role/responsibility lives here.
--  - formal role vs OBSERVED role are distinct; observed starts proposed/inferred.
--  - tenant-scoped, RLS-read, service-role-write, versioned, effective-date-aware.
--  - NO tenant data is seeded here (universal engine only). Drummond drafts are a
--    separate, reversible, `openfolk_proposed` data seed.
--
-- Rollback:
--   drop table if exists authority_grants;
--   drop table if exists responsibility_assignments;
--   drop table if exists team_members;
--   drop table if exists authority_permissions;

-- ── Team members: the person + formal role + OBSERVED role ──────────────────
create table if not exists team_members (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  profile_id      uuid,                              -- profiles.id when they have a login (nullable; staff may have none)
  display_name    text not null,
  org_unit_id     uuid references org_units(id) on delete set null,
  formal_role     text,                              -- official job title / role
  observed_role   text,                              -- what they actually do (inferred from evidence)
  observed_status text not null default 'proposed'
                    check (observed_status in ('proposed','inferred','confirmed')),
  authority_level text not null default 'individual'
                    check (authority_level in ('individual','lead','manager','director','owner')),
  confidence      numeric check (confidence is null or (confidence between 0 and 1)),
  evidence        jsonb not null default '[]',
  source          text not null default 'openfolk_proposed',
  confirmed_by    uuid,
  confirmed_at    timestamptz,
  effective_from  timestamptz not null default now(),
  effective_to    timestamptz,                       -- null = current
  version         int not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists team_members_tenant on team_members (tenant_id, effective_to);
create index if not exists team_members_profile on team_members (tenant_id, profile_id);
drop trigger if exists team_members_set_updated_at on team_members;
create trigger team_members_set_updated_at before update on team_members
  for each row execute function set_updated_at();

-- ── Responsibilities / ownership: many per person, shared, weekday, cover ────
create table if not exists responsibility_assignments (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  member_id      uuid not null references team_members(id) on delete cascade,
  kind           text not null
                   check (kind in ('responsibility_area','objective','workflow','escalation','team','customer_segment','cover')),
  target_ref     text,                               -- objective_id | workflow key | org_unit id | area label | covered member_id
  label          text not null,                      -- human description
  raci_role      text not null default 'responsible'
                   check (raci_role in ('responsible','accountable','consulted','informed','approver','observer')),
  is_shared      boolean not null default false,
  weekday_mask   int,                                -- bitmask Mon=1,Tue=2,…,Sun=64; null = all days
  cover_for      uuid references team_members(id) on delete set null,
  confidence     numeric check (confidence is null or (confidence between 0 and 1)),
  evidence       jsonb not null default '[]',
  source         text not null default 'openfolk_proposed',
  confirmed      boolean not null default false,
  effective_from timestamptz not null default now(),
  effective_to   timestamptz,
  version        int not null default 1,
  created_at     timestamptz not null default now()
);
create index if not exists resp_member on responsibility_assignments (tenant_id, member_id, effective_to);
create index if not exists resp_target on responsibility_assignments (tenant_id, kind, target_ref);

-- ── Authority: agent/automation governance + approval/assign, by scope ──────
create table if not exists authority_permissions (
  permission  text primary key,
  category    text not null,
  description text not null
);
insert into authority_permissions (permission, category, description) values
  -- agent / automation governance (the twelve agent controls)
  ('agent.view','agent','View assigned agents'),
  ('agent.interact','agent','Interact with an assigned agent'),
  ('agent.correct','agent','Correct agent output / provide context'),
  ('agent.approve_action','agent','Approve a proposed agent action'),
  ('agent.pause','agent','Pause an agent'),
  ('agent.configure','agent','Configure agent behaviour'),
  ('agent.create','agent','Create an agent'),
  ('agent.activate','agent','Activate / deactivate an agent'),
  ('agent.set_autonomy','agent','Change autonomy level'),
  ('agent.set_access','agent','Change tools / data access'),
  ('agent.assign','agent','Assign agents to users / teams / roles'),
  ('agent.retire','agent','Retire an agent'),
  -- work / strategy authority
  ('work.approve','work','Approve work / actions within authority'),
  ('work.assign','work','Assign work to others'),
  ('objective.publish','strategy','Publish / activate objectives'),
  ('ownership.confirm','strategy','Confirm roles / ownership')
on conflict (permission) do nothing;

create table if not exists authority_grants (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  member_id      uuid not null references team_members(id) on delete cascade,
  permission     text not null references authority_permissions(permission),
  scope          text not null default 'self' check (scope in ('self','team','company')),
  scope_ref      text,                               -- org_unit id when scope='team'
  source         text not null default 'openfolk_proposed',
  confirmed      boolean not null default false,
  effective_from timestamptz not null default now(),
  effective_to   timestamptz,
  created_at     timestamptz not null default now()
);
-- one active grant per (member, permission, scope, scope_ref)
create unique index if not exists authority_grants_uk
  on authority_grants (tenant_id, member_id, permission, scope, coalesce(scope_ref, ''));

-- ── RLS: tenant-scoped read for authenticated; writes are service-role only ──
alter table team_members enable row level security;
alter table responsibility_assignments enable row level security;
alter table authority_permissions enable row level security;
alter table authority_grants enable row level security;

drop policy if exists team_members_select on team_members;
create policy team_members_select on team_members
  for select to authenticated using (tenant_id = current_tenant_id());

drop policy if exists resp_select on responsibility_assignments;
create policy resp_select on responsibility_assignments
  for select to authenticated using (tenant_id = current_tenant_id());

drop policy if exists authority_grants_select on authority_grants;
create policy authority_grants_select on authority_grants
  for select to authenticated using (tenant_id = current_tenant_id());

drop policy if exists authority_permissions_select on authority_permissions;
create policy authority_permissions_select on authority_permissions
  for select to authenticated using (true); -- platform vocabulary
