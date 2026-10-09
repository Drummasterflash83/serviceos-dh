-- Recheck verb, evidence and configured transition conditions at persistence.
-- No source rows, grants or historical captures are rewritten.
alter function public.learn_work_cover_day(int,text,timestamptz) set search_path=public,pg_temp;
alter function public.learn_work_authority(uuid,uuid,uuid,uuid,boolean) set search_path=public,pg_temp;

create or replace function public.work_transition_apply(
  p_tenant uuid, p_object uuid, p_expected_version int,
  p_to_status text, p_patch jsonb, p_history jsonb, p_objective jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
        and from_state=v_obj.status and to_state=p_to_status and guard is null) then
    raise exception 'Illegal or unsupported guarded work state transition' using errcode='22023';
  end if;
  -- The service RPC repeats the endpoint's verb/effect boundary. An allowed
  -- state edge is not permission to disguise reassignment or missing evidence.
  if p_to_status is distinct from (case v_verb
      when 'acknowledge' then 'ready' when 'start' then 'in_progress'
      when 'wait' then 'waiting' when 'resume' then 'in_progress'
      when 'block' then 'blocked' when 'unblock' then 'in_progress'
      when 'escalate' then 'escalated' when 'complete' then 'complete'
      when 'dismiss' then 'cancelled'
      when 'accept' then case when v_obj.status='proposed' then 'ready' else v_obj.status end
      else v_obj.status end) then
    raise exception 'Work verb and target status disagree' using errcode='22023';
  end if;
  if v_verb in ('acknowledge','start','wait','resume','block','unblock','escalate','complete','dismiss')
      and p_to_status=v_obj.status then
    raise exception 'Work status already reached' using errcode='P0409';
  end if;
  if exists(select 1 from jsonb_object_keys(p_patch) k where not (k=any(case v_verb
      when 'accept' then array['responsible_ref']
      when 'assign' then array['responsible_ref']
      when 'correct_owner' then array['accountable_ref','attributes']
      when 'wait' then array['waiting_on_ref']
      when 'block' then array['attributes']
      when 'complete' then array['attributes'] else array[]::text[] end))) then
    raise exception 'Patch does not match work verb' using errcode='22023';
  end if;
  if v_verb in ('assign','correct_owner') and
      (v_target is null or (case v_verb when 'assign' then p_patch->'responsible_ref'
          else p_patch->'accountable_ref' end)->>'kind' is distinct from 'member') then
    raise exception 'Assignment requires a canonical member target' using errcode='22023';
  end if;
  if v_verb in ('dismiss','correct_owner','correct_objective')
      and length(btrim(coalesce(p_history->>'reason','')))=0 then
    raise exception 'Work reason required' using errcode='22023';
  end if;
  if p_patch ? 'attributes' and
      (p_patch->'attributes') - (case v_verb when 'block' then 'blocker'
          when 'complete' then 'completion_evidence' else 'owner_corrections' end)
      is distinct from v_obj.attributes - (case v_verb when 'block' then 'blocker'
          when 'complete' then 'completion_evidence' else 'owner_corrections' end) then
    raise exception 'Unrelated work attributes must be preserved' using errcode='22023';
  end if;
  if (v_verb='wait' and (p_patch#>>'{waiting_on_ref,kind}' is distinct from 'note'
        or length(btrim(coalesce(p_patch#>>'{waiting_on_ref,ref}','')))=0))
      or (v_verb='block' and (coalesce(p_patch#>'{attributes,blocker}','null'::jsonb)='null'::jsonb
        or length(btrim(coalesce(p_patch#>>'{attributes,blocker}','')))=0))
      or (v_verb='complete' and length(btrim(coalesce(v_obj.attributes->>'done_when','')))>0
        and (coalesce(p_patch#>'{attributes,completion_evidence}','null'::jsonb)='null'::jsonb
          or length(btrim(coalesce(p_patch#>>'{attributes,completion_evidence}','')))=0)) then
    raise exception 'Work evidence required' using errcode='22023';
  end if;
  if (v_verb='correct_objective') is distinct from (p_objective is not null)
      or (p_objective is not null and (p_objective->>'relation' is distinct from 'contributes_to'
        or length(btrim(coalesce(p_objective->>'rationale','')))=0)) then
    raise exception 'Objective correction requires its own explicit relation and reason' using errcode='22023';
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
