-- ============================================================================
-- ServiceOS / OpenFolk — Platform authority DECOUPLED from profiles.role.
--
-- WHY (blocker-driven correction; the live UI proved the model was wrong):
--   `profiles.role` is a SINGLE column (owner|admin|ops|viewer|openfolk), so one person
--   cannot be both a tenant `owner` and a platform `openfolk` operator. The original
--   Control Plane gate required BOTH role='openfolk' AND an active grant, which would
--   have forced the first operator to SURRENDER their tenant owner role to gain platform
--   access. That conflates TENANT identity with PLATFORM authority.
--
-- CORRECTION — platform access now requires exactly:
--     1. an authenticated user (auth.uid());
--     2. a valid existing profile;
--     3. an ACTIVE platform.controlplane grant (admin implies view).
--   `profiles.role` is henceforth ONLY the tenant-facing role. Platform authority lives
--   solely in the effective-dated, auditable platform_authority_grants ledger.
--
-- DELIBERATELY UNCHANGED — `is_openfolk()` (which still means profiles.role='openfolk')
--   governs CROSS-TENANT access in ~30 tenant-data RLS policies across the backbone.
--   Re-pointing it at the platform grant would BROADEN tenant permissions. It is left
--   exactly as-is, so a platform grant confers Control Plane access ONLY — never tenant
--   data access. No tenant permission is widened by this migration.
--
-- Scope: replaces ONE function. Every Control Plane RLS policy already routes through it
-- (see the *_select policy loop in 20260821120000), so the whole surface inherits the fix
-- with no policy churn. Additive and idempotent.
-- ============================================================================

create or replace function current_user_is_openfolk_operator(required_permission text default 'platform.controlplane.view')
  returns boolean language sql stable security definer set search_path = public as $$
  -- Authenticated + existing profile (the join to profiles enforces both: a null
  -- auth.uid() matches no row) + an ACTIVE grant of the required permission.
  select exists (
    select 1
    from public.profiles p
    join public.platform_authority_grants g on g.profile_id = p.id
    where p.id = auth.uid()
      and (
        g.permission = required_permission
        or (required_permission = 'platform.controlplane.view'
            and g.permission = 'platform.controlplane.admin')
      )
      and coalesce(g.effective_from, '-infinity'::timestamptz) <= now()
      and coalesce(g.effective_to,   'infinity'::timestamptz)  >  now()
  );
$$;

comment on function current_user_is_openfolk_operator(text) is
  'Platform-operator gate: authenticated + existing profile + ACTIVE platform.controlplane grant (admin implies view). Independent of profiles.role, which is tenant-facing only. Does NOT confer tenant data access.';

-- ── Governed record of the architectural correction (platform-level change). ──
-- tenant_id null = platform-level. Guarded so re-application stays idempotent.
insert into controlplane_change_log
  (tenant_id, actor, action, resource_type, resource_id, before, after, reason, source)
select
  null,
  'system:migration',
  'controlplane.authority.model_correction',
  'function',
  'current_user_is_openfolk_operator',
  jsonb_build_object('requires', jsonb_build_array(
    'profiles.role = openfolk', 'active platform.controlplane grant')),
  jsonb_build_object('requires', jsonb_build_array(
    'authenticated user', 'existing profile', 'active platform.controlplane grant')),
  'Decouple platform authority from profiles.role so a tenant owner can hold platform.controlplane.admin without surrendering their tenant role. is_openfolk() and all tenant RLS intentionally unchanged: no tenant permission is broadened.',
  'migration'
where not exists (
  select 1 from controlplane_change_log
  where action = 'controlplane.authority.model_correction'
    and resource_id = 'current_user_is_openfolk_operator'
);
