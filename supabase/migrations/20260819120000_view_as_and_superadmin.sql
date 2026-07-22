-- ServiceOS — Tenant Superadmin authority + secure server-resolved View-As (universal).
--
-- Two additions the Command Centre needs, both universal (no tenant/Drummond branch):
--
--  1. `tenant.superadmin` — a tenant-scoped governance permission, DISTINCT from the
--     cross-tenant `openfolk` role and from `profiles.role='owner'`. Granted per person
--     via the existing authority_grants mechanism (scope='company'), so it is versioned,
--     auditable, reversible and effective-date-aware like every other grant. The actual
--     grant to a specific person is a separate, reversible DATA step (see
--     scripts/seed/grant-tenant-superadmin.mjs) — never hardcoded in engine logic.
--
--  2. `view_as_context` — a short-lived, actor-owned, read-only preview session that a
--     Tenant Superadmin opens to see exactly what another user/role/team/permission
--     profile/unassigned-user sees. It is RESOLVED SERVER-SIDE: the edge function keeps
--     the authenticated actor, reads the actor's own active context, then re-scopes reads
--     to the subject. RLS is never bypassed in the browser; the client cannot forge a
--     subject as authorisation. Contexts expire and are audited.
--
-- Design rules honoured (docs/architecture/08_BACKEND_PRINCIPLES, 10_FRONTEND_PRINCIPLES):
--  - tenant-scoped, RLS-read, service-role-write, effective-date-/expiry-aware.
--  - NO tenant data seeded here (universal engine only).
--  - additive state_transitions complete the reference Action lifecycle so the persistent
--    work transitions (dismiss / unblock / resolve) have a legal path; both domains.
--
-- Rollback (removes EXACTLY what this migration adds; pre-existing transitions untouched):
--   drop table if exists view_as_context;
--   -- revoke dependent grants first (authority_grants FK-references the permission):
--   delete from authority_grants where permission = 'tenant.superadmin';
--   delete from authority_permissions where permission = 'tenant.superadmin';
--   delete from state_transitions where object_type = 'Action'
--     and (domain, from_state, to_state) in (
--       ('serviceos','proposed','cancelled'),('serviceos','in_progress','cancelled'),
--       ('serviceos','waiting','cancelled'),('serviceos','blocked','cancelled'),
--       ('serviceos','escalated','cancelled'),('serviceos','blocked','in_progress'),
--       ('serviceos','escalated','in_progress'),
--       ('productos','proposed','cancelled'),('productos','in_progress','cancelled'),
--       ('productos','waiting','cancelled'),('productos','blocked','cancelled'),
--       ('productos','escalated','cancelled'),('productos','blocked','in_progress'),
--       ('productos','escalated','in_progress'));
--   -- (this migration creates no functions/policies; nothing else to remove)

-- ── 1. Tenant Superadmin permission (vocabulary only; grants are data) ───────
insert into authority_permissions (permission, category, description) values
  ('tenant.superadmin','authority',
   'Tenant Superadmin — full tenant-scoped governance authority (publish strategy, define/confirm roles & ownership, govern agents, open View-As). Distinct from platform/openfolk.')
on conflict (permission) do nothing;

-- ── 2. Secure server-resolved View-As context ───────────────────────────────
create table if not exists view_as_context (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  actor_user_id  uuid not null,                        -- the real signed-in Superadmin (auth.users.id)
  subject_kind   text not null
                   check (subject_kind in ('user','role','team','permission_profile','unassigned')),
  subject_ref    text,                                 -- team_member id | role name | org_unit id | profile name; null for 'unassigned'
  mode           text not null default 'view'
                   check (mode in ('view','supervised_test')),
  read_only      boolean not null default true,
  reason         text,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '30 minutes',
  ended_at       timestamptz                            -- set on explicit exit / invalidation
);
create index if not exists view_as_actor
  on view_as_context (tenant_id, actor_user_id, expires_at, ended_at);

alter table view_as_context enable row level security;
-- The actor may read ONLY their own contexts; openfolk may read for support/audit.
-- Writes are service-role only (the view-as edge function), so a client can never
-- create or extend a context, nor forge one for another actor.
drop policy if exists view_as_select on view_as_context;
create policy view_as_select on view_as_context
  for select to authenticated
  using ((actor_user_id = auth.uid() and tenant_id = current_tenant_id()) or is_openfolk());

-- ── 3. Additive Action lifecycle transitions (universal, both domains) ──────
-- Complete the reference lifecycle so persistent work transitions have legal paths:
-- dismiss (→cancelled) from any active state, unblock (blocked→in_progress), and
-- resolve-escalation (escalated→in_progress). Existing transitions are untouched.
insert into state_transitions (domain, object_type, from_state, to_state) values
  ('serviceos','Action','proposed','cancelled'),
  ('serviceos','Action','in_progress','cancelled'),
  ('serviceos','Action','waiting','cancelled'),
  ('serviceos','Action','blocked','cancelled'),
  ('serviceos','Action','escalated','cancelled'),
  ('serviceos','Action','blocked','in_progress'),
  ('serviceos','Action','escalated','in_progress'),
  ('productos','Action','proposed','cancelled'),
  ('productos','Action','in_progress','cancelled'),
  ('productos','Action','waiting','cancelled'),
  ('productos','Action','blocked','cancelled'),
  ('productos','Action','escalated','cancelled'),
  ('productos','Action','blocked','in_progress'),
  ('productos','Action','escalated','in_progress')
on conflict (domain, object_type, from_state, to_state) do nothing;
