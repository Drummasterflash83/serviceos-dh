-- Cover semantics recovered from 20260916120000 jcc_cover_active and
-- 20260918120000 cp_active_cover_for in serviceos-dh. No tenant rows are changed.
create function public.learn_work_cover_day(p_mask int,p_timezone text,p_at timestamptz)
returns boolean language plpgsql stable set search_path=public as $$
declare day_number int;
begin
  if p_mask is null or p_mask=127 then return true; end if;
  if p_mask not between 0 and 127 or p_timezone is null or p_at is null or not isfinite(p_at) then return false; end if;
  if not exists(select 1 from pg_timezone_names where name=p_timezone) then return false; end if;
  day_number:=extract(isodow from p_at at time zone p_timezone)::int;
  return ((p_mask >> (day_number-1)) & 1)=1;
end $$;

create function public.learn_work_authority(p_tenant uuid,p_object uuid,p_actor uuid,p_target_member uuid default null,p_claim boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  o intelligence_objects%rowtype; actor_profile profiles%rowtype;
  actor_member uuid; matches uuid[]; owners uuid[]:='{}'; teams uuid[]:='{}';
  reference jsonb; owner_member uuid; owner_team uuid; target_team uuid;
  at_time timestamptz; tz text; owner_count int:=0; unresolved boolean:=false;
  direct_owner boolean:=false; via_cover boolean:=false; grant_row authority_grants%rowtype;
  permissions text[]:='{}'; used_grants uuid[]:='{}'; used_cover uuid[]:='{}';
begin
  perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
  at_time:=clock_timestamp();
  select * into actor_profile from profiles where id=p_actor and tenant_id=p_tenant for share;
  if not found or coalesce(actor_profile.role,'') not in ('owner','admin','ops','viewer') then
    raise exception 'Authorized tenant profile required' using errcode='42501';
  end if;
  if exists(select 1 from view_as_context where actor_user_id=p_actor and ended_at is null
      and (expires_at is null or expires_at>at_time)) then
    raise exception 'Exit View-As before changing work' using errcode='42501';
  end if;
  select * into o from intelligence_objects where id=p_object and tenant_id=p_tenant;
  if not found then raise exception 'Tenant work item required' using errcode='P0002'; end if;
  select array_agg(id) into matches from team_members where tenant_id=p_tenant and profile_id=p_actor
    and confirmed_at is not null and effective_from<=at_time and (effective_to is null or effective_to>at_time);
  if cardinality(matches)>1 then raise exception 'Ambiguous active member identity' using errcode='42501'; end if;
  actor_member:=matches[1];
  if actor_profile.role='viewer' and actor_member is null then
    raise exception 'Confirmed staff membership required for work self-service' using errcode='42501';
  end if;
  -- RACI owners only. A waiting-on reference is not authority to move this work.
  for reference in select value from jsonb_array_elements(jsonb_build_array(o.responsible_ref,o.accountable_ref)) loop
    if reference='null'::jsonb then continue; end if;
    owner_count:=owner_count+1; owner_member:=null; owner_team:=null;
    if reference->>'kind'='user' and (reference->>'ref'=p_actor::text
       or (length(actor_profile.email)>0 and reference->>'ref'=actor_profile.email)) then direct_owner:=true; end if;
    if reference->>'kind'='member' then
      select id,org_unit_id into owner_member,owner_team from team_members
        where tenant_id=p_tenant and id::text=reference->>'ref' and confirmed_at is not null
          and effective_from<=at_time and (effective_to is null or effective_to>at_time);
      if owner_member=actor_member then direct_owner:=true; end if;
    elsif reference->>'kind'='user' then
      -- Legacy email references remain usable by their direct owner, but cannot
      -- establish another person's team or cover authority by name/email matching.
      select array_agg(id) into matches from team_members where tenant_id=p_tenant
        and profile_id::text=reference->>'ref' and confirmed_at is not null
        and exists(select 1 from profiles where id=team_members.profile_id and tenant_id=p_tenant)
        and effective_from<=at_time and (effective_to is null or effective_to>at_time);
      if cardinality(matches)=1 then
        owner_member:=matches[1]; select org_unit_id into owner_team from team_members where id=owner_member;
      end if;
    elsif reference->>'kind' in ('team','org_unit') then
      select id into owner_team from org_units where tenant_id=p_tenant and id::text=reference->>'ref';
    end if;
    if owner_member is not null then owners:=array_append(owners,owner_member); end if;
    if owner_team is null or not exists(select 1 from org_units where id=owner_team and tenant_id=p_tenant) then
      unresolved:=true;
    else teams:=array_append(teams,owner_team); end if;
  end loop;
  if p_claim then p_target_member:=actor_member; end if;
  if p_target_member is not null then
    select org_unit_id into target_team from team_members where id=p_target_member and tenant_id=p_tenant
      and confirmed_at is not null and effective_from<=at_time and (effective_to is null or effective_to>at_time);
    if not found then raise exception 'Active confirmed tenant assignment target required' using errcode='22023'; end if;
  end if;
  select nullif(btrim(metadata->>'timezone'),'') into tz from tenants where id=p_tenant;
  if not direct_owner and actor_member is not null then
    select array_agg(id) into used_cover from responsibility_assignments where tenant_id=p_tenant
      and member_id=actor_member and kind='cover' and cover_for=any(owners) and confirmed
      and raci_role in ('responsible','accountable') and effective_from<=at_time
      and (effective_to is null or effective_to>at_time)
      and learn_work_cover_day(weekday_mask,tz,at_time);
    via_cover:=coalesce(cardinality(used_cover)>0,false);
  end if;
  if actor_member is not null then
    for grant_row in select * from authority_grants where tenant_id=p_tenant and member_id=actor_member
      and confirmed and effective_from<=at_time and (effective_to is null or effective_to>at_time)
      and permission in ('work.assign','work.approve','ownership.confirm','tenant.superadmin') for share loop
      if (grant_row.scope='company' and nullif(grant_row.scope_ref,'') is null)
        or (grant_row.permission<>'tenant.superadmin' and grant_row.scope='self' and direct_owner
          and nullif(grant_row.scope_ref,'') is null and (p_target_member is null or p_target_member=actor_member))
        or (grant_row.permission<>'tenant.superadmin' and grant_row.scope='team' and owner_count>0
          and not unresolved and cardinality(teams)=owner_count
          and not exists(select 1 from unnest(teams) t where t::text<>grant_row.scope_ref)
          and grant_row.scope_ref is not null
          and (p_target_member is null or target_team::text=grant_row.scope_ref)) then
        permissions:=array_append(permissions,grant_row.permission);
        used_grants:=array_append(used_grants,grant_row.id);
      end if;
    end loop;
  end if;
  return jsonb_build_object('contract','work-authority@1','tenantId',p_tenant,'objectId',p_object,'actorId',p_actor,
    'objectVersion',o.version,'memberId',actor_member,'directOwner',direct_owner,'viaCover',via_cover,
    'isAssignee',direct_owner or via_cover,'isSuperadmin','tenant.superadmin'=any(permissions),
    'canAssign','work.assign'=any(permissions),'canApprove','work.approve'=any(permissions),
    'canConfirmOwnership','ownership.confirm'=any(permissions),'canClaimUnassigned',actor_member is not null,
    'canAcceptAssigned',direct_owner or 'work.assign'=any(permissions) or 'tenant.superadmin'=any(permissions),
    'grantIds',to_jsonb(used_grants),'coverIds',to_jsonb(coalesce(used_cover,'{}'::uuid[])));
end $$;
revoke all on function public.learn_work_cover_day(int,text,timestamptz),
  public.learn_work_authority(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_authority(uuid,uuid,uuid,uuid,boolean) to service_role;

-- Recheck authority under the work lock immediately before persistence.
create or replace function public.work_transition_apply(
  p_tenant uuid, p_object uuid, p_expected_version int,
  p_to_status text, p_patch jsonb, p_history jsonb, p_objective jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_obj intelligence_objects%rowtype;
  v_after intelligence_objects%rowtype;
  v_history uuid;
  v_actor uuid;
  v_verb text;
  v_ref jsonb;
  v_now timestamptz;
  v_authority jsonb; v_target uuid; v_allowed boolean;
begin
  if p_expected_version is null or p_expected_version < 1
     or p_patch is null or jsonb_typeof(p_patch)<>'object'
     or p_history is null or jsonb_typeof(p_history)<>'object'
     or p_to_status is null then
    raise exception 'Version, patch, history and target status required' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_patch) k where k not in
    ('responsible_ref','accountable_ref','waiting_on_ref','attributes')) then
    raise exception 'Unsupported work patch' using errcode='22023';
  end if;
  v_actor := (p_history->'actor'->>'user_id')::uuid;
  v_verb := p_history->>'verb';
  if v_actor is null or not exists(select 1 from profiles where id=v_actor and tenant_id=p_tenant
      and role in ('owner','admin','ops','viewer')) then
    raise exception 'Work actor must be an authorized tenant profile' using errcode='42501';
  end if;
  if v_verb is null or v_verb not in ('acknowledge','start','wait','resume','block','unblock',
      'escalate','complete','dismiss','accept','assign','correct_owner','correct_objective') then
    raise exception 'Known work verb required' using errcode='22023';
  end if;
  if exists(select 1 from view_as_context where actor_user_id=v_actor and ended_at is null
      and (expires_at is null or expires_at>clock_timestamp())) then
    raise exception 'Exit View-As before changing work' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
  select * into v_obj from intelligence_objects where id=p_object and tenant_id=p_tenant for update;
  if not found then raise exception 'Work item not found in tenant' using errcode='P0002'; end if;
  if v_obj.version <> p_expected_version then
    raise exception 'Work version changed; refresh before retrying' using errcode='P0409';
  end if;
  v_target:=case v_verb when 'assign' then (p_patch#>>'{responsible_ref,ref}')::uuid
    when 'correct_owner' then (p_patch#>>'{accountable_ref,ref}')::uuid else null end;
  v_authority:=learn_work_authority(p_tenant,p_object,v_actor,v_target,v_verb='accept');
  v_allowed:=coalesce((v_authority->>'isSuperadmin')::boolean,false);
  if v_verb='assign' then v_allowed:=v_allowed or (v_authority->>'canAssign')::boolean;
  elsif v_verb in ('correct_owner','correct_objective') then
    v_allowed:=v_allowed or (v_authority->>'canConfirmOwnership')::boolean;
  elsif v_verb='accept' and coalesce(v_obj.responsible_ref->>'ref','')=''
      and coalesce(v_obj.accountable_ref->>'ref','')='' then
    v_allowed:=(v_authority->>'canClaimUnassigned')::boolean;
  elsif v_verb='accept' then v_allowed:=(v_authority->>'canAcceptAssigned')::boolean;
  else v_allowed:=v_allowed or (v_authority->>'isAssignee')::boolean or (v_authority->>'canAssign')::boolean;
  end if;
  if not coalesce(v_allowed,false) then raise exception 'Work authority changed or does not cover this item' using errcode='42501'; end if;
  if v_verb='accept' and (p_patch->'responsible_ref' is distinct from jsonb_build_object('kind','user','ref',v_actor::text)) then
    raise exception 'Accept may only claim for the authenticated actor' using errcode='22023';
  end if;
  if v_verb='complete' and length(btrim(coalesce(v_obj.attributes->>'done_when','')))=0
    and not (coalesce((p_history->>'approved_exception')::boolean,false)
      and ((v_authority->>'canApprove')::boolean or (v_authority->>'isSuperadmin')::boolean)) then
    raise exception 'Completion exception authority is not established' using errcode='42501';
  end if;
  -- Persist the database's final authority decision, never a stale client label.
  p_history:=jsonb_set(p_history,'{actor}',coalesce(p_history->'actor','{}'::jsonb)||jsonb_build_object(
    'user_id',v_actor,'member_id',v_authority->'memberId','superadmin',v_authority->'isSuperadmin',
    'acted_via',case when (v_authority->>'viaCover')::boolean then 'cover' else 'direct_or_grant' end,
    'authority_grant_ids',v_authority->'grantIds','cover_assignment_ids',v_authority->'coverIds'));
  if coalesce(v_obj.object_class,'') <> 'action' and not exists(
      select 1 from domain_object_types where domain=v_obj.domain
        and object_type=v_obj.object_type and object_class='action') then
    raise exception 'Only action work items may transition here' using errcode='22023';
  end if;
  if p_to_status<>v_obj.status and not exists(select 1 from state_transitions
      where domain=v_obj.domain and object_type=v_obj.object_type
        and from_state=v_obj.status and to_state=p_to_status) then
    raise exception 'Illegal work state transition' using errcode='22023';
  end if;
  -- Resolve new ownership targets in this tenant; never accept a foreign member
  -- or a name-only assignment. Existing legacy refs are retained in snapshots.
  for v_ref in select value from jsonb_each(p_patch)
      where key in ('responsible_ref','accountable_ref') loop
    if jsonb_typeof(v_ref)<>'object' then
      raise exception 'Ownership target must be a canonical reference' using errcode='22023';
    end if;
    if v_ref->>'kind'='member' then
      if not exists(select 1 from team_members where id=(v_ref->>'ref')::uuid and tenant_id=p_tenant
          and effective_from<=clock_timestamp() and (effective_to is null or effective_to>clock_timestamp())
          and confirmed_at is not null) then
        raise exception 'Ownership target must be an active confirmed tenant member' using errcode='22023';
      end if;
    elsif v_ref->>'kind'='user' then
      if not exists(select 1 from profiles where id=(v_ref->>'ref')::uuid and tenant_id=p_tenant) then
        raise exception 'Ownership user must belong to tenant' using errcode='22023';
      end if;
    else
      raise exception 'Unsupported ownership reference' using errcode='22023';
    end if;
  end loop;
  if p_patch ? 'attributes' and jsonb_typeof(p_patch->'attributes')<>'object' then
    raise exception 'Attributes must be an object' using errcode='22023';
  end if;
  if p_objective is not null and (jsonb_typeof(p_objective)<>'object' or not exists(
      select 1 from objectives where id=(p_objective->>'objective_id')::uuid and tenant_id=p_tenant)) then
    raise exception 'Objective must belong to tenant' using errcode='22023';
  end if;
  update intelligence_objects set
    status=p_to_status,
    responsible_ref=case when p_patch?'responsible_ref' then p_patch->'responsible_ref' else responsible_ref end,
    accountable_ref=case when p_patch?'accountable_ref' then p_patch->'accountable_ref' else accountable_ref end,
    waiting_on_ref=case when p_patch?'waiting_on_ref' then p_patch->'waiting_on_ref' else waiting_on_ref end,
    attributes=case when p_patch?'attributes' then p_patch->'attributes' else attributes end,
    version=version+1
    where id=p_object returning * into v_after;
  v_now := clock_timestamp();
  insert into object_state_history(tenant_id,object_id,from_state,to_state,actor,reason,
      occurred_at,transition_verb,work_before,work_after)
    values(p_tenant,p_object,v_obj.status,v_after.status,p_history->'actor',p_history->>'reason',v_now,v_verb,
      jsonb_build_object('status',v_obj.status,'version',v_obj.version,
        'responsible_ref',v_obj.responsible_ref,'accountable_ref',v_obj.accountable_ref,
        'waiting_on_ref',v_obj.waiting_on_ref,'attributes',v_obj.attributes),
      jsonb_build_object('status',v_after.status,'version',v_after.version,
        'responsible_ref',v_after.responsible_ref,'accountable_ref',v_after.accountable_ref,
        'waiting_on_ref',v_after.waiting_on_ref,'attributes',v_after.attributes))
    returning id into v_history;
  if p_objective is not null then
    insert into objective_links(tenant_id,objective_id,target_kind,target_ref,relation,rationale,created_by,approved)
      values(p_tenant,(p_objective->>'objective_id')::uuid,'intelligence_object',p_object::text,
        p_objective->>'relation',p_objective->>'rationale',v_actor::text,
        (v_authority->>'isSuperadmin')::boolean);
  end if;
  return jsonb_build_object('object_id',p_object,'version',v_after.version,
    'history_id',v_history,'status',v_after.status,'occurred_at',v_now);
end $$;
revoke all on function public.work_transition_apply(uuid,uuid,int,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.work_transition_apply(uuid,uuid,int,text,jsonb,jsonb,jsonb) to service_role;
