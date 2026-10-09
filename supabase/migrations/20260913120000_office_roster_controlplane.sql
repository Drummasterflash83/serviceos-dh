-- ServiceOS — Office roster completion for the OpenFolk Control Plane (universal).
--
-- 20260818120000 created the roster substrate (team_members / responsibility_assignments /
-- authority_grants, all effective-dated) and 20260821120000 gave the Control Plane atomic
-- change-logged writers for members, identities, endpoints and endpoint ownership. What was
-- missing is the WRITE PATH for the rest of the roster lifecycle: ending/reactivating a
-- member, proposing/confirming a formal title, assigning responsibilities (including shared
-- ownership and weekday cover), and granting/ending scoped authority — each auditable and
-- reviewable so staff moves never require code changes.
--
-- Adds (all additive):
--   * team_members.formal_role_status — 'proposed' | 'confirmed'. The FORMAL title needs its
--     own review state (observed_status only tracks the OBSERVED role). Existing rows default
--     to 'proposed' — honest: no title has been operator-confirmed yet.
--   * team_members.target_role — the agreed target/aspirational title (e.g. an Office Manager
--     whose target role is Customer Experience Manager). Display/planning only; never routing.
--   * cp_roster_upsert_member / cp_member_lifecycle / cp_upsert_responsibility /
--     cp_end_responsibility / cp_grant_authority / cp_end_authority — SECURITY DEFINER,
--     service-role-execute-only, mutation + immutable controlplane_change_log entry in one
--     transaction (same contract as the existing cp_* writers).
--
-- NO tenant data is seeded here (universal engine only). The Drummonds office roster is a
-- separate reversible data seed (scripts/seed/drummonds-office-roster.mjs), openfolk_proposed.
--
-- Rollback:
--   drop function if exists cp_end_authority(uuid,uuid,text,text,text,boolean);
--   drop function if exists cp_grant_authority(uuid,uuid,text,text,text,boolean,text,text,text,boolean);
--   drop function if exists cp_end_responsibility(uuid,uuid,timestamptz,text,text,text,boolean);
--   drop function if exists cp_upsert_responsibility(uuid,uuid,uuid,text,text,text,text,boolean,int,uuid,boolean,timestamptz,text,text,text,boolean);
--   drop function if exists cp_member_lifecycle(uuid,uuid,text,timestamptz,text,text,text,boolean);
--   drop function if exists cp_roster_upsert_member(uuid,uuid,text,uuid,text,text,text,text,timestamptz,text,text,text,boolean);
--   alter table team_members drop column if exists target_role;
--   alter table team_members drop column if exists formal_role_status;

-- ── Formal-title review state + target role ──────────────────────────────────
alter table team_members
  add column if not exists formal_role_status text not null default 'proposed'
    check (formal_role_status in ('proposed','confirmed'));
alter table team_members
  add column if not exists target_role text;

-- ── Member create/update (title, target, authority level) ────────────────────
create or replace function cp_roster_upsert_member(
  p_tenant uuid, p_member_id uuid, p_display_name text, p_org_unit uuid,
  p_formal_role text, p_formal_role_status text, p_target_role text,
  p_authority_level text, p_effective_from timestamptz,
  p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_before jsonb := '{}'::jsonb; v_row team_members;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'cp_roster_upsert_member: actor is required';
  end if;
  if p_formal_role_status is not null
     and p_formal_role_status not in ('proposed','confirmed') then
    raise exception 'cp_roster_upsert_member: invalid formal_role_status';
  end if;
  if p_authority_level is not null
     and p_authority_level not in ('individual','lead','manager','director','owner') then
    raise exception 'cp_roster_upsert_member: invalid authority_level';
  end if;
  if p_member_id is not null then
    select * into v_row from team_members where id = p_member_id and tenant_id = p_tenant;
    if not found then raise exception 'cp_roster_upsert_member: member not found in tenant'; end if;
    v_id := v_row.id; v_before := to_jsonb(v_row);
    update team_members set
      display_name       = coalesce(p_display_name, display_name),
      org_unit_id        = coalesce(p_org_unit, org_unit_id),
      formal_role        = coalesce(p_formal_role, formal_role),
      formal_role_status = coalesce(p_formal_role_status, formal_role_status),
      target_role        = coalesce(p_target_role, target_role),
      authority_level    = coalesce(p_authority_level, authority_level),
      version            = version + 1
     where id = v_id;
  else
    if p_display_name is null or length(trim(p_display_name)) = 0 then
      raise exception 'cp_roster_upsert_member: display_name is required to create a member';
    end if;
    insert into team_members
      (tenant_id, display_name, org_unit_id, formal_role, formal_role_status, target_role,
       authority_level, effective_from, source)
    values (p_tenant, p_display_name, p_org_unit, p_formal_role,
       coalesce(p_formal_role_status, 'proposed'), p_target_role,
       coalesce(p_authority_level, 'individual'), coalesce(p_effective_from, now()), 'openfolk')
    returning id into v_id;
  end if;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.roster.member_upsert', 'team_member', v_id::text,
     v_before, (select to_jsonb(m) from team_members m where m.id = v_id),
     p_reason, p_correlation, coalesce(p_view_as, false), 'controlplane');
  return v_id;
end $$;

-- ── Member lifecycle: end (leaver) / reactivate (rejoiner) — history preserved ─
create or replace function cp_member_lifecycle(
  p_tenant uuid, p_member_id uuid, p_op text, p_effective timestamptz,
  p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_before jsonb; v_row team_members; v_when timestamptz := coalesce(p_effective, now());
begin
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'cp_member_lifecycle: actor is required';
  end if;
  if p_op not in ('end','reactivate') then
    raise exception 'cp_member_lifecycle: op must be end|reactivate';
  end if;
  select * into v_row from team_members where id = p_member_id and tenant_id = p_tenant;
  if not found then raise exception 'cp_member_lifecycle: member not found in tenant'; end if;
  v_before := to_jsonb(v_row);
  if p_op = 'end' then
    if v_row.effective_to is not null then
      raise exception 'cp_member_lifecycle: member is already ended';
    end if;
    update team_members set effective_to = v_when, version = version + 1
     where id = p_member_id;
    -- Ending the person ends their open responsibilities the same instant (history kept).
    update responsibility_assignments set effective_to = v_when
     where tenant_id = p_tenant and member_id = p_member_id and effective_to is null;
    update authority_grants set effective_to = v_when
     where tenant_id = p_tenant and member_id = p_member_id and effective_to is null;
  else
    if v_row.effective_to is null then
      raise exception 'cp_member_lifecycle: member is already active';
    end if;
    -- Reactivation restores the person only; responsibilities/authority are re-proposed
    -- deliberately (a rejoiner's duties are a decision, never an automatic restore).
    update team_members set effective_to = null, version = version + 1
     where id = p_member_id;
  end if;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.roster.member_' || p_op, 'team_member', p_member_id::text,
     v_before, (select to_jsonb(m) from team_members m where m.id = p_member_id),
     p_reason, p_correlation, coalesce(p_view_as, false), 'controlplane');
  return p_member_id;
end $$;

-- ── Responsibilities: create / supersede (end-and-replace preserves history) ──
create or replace function cp_upsert_responsibility(
  p_tenant uuid, p_assignment_id uuid, p_member uuid, p_kind text, p_target_ref text,
  p_label text, p_raci text, p_is_shared boolean, p_weekday_mask int, p_cover_for uuid,
  p_confirmed boolean, p_effective_from timestamptz,
  p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_old responsibility_assignments; v_before jsonb := '{}'::jsonb;
        v_from timestamptz := coalesce(p_effective_from, now());
begin
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'cp_upsert_responsibility: actor is required';
  end if;
  if p_assignment_id is not null then
    -- Supersede: end the existing assignment at v_from and create the successor row.
    -- Historical work stays attributed to the person/shape that held it at the time.
    select * into v_old from responsibility_assignments
     where id = p_assignment_id and tenant_id = p_tenant;
    if not found then raise exception 'cp_upsert_responsibility: assignment not found in tenant'; end if;
    if v_old.effective_to is not null then
      raise exception 'cp_upsert_responsibility: assignment is already ended';
    end if;
    v_before := to_jsonb(v_old);
    update responsibility_assignments set effective_to = v_from where id = v_old.id;
    insert into responsibility_assignments
      (tenant_id, member_id, kind, target_ref, label, raci_role, is_shared, weekday_mask,
       cover_for, confirmed, effective_from, version, source)
    values (p_tenant, coalesce(p_member, v_old.member_id), coalesce(p_kind, v_old.kind),
       coalesce(p_target_ref, v_old.target_ref), coalesce(p_label, v_old.label),
       coalesce(p_raci, v_old.raci_role), coalesce(p_is_shared, v_old.is_shared),
       coalesce(p_weekday_mask, v_old.weekday_mask), coalesce(p_cover_for, v_old.cover_for),
       coalesce(p_confirmed, v_old.confirmed), v_from, v_old.version + 1, 'openfolk')
    returning id into v_id;
  else
    if p_member is null or p_kind is null or p_label is null then
      raise exception 'cp_upsert_responsibility: member, kind and label are required';
    end if;
    if not exists (select 1 from team_members
                    where id = p_member and tenant_id = p_tenant and effective_to is null) then
      raise exception 'cp_upsert_responsibility: member is not active in tenant';
    end if;
    if p_cover_for is not null and not exists
       (select 1 from team_members where id = p_cover_for and tenant_id = p_tenant) then
      raise exception 'cp_upsert_responsibility: cover_for member not found in tenant';
    end if;
    insert into responsibility_assignments
      (tenant_id, member_id, kind, target_ref, label, raci_role, is_shared, weekday_mask,
       cover_for, confirmed, effective_from, source)
    values (p_tenant, p_member, p_kind, p_target_ref, p_label,
       coalesce(p_raci, 'responsible'), coalesce(p_is_shared, false), p_weekday_mask,
       p_cover_for, coalesce(p_confirmed, false), v_from, 'openfolk')
    returning id into v_id;
  end if;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.roster.responsibility_upsert', 'responsibility_assignment',
     v_id::text, v_before,
     (select to_jsonb(r) from responsibility_assignments r where r.id = v_id),
     p_reason, p_correlation, coalesce(p_view_as, false), 'controlplane');
  return v_id;
end $$;

create or replace function cp_end_responsibility(
  p_tenant uuid, p_assignment_id uuid, p_effective_to timestamptz,
  p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_old responsibility_assignments;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'cp_end_responsibility: actor is required';
  end if;
  select * into v_old from responsibility_assignments
   where id = p_assignment_id and tenant_id = p_tenant;
  if not found then raise exception 'cp_end_responsibility: assignment not found in tenant'; end if;
  if v_old.effective_to is not null then
    raise exception 'cp_end_responsibility: assignment is already ended';
  end if;
  update responsibility_assignments set effective_to = coalesce(p_effective_to, now())
   where id = p_assignment_id;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.roster.responsibility_end', 'responsibility_assignment',
     p_assignment_id::text, to_jsonb(v_old),
     (select to_jsonb(r) from responsibility_assignments r where r.id = p_assignment_id),
     p_reason, p_correlation, coalesce(p_view_as, false), 'controlplane');
  return p_assignment_id;
end $$;

-- ── Authority: grant / end (reactivates an ended identical grant in place) ────
create or replace function cp_grant_authority(
  p_tenant uuid, p_member uuid, p_permission text, p_scope text, p_scope_ref text,
  p_confirmed boolean,
  p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_before jsonb := '{}'::jsonb; v_row authority_grants;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'cp_grant_authority: actor is required';
  end if;
  if not exists (select 1 from team_members
                  where id = p_member and tenant_id = p_tenant and effective_to is null) then
    raise exception 'cp_grant_authority: member is not active in tenant';
  end if;
  if not exists (select 1 from authority_permissions where permission = p_permission) then
    raise exception 'cp_grant_authority: unknown permission';
  end if;
  -- The unique key spans ended rows too, so an identical prior grant is reactivated
  -- in place (its history remains in the change log), never duplicated.
  select * into v_row from authority_grants
   where tenant_id = p_tenant and member_id = p_member and permission = p_permission
     and scope = coalesce(p_scope, 'self') and coalesce(scope_ref, '') = coalesce(p_scope_ref, '');
  if found then
    v_id := v_row.id; v_before := to_jsonb(v_row);
    update authority_grants
       set effective_to = null,
           effective_from = case when v_row.effective_to is not null then now() else effective_from end,
           confirmed = coalesce(p_confirmed, confirmed)
     where id = v_id;
  else
    insert into authority_grants
      (tenant_id, member_id, permission, scope, scope_ref, confirmed, source)
    values (p_tenant, p_member, p_permission, coalesce(p_scope, 'self'), p_scope_ref,
       coalesce(p_confirmed, false), 'openfolk')
    returning id into v_id;
  end if;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.roster.authority_grant', 'authority_grant', v_id::text,
     v_before, (select to_jsonb(g) from authority_grants g where g.id = v_id),
     p_reason, p_correlation, coalesce(p_view_as, false), 'controlplane');
  return v_id;
end $$;

create or replace function cp_end_authority(
  p_tenant uuid, p_grant_id uuid,
  p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_old authority_grants;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'cp_end_authority: actor is required';
  end if;
  select * into v_old from authority_grants
   where id = p_grant_id and tenant_id = p_tenant;
  if not found then raise exception 'cp_end_authority: grant not found in tenant'; end if;
  if v_old.effective_to is not null then
    raise exception 'cp_end_authority: grant is already ended';
  end if;
  update authority_grants set effective_to = now() where id = p_grant_id;
  insert into controlplane_change_log
    (tenant_id, actor, action, resource_type, resource_id, before, after, reason, correlation_id, view_as_active, source)
  values (p_tenant, p_actor, 'controlplane.roster.authority_end', 'authority_grant',
     p_grant_id::text, to_jsonb(v_old),
     (select to_jsonb(g) from authority_grants g where g.id = p_grant_id),
     p_reason, p_correlation, coalesce(p_view_as, false), 'controlplane');
  return p_grant_id;
end $$;

-- ── EXECUTE only for the service role (the edge function authorises first) ────
do $$
declare fn text;
begin
  foreach fn in array array[
    'cp_roster_upsert_member(uuid,uuid,text,uuid,text,text,text,text,timestamptz,text,text,text,boolean)',
    'cp_member_lifecycle(uuid,uuid,text,timestamptz,text,text,text,boolean)',
    'cp_upsert_responsibility(uuid,uuid,uuid,text,text,text,text,boolean,int,uuid,boolean,timestamptz,text,text,text,boolean)',
    'cp_end_responsibility(uuid,uuid,timestamptz,text,text,text,boolean)',
    'cp_grant_authority(uuid,uuid,text,text,text,boolean,text,text,text,boolean)',
    'cp_end_authority(uuid,uuid,text,text,text,boolean)']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
