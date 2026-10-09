-- ServiceOS — Roster hardening: tenant-isolation guard on responsibility supersede.
--
-- 20260913120000's cp_upsert_responsibility validated p_member/p_cover_for against
-- p_tenant on the CREATE branch, but the SUPERSEDE branch inserted
-- coalesce(p_member, v_old.member_id) / coalesce(p_cover_for, v_old.cover_for)
-- without re-validating the RESOLVED successor values. Because the legacy foreign
-- keys on responsibility_assignments(member_id, cover_for) are not tenant-composite,
-- a supersede call could attach another tenant's team member (or cover person) to
-- this tenant's assignment. This replaces the function with a version that:
--
--   1. resolves the successor member/cover into locals FIRST;
--   2. requires the successor member to be ACTIVE in p_tenant;
--   3. requires any cover person to be ACTIVE in p_tenant;
--   4. validates BEFORE ending the old assignment — a refused supersede leaves the
--      existing assignment open and creates nothing (no partial write);
--   5. applies the same active-membership checks to the create branch's cover
--      target (previously existence-in-tenant only), so both branches agree.
--
-- Signature unchanged; grants unchanged (service_role EXECUTE only, revoked from
-- public/anon/authenticated by 20260913120000 — re-asserted defensively below).
--
-- Rollback: re-apply the 20260913120000 definition of cp_upsert_responsibility.

create or replace function cp_upsert_responsibility(
  p_tenant uuid, p_assignment_id uuid, p_member uuid, p_kind text, p_target_ref text,
  p_label text, p_raci text, p_is_shared boolean, p_weekday_mask int, p_cover_for uuid,
  p_confirmed boolean, p_effective_from timestamptz,
  p_actor text, p_reason text, p_correlation text, p_view_as boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_old responsibility_assignments; v_before jsonb := '{}'::jsonb;
        v_from timestamptz := coalesce(p_effective_from, now());
        v_member uuid; v_cover uuid;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'cp_upsert_responsibility: actor is required';
  end if;
  if p_assignment_id is not null then
    -- Supersede: validate the RESOLVED successor values against the tenant BEFORE
    -- touching the old row, so a refusal leaves the existing assignment untouched.
    select * into v_old from responsibility_assignments
     where id = p_assignment_id and tenant_id = p_tenant;
    if not found then raise exception 'cp_upsert_responsibility: assignment not found in tenant'; end if;
    if v_old.effective_to is not null then
      raise exception 'cp_upsert_responsibility: assignment is already ended';
    end if;
    v_member := coalesce(p_member, v_old.member_id);
    v_cover  := coalesce(p_cover_for, v_old.cover_for);
    if not exists (select 1 from team_members
                    where id = v_member and tenant_id = p_tenant and effective_to is null) then
      raise exception 'cp_upsert_responsibility: successor member is not active in tenant';
    end if;
    if v_cover is not null and not exists
       (select 1 from team_members
         where id = v_cover and tenant_id = p_tenant and effective_to is null) then
      raise exception 'cp_upsert_responsibility: successor cover member is not active in tenant';
    end if;
    v_before := to_jsonb(v_old);
    update responsibility_assignments set effective_to = v_from where id = v_old.id;
    insert into responsibility_assignments
      (tenant_id, member_id, kind, target_ref, label, raci_role, is_shared, weekday_mask,
       cover_for, confirmed, effective_from, version, source)
    values (p_tenant, v_member, coalesce(p_kind, v_old.kind),
       coalesce(p_target_ref, v_old.target_ref), coalesce(p_label, v_old.label),
       coalesce(p_raci, v_old.raci_role), coalesce(p_is_shared, v_old.is_shared),
       coalesce(p_weekday_mask, v_old.weekday_mask), v_cover,
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
       (select 1 from team_members
         where id = p_cover_for and tenant_id = p_tenant and effective_to is null) then
      raise exception 'cp_upsert_responsibility: cover_for member is not active in tenant';
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

-- Defensive re-assertion of the privilege boundary (idempotent).
do $$
begin
  execute 'revoke execute on function cp_upsert_responsibility(uuid,uuid,uuid,text,text,text,text,boolean,int,uuid,boolean,timestamptz,text,text,text,boolean) from public, anon, authenticated';
  execute 'grant execute on function cp_upsert_responsibility(uuid,uuid,uuid,text,text,text,text,boolean,int,uuid,boolean,timestamptz,text,text,text,boolean) to service_role';
end $$;
