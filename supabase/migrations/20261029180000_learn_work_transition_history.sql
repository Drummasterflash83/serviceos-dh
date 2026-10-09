-- Extend the existing work ledger, preserving every historical row. Atomic
-- persistence is adapted from serviceos-dh commit 27eb4ad's work_transition_apply.
-- Old rows have NULL snapshots: they do not prove historical ownership intervals.
alter table public.object_state_history
  add column work_before jsonb,
  add column work_after jsonb,
  add column transition_verb text;
alter table public.object_state_history add constraint osh_work_snapshot_pair check (
  (work_before is null and work_after is null and transition_verb is null) or
  (work_before is not null and work_after is not null
    and jsonb_typeof(work_before) = 'object' and jsonb_typeof(work_after) = 'object'
    and work_before ?& array['status','version','responsible_ref','accountable_ref','waiting_on_ref','attributes']
    and work_after ?& array['status','version','responsible_ref','accountable_ref','waiting_on_ref','attributes']
    and transition_verb is not null)
);
create index osh_work_snapshot_lookup on public.object_state_history(tenant_id, object_id, occurred_at, id)
  where work_before is not null;

create function public.learn_work_history_immutable() returns trigger
language plpgsql set search_path=public as $$
begin
  if old.work_before is not null or (tg_op='UPDATE' and new.work_before is not null) then
    raise exception 'Structured work history is append-only';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger learn_work_history_immutable before update or delete on public.object_state_history
  for each row execute function public.learn_work_history_immutable();
revoke insert, update, delete, truncate on public.object_state_history from public, anon, authenticated;
revoke truncate on public.object_state_history from service_role;

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
      and role in ('owner','admin','ops')) then
    raise exception 'Work actor must be an authorized tenant profile' using errcode='42501';
  end if;
  if v_verb is null or v_verb not in ('acknowledge','start','wait','resume','block','unblock',
      'escalate','complete','dismiss','accept','assign','correct_owner','correct_objective') then
    raise exception 'Known work verb required' using errcode='22023';
  end if;
  if exists(select 1 from view_as_context where actor_user_id=v_actor and ended_at is null
      and expires_at>clock_timestamp()) then
    raise exception 'Exit View-As before changing work' using errcode='42501';
  end if;
  select * into v_obj from intelligence_objects where id=p_object and tenant_id=p_tenant for update;
  if not found then raise exception 'Work item not found in tenant' using errcode='P0002'; end if;
  if v_obj.version <> p_expected_version then
    raise exception 'Work version changed; refresh before retrying' using errcode='P0409';
  end if;
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
        coalesce((p_objective->>'approved')::boolean,false));
  end if;
  return jsonb_build_object('object_id',p_object,'version',v_after.version,
    'history_id',v_history,'status',v_after.status,'occurred_at',v_now);
end $$;
revoke all on function public.work_transition_apply(uuid,uuid,int,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.work_transition_apply(uuid,uuid,int,text,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.learn_work_history_immutable() from public,anon,authenticated;
