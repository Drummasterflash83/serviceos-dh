-- Prospective publications retain saved draft content; they never rewrite it.
create table public.learn_scorecard_publications (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 version_id uuid not null unique references public.config_versions(id),
 policy_id uuid not null,
 revision integer not null check(revision>0),
 scope text not null,
 published_by uuid not null,
 effective_from timestamptz not null,
 reason text not null check(length(btrim(reason)) between 1 and 1000),
 policy jsonb not null check(jsonb_typeof(policy)='object'),
 unique(tenant_id,policy_id,revision),
 unique(tenant_id,scope,effective_from)
);
alter table public.learn_scorecard_publications enable row level security;
revoke all on public.learn_scorecard_publications from public,anon,authenticated,service_role;
grant select on public.learn_scorecard_publications to authenticated;
create policy learn_scorecard_publications_read on public.learn_scorecard_publications for select to authenticated
 using(tenant_id=current_tenant_id() and coalesce(current_user_role(),'') in ('owner','admin'));
create trigger learn_scorecard_publications_immutable before update or delete on public.learn_scorecard_publications
 for each row execute function public.learn_member_history_immutable();
create trigger learn_scorecard_publications_no_truncate before truncate on public.learn_scorecard_publications
 for each statement execute function public.learn_member_history_immutable();

-- Existing saved revisions must remain identical to their measurements and receipts.
create function public.learn_scorecard_revision_immutable() returns trigger
language plpgsql set search_path=public as $$
begin
 if tg_op='TRUNCATE' then
   if exists(select 1 from config_versions where artifact_kind='learn_scorecard') then
     raise exception 'Retain scorecard revisions; append a new draft' using errcode='55000'; end if;
   return null;
 end if;
 if (tg_table_name='config_versions' and (to_jsonb(old)->>'artifact_kind'='learn_scorecard'
      or (tg_op='UPDATE' and to_jsonb(new)->>'artifact_kind'='learn_scorecard')))
   or (tg_table_name='operating_profile_entries' and (to_jsonb(old)->>'namespace'='learn_scorecards'
      or (tg_op='UPDATE' and to_jsonb(new)->>'namespace'='learn_scorecards'))) then
   raise exception 'Scorecard revisions are immutable; append a new draft' using errcode='55000';
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger learn_scorecard_revision_immutable before update or delete on public.config_versions
 for each row execute function public.learn_scorecard_revision_immutable();
create trigger learn_scorecard_revision_immutable before update or delete on public.operating_profile_entries
 for each row execute function public.learn_scorecard_revision_immutable();
create trigger learn_scorecard_revisions_no_truncate before truncate on public.config_versions
 for each statement execute function public.learn_scorecard_revision_immutable();
create trigger learn_scorecard_entries_no_truncate before truncate on public.operating_profile_entries
 for each statement execute function public.learn_scorecard_revision_immutable();
create unique index learn_scorecard_revision_identity on public.operating_profile_entries
 (tenant_id,(value->>'id'),(value->>'version'))
 where namespace='learn_scorecards' and scope_kind='tenant' and key like 'definition.%';
revoke all on function public.learn_scorecard_revision_immutable() from public,anon,authenticated,service_role;

create function public.learn_scorecard_publish(p_tenant uuid,p_policy uuid,p_revision int,p_request uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
     raise exception 'Publication request identity changed' using errcode='40001'; end if;
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
   raise exception 'Rules changed or this revision is already published; reload' using errcode='40001'; end if;
 effective:=clock_timestamp();
 if exists(select 1 from learn_scorecard_publications where tenant_id=p_tenant and scope=e.scope_ref and effective_from>=effective) then
   raise exception 'Publication clock must advance' using errcode='40001'; end if;
 snapshot:=e.value||jsonb_build_object('status','published');
 insert into learn_scorecard_publications(id,tenant_id,version_id,policy_id,revision,scope,published_by,effective_from,reason,policy)
 values(p_request,p_tenant,e.version_id,p_policy,p_revision,e.scope_ref,actor,effective,btrim(p_reason),snapshot);
 return jsonb_build_object('publicationId',p_request,'policyId',p_policy,'revision',p_revision,'effectiveFrom',effective,'reused',false);
end $$;

-- A period must belong wholly to one prospective rule interval. Published
-- versions are resolved by dates, never by the latest draft/current team settings.
create function public.learn_scorecard_policy_for_period(p_tenant uuid,p_kind text,p_group uuid,p_start timestamptz,p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare publication learn_scorecard_publications%rowtype; next_at timestamptz; scope_key text;
begin
 if auth.uid() is null or p_tenant is distinct from current_tenant_id()
   or coalesce(current_user_role(),'') not in ('owner','admin') then
   raise exception 'Owner/admin access required' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('member','team','job','customer') or p_start is null or p_end is null
   or not isfinite(p_start) or not isfinite(p_end) or p_start>=p_end or p_end-p_start>interval '366 days' then
   raise exception 'Invalid policy period' using errcode='22023'; end if;
 scope_key:=p_kind||':'||coalesce(p_group::text,'all');
 select * into publication from learn_scorecard_publications where tenant_id=p_tenant and scope=scope_key
   and effective_from<=p_start order by effective_from desc limit 1;
 if not found then return null; end if;
 select min(effective_from) into next_at from learn_scorecard_publications
   where tenant_id=p_tenant and scope=scope_key and effective_from>publication.effective_from;
 if next_at is not null and next_at<p_end then
   raise exception 'This period crosses a rule change; review separate periods' using errcode='22023'; end if;
 return publication.policy||jsonb_build_object('publication',jsonb_build_object('id',publication.id,
   'effectiveFrom',publication.effective_from,'effectiveUntil',next_at));
end $$;
revoke all on function public.learn_scorecard_publish(uuid,uuid,int,uuid,text),
 public.learn_scorecard_policy_for_period(uuid,text,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.learn_scorecard_publish(uuid,uuid,int,uuid,text),
 public.learn_scorecard_policy_for_period(uuid,text,uuid,timestamptz,timestamptz) to authenticated;
