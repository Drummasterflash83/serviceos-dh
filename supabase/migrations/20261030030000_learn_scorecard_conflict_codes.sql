-- Business conflicts return HTTP 409 without automatic serialization retries.
-- Keep authorization, revision locking, publication history and privileges unchanged.
CREATE OR REPLACE FUNCTION public.learn_scorecard_publish(p_tenant uuid, p_policy uuid, p_revision integer, p_request uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare actor uuid:=auth.uid(); e operating_profile_entries%rowtype; c config_versions%rowtype;
 prior learn_scorecard_publications%rowtype; latest int; effective timestamptz; snapshot jsonb;
 v_kind text; v_group uuid; m jsonb; v_keys text[]:='{}'; v_weight numeric:=0;
begin
 if actor is null or p_tenant is distinct from current_tenant_id() then
   raise exception 'Owner/admin access required' using errcode='42501'; end if;
 perform 1 from profiles where id=actor and tenant_id=p_tenant and role in ('owner','admin') for share;
 if not found or exists(select 1 from view_as_context where actor_user_id=actor and ended_at is null
   and (expires_at is null or expires_at>clock_timestamp())) then
   raise exception 'Owner/admin access outside View-As required' using errcode='42501'; end if;
 if p_policy is null or p_request is null or p_revision is null or p_revision<1
   or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
   raise exception 'Saved revision and publication reason required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-scorecard-publish:'||p_request::text,0));
 select * into prior from learn_scorecard_publications where id=p_request;
 if found then
   if prior.tenant_id<>p_tenant or prior.policy_id<>p_policy or prior.revision<>p_revision
     or prior.published_by<>actor or prior.reason<>btrim(p_reason) then
     raise exception 'Publication request identity changed' using errcode='PT409'; end if;
   return jsonb_build_object('publicationId',prior.id,'policyId',prior.policy_id,'revision',prior.revision,
     'effectiveFrom',prior.effective_from,'reused',true);
 end if;
 select * into e from operating_profile_entries where tenant_id=p_tenant and namespace='learn_scorecards'
   and scope_kind='tenant' and key like 'definition.%' and value->>'id'=p_policy::text and value->>'version'=p_revision::text;
 if not found then raise exception 'Saved scorecard revision not found' using errcode='22023'; end if;
 -- Same lock as draft saving: publishing a stale editor cannot outrun a new draft.
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':learn_scorecards:'||e.scope_ref,0));
 select * into c from config_versions where id=e.version_id and tenant_id=p_tenant and artifact_kind='learn_scorecard';
 if not found or c.version is distinct from p_revision or c.status is distinct from 'draft'
   or e.value->>'status' is distinct from 'draft'
   or e.value->>'tenantId' is distinct from p_tenant::text then
   raise exception 'Saved draft and configuration revision differ' using errcode='22023'; end if;
 v_kind:=e.value->>'subjectKind';
  if v_kind is null or v_kind not in ('member','team','job','customer')
     or jsonb_typeof(e.value->'name') is distinct from 'string'
     or length(trim(e.value->>'name')) not between 1 and 200
     or jsonb_typeof(e.value->'scaleMax') is distinct from 'number'
     or (e.value->>'scaleMax')::numeric <= 0 or (e.value->>'scaleMax')::numeric > 10000
     or jsonb_typeof(e.value->'metrics') is distinct from 'array' then
    raise exception 'Invalid scorecard definition' using errcode='22023';
  end if;
  if jsonb_array_length(e.value->'metrics') not between 1 and 50 then
    raise exception 'Choose between 1 and 50 measures' using errcode='22023';
  end if;
  v_group := nullif(e.value->>'groupId','')::uuid;
  if v_group is not null and (v_kind not in ('member','team') or not exists
    (select 1 from org_units where tenant_id=p_tenant and id=v_group)) then
    raise exception 'Unknown company team group' using errcode='22023';
  end if;
  for m in select value from jsonb_array_elements(e.value->'metrics') loop
    if jsonb_typeof(m) is distinct from 'object'
       or coalesce(m->>'key','') !~ '^[a-z][a-z0-9_.-]+$' or length(m->>'key') > 200
       or (m->>'key')=any(v_keys)
       or jsonb_typeof(m->'label') is distinct from 'string' or length(trim(m->>'label')) not between 1 and 200
       or jsonb_typeof(m->'unit') is distinct from 'string' or length(trim(m->>'unit')) not between 1 and 200
       or jsonb_typeof(m->'weight') is distinct from 'number'
       or jsonb_typeof(m->'zeroAt') is distinct from 'number'
       or jsonb_typeof(m->'fullAt') is distinct from 'number'
       or jsonb_typeof(m->'minSamples') is distinct from 'number'
       or jsonb_typeof(m->'minCoverage') is distinct from 'number'
       or jsonb_typeof(m->'maxAgeHours') is distinct from 'number'
       or jsonb_typeof(m->'sourceSystems') is distinct from 'array' then
      raise exception 'Invalid scoring measure' using errcode='22023';
    end if;
    if (m->>'weight')::numeric not between 0 and 10000
       or (m->>'zeroAt')::numeric = (m->>'fullAt')::numeric
       or (m->>'minSamples')::numeric < 1 or mod((m->>'minSamples')::numeric,1) <> 0
       or (m->>'minCoverage')::numeric <= 0 or (m->>'minCoverage')::numeric > 1
       or (m->>'maxAgeHours')::numeric <= 0
       or jsonb_array_length(m->'sourceSystems') not between 1 and 20
       or exists(select 1 from jsonb_array_elements(m->'sourceSystems') s where jsonb_typeof(s) <> 'string' or length(trim(s #>> '{}')) not between 1 and 200) then
      raise exception 'Invalid scoring targets, evidence requirements or weights' using errcode='22023';
    end if;
    v_keys := array_append(v_keys,m->>'key');
    v_weight := v_weight + (m->>'weight')::numeric;
  end loop;
  if v_weight <= 0 then raise exception 'At least one measure needs positive weight' using errcode='22023'; end if;

 if e.scope_ref is distinct from v_kind||':'||coalesce(v_group::text,'all') then
   raise exception 'Saved rule scope is inconsistent' using errcode='22023'; end if;
 select max(v.version) into latest from operating_profile_entries x join config_versions v on v.id=x.version_id and v.tenant_id=x.tenant_id
   where x.tenant_id=p_tenant and x.namespace='learn_scorecards' and x.scope_kind='tenant'
   and x.scope_ref=e.scope_ref and x.key like 'definition.%' and v.artifact_kind='learn_scorecard';
 if latest is distinct from p_revision or exists(select 1 from learn_scorecard_publications where version_id=e.version_id) then
   raise exception 'Rules changed or this revision is already published; reload' using errcode='PT409'; end if;
 effective:=clock_timestamp();
 if exists(select 1 from learn_scorecard_publications where tenant_id=p_tenant and scope=e.scope_ref and effective_from>=effective) then
   raise exception 'Publication clock must advance' using errcode='PT409'; end if;
 snapshot:=e.value||jsonb_build_object('status','published');
 insert into learn_scorecard_publications(id,tenant_id,version_id,policy_id,revision,scope,published_by,effective_from,reason,policy)
 values(p_request,p_tenant,e.version_id,p_policy,p_revision,e.scope_ref,actor,effective,btrim(p_reason),snapshot);
 return jsonb_build_object('publicationId',p_request,'policyId',p_policy,'revision',p_revision,'effectiveFrom',effective,'reused',false);
end $function$
;
CREATE OR REPLACE FUNCTION public.learn_scorecard_save_draft(p_tenant_id uuid, p_expected_version integer, p_definition jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_kind text := p_definition->>'subjectKind';
  v_group uuid;
  v_scope text;
  v_previous jsonb;
  v_previous_version uuid;
  v_revision integer;
  v_policy uuid;
  v_version uuid := gen_random_uuid();
  v_payload jsonb;
  m jsonb;
  v_keys text[] := '{}';
  v_weight numeric := 0;
begin
  if auth.uid() is null or p_tenant_id is distinct from current_tenant_id()
     or coalesce(current_user_role(),'') not in ('owner','admin')
     or exists(select 1 from public.view_as_context where actor_user_id=auth.uid()
       and ended_at is null and (expires_at is null or expires_at>now())) then
    raise exception 'Only this company owner or admin may save scoring rules' using errcode='42501';
  end if;
  if p_expected_version is null or p_expected_version < 0 or nullif(trim(p_reason),'') is null
     or length(p_reason) > 1000 or jsonb_typeof(p_definition) is distinct from 'object' then
    raise exception 'Invalid draft request' using errcode='22023';
  end if;
  if v_kind is null or v_kind not in ('member','team','job','customer')
     or jsonb_typeof(p_definition->'name') is distinct from 'string'
     or length(trim(p_definition->>'name')) not between 1 and 200
     or jsonb_typeof(p_definition->'scaleMax') is distinct from 'number'
     or (p_definition->>'scaleMax')::numeric <= 0 or (p_definition->>'scaleMax')::numeric > 10000
     or jsonb_typeof(p_definition->'metrics') is distinct from 'array' then
    raise exception 'Invalid scorecard definition' using errcode='22023';
  end if;
  if jsonb_array_length(p_definition->'metrics') not between 1 and 50 then
    raise exception 'Choose between 1 and 50 measures' using errcode='22023';
  end if;
  v_group := nullif(p_definition->>'groupId','')::uuid;
  if v_group is not null and (v_kind not in ('member','team') or not exists
    (select 1 from org_units where tenant_id=p_tenant_id and id=v_group)) then
    raise exception 'Unknown company team group' using errcode='22023';
  end if;
  for m in select value from jsonb_array_elements(p_definition->'metrics') loop
    if jsonb_typeof(m) is distinct from 'object'
       or coalesce(m->>'key','') !~ '^[a-z][a-z0-9_.-]+$' or length(m->>'key') > 200
       or (m->>'key')=any(v_keys)
       or jsonb_typeof(m->'label') is distinct from 'string' or length(trim(m->>'label')) not between 1 and 200
       or jsonb_typeof(m->'unit') is distinct from 'string' or length(trim(m->>'unit')) not between 1 and 200
       or jsonb_typeof(m->'weight') is distinct from 'number'
       or jsonb_typeof(m->'zeroAt') is distinct from 'number'
       or jsonb_typeof(m->'fullAt') is distinct from 'number'
       or jsonb_typeof(m->'minSamples') is distinct from 'number'
       or jsonb_typeof(m->'minCoverage') is distinct from 'number'
       or jsonb_typeof(m->'maxAgeHours') is distinct from 'number'
       or jsonb_typeof(m->'sourceSystems') is distinct from 'array' then
      raise exception 'Invalid scoring measure' using errcode='22023';
    end if;
    if (m->>'weight')::numeric not between 0 and 10000
       or (m->>'zeroAt')::numeric = (m->>'fullAt')::numeric
       or (m->>'minSamples')::numeric < 1 or mod((m->>'minSamples')::numeric,1) <> 0
       or (m->>'minCoverage')::numeric <= 0 or (m->>'minCoverage')::numeric > 1
       or (m->>'maxAgeHours')::numeric <= 0
       or jsonb_array_length(m->'sourceSystems') not between 1 and 20
       or exists(select 1 from jsonb_array_elements(m->'sourceSystems') s where jsonb_typeof(s) <> 'string' or length(trim(s #>> '{}')) not between 1 and 200) then
      raise exception 'Invalid scoring targets, evidence requirements or weights' using errcode='22023';
    end if;
    v_keys := array_append(v_keys,m->>'key');
    v_weight := v_weight + (m->>'weight')::numeric;
  end loop;
  if v_weight <= 0 then raise exception 'At least one measure needs positive weight' using errcode='22023'; end if;
  v_scope := v_kind || ':' || coalesce(v_group::text,'all');
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':learn_scorecards:' || v_scope,0));
  select e.value,e.version_id into v_previous,v_previous_version
    from operating_profile_entries e join config_versions c on c.id=e.version_id and c.tenant_id=e.tenant_id
    where e.tenant_id=p_tenant_id and e.scope_kind='tenant' and e.scope_ref=v_scope
      and e.namespace='learn_scorecards' and e.key like 'definition.%'
    order by c.version desc limit 1;
  v_revision := coalesce((v_previous->>'version')::integer,0);
  if p_expected_version <> v_revision then
    raise exception 'Scoring rules changed; reload before saving' using errcode='PT409';
  end if;
  v_policy := coalesce((v_previous->>'id')::uuid,gen_random_uuid());
  v_payload := jsonb_build_object('tenantId',p_tenant_id,'id',v_policy,'version',v_revision+1,
    'name',trim(p_definition->>'name'),'status','draft','subjectKind',v_kind,'groupId',v_group,
    'scaleMax',p_definition->'scaleMax','metrics',p_definition->'metrics');
  insert into config_versions(id,tenant_id,artifact_kind,artifact_key,version,status,supersedes,author,note)
    values(v_version,p_tenant_id,'learn_scorecard',p_tenant_id::text||':'||v_scope,v_revision+1,'draft',v_previous_version,auth.uid()::text,trim(p_reason));
  insert into operating_profile_entries(tenant_id,scope_kind,scope_ref,namespace,key,value,version_id)
    values(p_tenant_id,'tenant',v_scope,'learn_scorecards','definition.'||v_version::text,v_payload,v_version);
  return v_payload;
end;
$function$
;
