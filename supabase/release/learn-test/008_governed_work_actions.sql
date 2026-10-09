-- Generated TEST-only governed work actions. No source backfill or tenant grants.
begin;
set local search_path=public,pg_temp;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations,domain_object_types,state_definitions,state_transitions,authority_permissions in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target/checksum required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_work_capture_collectors_v1' and source_sha256='d70e2cab5866488310f0907c203fb11796dc175ad3223640d3a2ecd437f64ff5' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Verified work capture prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='learn_governed_work_actions_v1') then raise exception 'Action release already exists';end if;
 if to_regclass('public.object_classes') is not null or exists(select 1 from domain_object_types)
 or exists(select 1 from state_definitions) or exists(select 1 from state_transitions) then raise exception 'Action registry baseline differs';end if;
 if (select jsonb_agg(to_jsonb(p) order by permission) from authority_permissions p) is distinct from $permissions$[{"category":"agent","permission":"agent.activate","description":"Activate / deactivate an agent"},{"category":"agent","permission":"agent.approve_action","description":"Approve a proposed agent action"},{"category":"agent","permission":"agent.assign","description":"Assign agents to users / teams / roles"},{"category":"agent","permission":"agent.configure","description":"Configure agent behaviour"},{"category":"agent","permission":"agent.correct","description":"Correct agent output / provide context"},{"category":"agent","permission":"agent.create","description":"Create an agent"},{"category":"agent","permission":"agent.interact","description":"Interact with an assigned agent"},{"category":"agent","permission":"agent.pause","description":"Pause an agent"},{"category":"agent","permission":"agent.retire","description":"Retire an agent"},{"category":"agent","permission":"agent.set_access","description":"Change tools / data access"},{"category":"agent","permission":"agent.set_autonomy","description":"Change autonomy level"},{"category":"agent","permission":"agent.view","description":"View assigned agents"},{"category":"strategy","permission":"objective.publish","description":"Publish / activate objectives"},{"category":"strategy","permission":"ownership.confirm","description":"Confirm roles / ownership"},{"category":"work","permission":"work.approve","description":"Approve work / actions within authority"},{"category":"work","permission":"work.assign","description":"Assign work to others"}]$permissions$::jsonb then raise exception 'Permission vocabulary differs';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['learn_work_cover_day','learn_work_authority','work_transition_apply'])) then raise exception 'Action function already exists';end if;
end $$;
-- SOURCE 20260717120000_action_loop.sql
-- Original SHA-256 d1f3a5bb4c15405e0eecb0939b20e9a9cc4410f14e524895e5cee7a8d007f22e
create table if not exists object_classes (
  class       text primary key,
  label       text not null,
  description text
);
insert into object_classes (class, label, description) values
  ('observation','Observation','A sensed fact — something that happened or is true'),
  ('action','Action','Work to be done'),
  ('insight','Insight','A derived recommendation, opportunity or assessment'),
  ('issue','Issue','A problem requiring resolution'),
  ('relationship','Relationship','A connection between entities'),
  ('unknown','Unknown','Unclassified')
on conflict (class) do nothing;

-- ── Taxonomy columns + learning pointer (nullable ⇒ FK validates non-null). ─
alter table intelligence_objects add column if not exists object_class    text;
alter table domain_object_types  add column if not exists object_class    text;
create index if not exists io_class on intelligence_objects (tenant_id, object_class, status);

-- Enforce the controlled registry (idempotent drop-then-add, like profiles_role_check).
alter table intelligence_objects drop constraint if exists intelligence_objects_object_class_fk;
alter table intelligence_objects add  constraint intelligence_objects_object_class_fk
  foreign key (object_class) references object_classes(class);
alter table domain_object_types  drop constraint if exists domain_object_types_object_class_fk;
alter table domain_object_types  add  constraint domain_object_types_object_class_fk
  foreign key (object_class) references object_classes(class);

alter table object_classes enable row level security;
drop policy if exists object_classes_select on object_classes;
create policy object_classes_select on object_classes for select to authenticated using (true);


-- SOURCE 20260717120100_seed_action_loop.sql
-- Original SHA-256 bdb1ae61e569de8ed0ae88a0520eb0d1eff7314035c9e1dbc5fee58286890f54
insert into domain_object_types(domain,object_type,label,object_class) values
 ('serviceos','Action','Action','action'),('productos','Action','Action','action');
insert into state_definitions (domain, object_type, state, maps_to_universal, is_terminal) values
  ('serviceos','Action','proposed','ready',false),
  ('serviceos','Action','ready','ready',false),
  ('serviceos','Action','in_progress','monitoring',false),
  ('serviceos','Action','waiting','waiting',false),
  ('serviceos','Action','blocked','blocked',false),
  ('serviceos','Action','escalated','escalated',false),
  ('serviceos','Action','complete','complete',true),
  ('serviceos','Action','cancelled','cancelled',true),
  ('productos','Action','proposed','ready',false),
  ('productos','Action','ready','ready',false),
  ('productos','Action','in_progress','monitoring',false),
  ('productos','Action','waiting','waiting',false),
  ('productos','Action','blocked','blocked',false),
  ('productos','Action','escalated','escalated',false),
  ('productos','Action','complete','complete',true),
  ('productos','Action','cancelled','cancelled',true)
on conflict (domain, object_type, state) do nothing;

insert into state_transitions (domain, object_type, from_state, to_state) values
  ('serviceos','Action','proposed','ready'),
  ('serviceos','Action','ready','in_progress'),
  ('serviceos','Action','in_progress','waiting'),
  ('serviceos','Action','waiting','in_progress'),
  ('serviceos','Action','in_progress','blocked'),
  ('serviceos','Action','blocked','escalated'),
  ('serviceos','Action','in_progress','complete'),
  ('serviceos','Action','ready','cancelled'),
  ('productos','Action','proposed','ready'),
  ('productos','Action','ready','in_progress'),
  ('productos','Action','in_progress','waiting'),
  ('productos','Action','waiting','in_progress'),
  ('productos','Action','in_progress','blocked'),
  ('productos','Action','blocked','escalated'),
  ('productos','Action','in_progress','complete'),
  ('productos','Action','ready','cancelled')
on conflict (domain, object_type, from_state, to_state) do nothing;


-- SOURCE 20260819120000_view_as_and_superadmin.sql
-- Original SHA-256 36a7a07fa4eba872180e643f09dcaa972dad70ee4c3bfacd52490ccfbc225814
insert into authority_permissions (permission, category, description) values
  ('tenant.superadmin','authority',
   'Tenant Superadmin — full tenant-scoped governance authority (publish strategy, define/confirm roles & ownership, govern agents, open View-As). Distinct from platform/openfolk.')
on conflict (permission) do nothing;

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

-- SOURCE 20261029210000_learn_work_scoped_authority.sql
-- Original SHA-256 903f04817334ecbd88736ebba939e11aa7dc4d4e60561c77bec380829fd8290f
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

-- SOURCE 20261030070000_learn_work_action_validation.sql
-- Original SHA-256 b09ca1b9dc00d8b2b5f2db50d065b8d032de862c26e177cebad1f0b59b6d0514
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

revoke all on public.object_classes from public,anon,authenticated,service_role;
grant select on public.object_classes to authenticated;
grant select,insert,update,delete on public.object_classes to service_role;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'learn_governed_work_actions_v1','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
