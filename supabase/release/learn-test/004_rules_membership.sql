-- Generated TEST-only rules/publication/membership release. No baseline or customer seed.
begin;
set local search_path=public,pg_temp;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ declare n text;begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_foundation_helper_access_v1'
 and project_ref='saatxzwxvdvqevbnskxy' and source_sha256='16f222842b2d4d39387150edb696ffea7991daef36ffdb88c248216cf42b0647') then raise exception 'Verified foundation prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='learn_rules_membership_v1') then raise exception 'Rules release already exists';end if;
 foreach n in array array['view_as_context','learn_member_history','learn_scorecard_publications'] loop
  if to_regclass('public.'||n) is not null then raise exception 'Rules table already exists: %',n;end if;
 end loop;
 if exists(select 1 from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname=any(array['learn_scorecard_save_draft','learn_member_snapshot','learn_member_history_immutable','learn_capture_member_change','learn_member_capture_baseline','learn_member_history_read','learn_scorecard_revision_immutable','learn_scorecard_publish','learn_scorecard_policy_for_period','learn_scorecard_read_draft'])) then raise exception 'Rules function already exists';end if;
end $$;
-- SOURCE 20260819120000_view_as_and_superadmin.sql
-- Original SHA-256 36a7a07fa4eba872180e643f09dcaa972dad70ee4c3bfacd52490ccfbc225814
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


-- SOURCE 20261029120000_learn_scorecard_drafts.sql
-- Original SHA-256 a7cb66a651aa548dacb55d11cf47196e0b414f4d1945df49e8679575ba406386
-- LEARN scorecard rule drafts. Additive: no changes to communications, recordings,
-- measurements, ownership or existing scoring. No policy is published by this RPC.
-- Reuse governed configuration; every revision has its own immutable content row.
-- Apply only after reviewing deployed migration history; this file is not a deploy.
create or replace function public.learn_scorecard_save_draft(
  p_tenant_id uuid, p_expected_version integer, p_definition jsonb, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
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
    raise exception 'Scoring rules changed; reload before saving' using errcode='40001';
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
$$;
revoke all on function public.learn_scorecard_save_draft(uuid,integer,jsonb,text) from public, anon;
grant execute on function public.learn_scorecard_save_draft(uuid,integer,jsonb,text) to authenticated;

-- Rollback removes only the draft-writing function. Retain all versioned history:
-- drop function public.learn_scorecard_save_draft(uuid,integer,jsonb,text);

-- SOURCE 20261029220000_learn_member_history.sql
-- Original SHA-256 a08bcfc8187a9d283eef721e84b2a88b9d09aec1aee9c59af4533f6dadb75783
-- Forward observed membership evidence. Existing dates never backfill coverage.
create table public.learn_member_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  member_id uuid not null references public.team_members(id),
  sequence bigint generated always as identity unique,
  kind text not null check(kind in ('insert','update','baseline')),
  observed_at timestamptz not null default clock_timestamp(),
  before_state jsonb not null check(jsonb_typeof(before_state)='object'),
  after_state jsonb not null check(jsonb_typeof(after_state)='object'),
  check(kind='update' or before_state=after_state)
);
create index learn_member_history_read_idx on public.learn_member_history(tenant_id,member_id,sequence);
alter table public.learn_member_history enable row level security;
revoke all on public.learn_member_history from public,anon,authenticated,service_role;
revoke all on sequence public.learn_member_history_sequence_seq from public,anon,authenticated,service_role;

create function public.learn_member_snapshot(p public.team_members) returns jsonb
language sql immutable set search_path=public,pg_temp as $$
 select jsonb_build_object('profileId',p.profile_id,'teamId',p.org_unit_id,
   'confirmedAt',p.confirmed_at,'effectiveFrom',p.effective_from,'effectiveTo',p.effective_to);
$$;
create function public.learn_member_history_immutable() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'Membership evidence is append-only' using errcode='55000'; end $$;
create trigger learn_member_history_immutable before update or delete on public.learn_member_history
 for each row execute function public.learn_member_history_immutable();
create trigger learn_member_history_no_truncate before truncate on public.learn_member_history
 for each statement execute function public.learn_member_history_immutable();

create function public.learn_capture_member_change() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare b jsonb; a jsonb;
begin
 if tg_op='DELETE' or tg_op='TRUNCATE' then
   raise exception 'End memberships instead of removing their identity history' using errcode='55000';
 end if;
 a:=learn_member_snapshot(new);
 if tg_op='UPDATE' then
   if old.id is distinct from new.id or old.tenant_id is distinct from new.tenant_id then
     raise exception 'Member identity and tenant are immutable' using errcode='23514';
   end if;
   b:=learn_member_snapshot(old);
   if a=b then return new; end if;
 else b:=a;
 end if;
 insert into learn_member_history(tenant_id,member_id,kind,before_state,after_state)
 values(new.tenant_id,new.id,lower(tg_op),b,a);
 return new;
end $$;
create trigger learn_capture_member_change after insert or update on public.team_members
 for each row execute function public.learn_capture_member_change();
create trigger learn_member_no_delete before delete on public.team_members
 for each row execute function public.learn_capture_member_change();
create trigger learn_member_no_truncate before truncate on public.team_members
 for each statement execute function public.learn_capture_member_change();

create function public.learn_member_capture_baseline(p_tenant uuid,p_member uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare m team_members%rowtype; result uuid; s jsonb;
begin
 select * into m from team_members where tenant_id=p_tenant and id=p_member for update;
 if not found then raise exception 'Member not found in tenant' using errcode='P0002'; end if;
 select id into result from learn_member_history where tenant_id=p_tenant and member_id=p_member
 order by sequence limit 1;
 if found then return result; end if;
 s:=learn_member_snapshot(m);
 insert into learn_member_history(tenant_id,member_id,kind,before_state,after_state)
 values(p_tenant,p_member,'baseline',s,s) returning id into result;
 return result;
end $$;

-- Bounded, coherent whole-roster read, required to detect ambiguous user->member
-- mappings. A missing member history is explicit, never treated as no membership.
create function public.learn_member_history_read(p_tenant uuid,p_start timestamptz,p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare m team_members%rowtype; head learn_member_history%rowtype; first_event learn_member_history%rowtype;
 predecessor bigint; n int; total_events int:=0; total_members int; events jsonb; members jsonb:='[]';
 observed timestamptz:=statement_timestamp(); result jsonb;
begin
 if auth.uid() is null or p_tenant is distinct from current_tenant_id()
   or coalesce(current_user_role(),'') not in ('owner','admin') then
   raise exception 'Owner/admin access in this tenant required' using errcode='42501';
 end if;
 if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
   or p_start>=p_end or p_end>observed or p_end-p_start>interval '366 days' then
   raise exception 'Choose a completed period of at most 366 days' using errcode='22023';
 end if;
 if (select count(*) from pg_trigger where tgrelid='public.team_members'::regclass
   and tgname in ('learn_capture_member_change','learn_member_no_delete','learn_member_no_truncate')
   and tgenabled in ('O','A'))<>3 then
   raise exception 'Membership capture is unavailable' using errcode='55000';
 end if;
 select count(*) into total_members from team_members where tenant_id=p_tenant;
 if total_members>500 then raise exception 'Roster exceeds bounded history review' using errcode='54000'; end if;
 for m in select * from team_members where tenant_id=p_tenant order by id loop
   select * into head from learn_member_history where tenant_id=p_tenant and member_id=m.id order by sequence desc limit 1;
   if found and (head.after_state is distinct from learn_member_snapshot(m) or head.observed_at>observed) then
     raise exception 'Current membership does not reconcile with captured history' using errcode='55000';
   end if;
   if exists(select 1 from (
     select observed_at,before_state,
       lag(observed_at) over(order by sequence) prior_at,
       lag(after_state) over(order by sequence) prior_state
     from learn_member_history where tenant_id=p_tenant and member_id=m.id
   ) h where observed_at<prior_at or (prior_state is not null and before_state is distinct from prior_state)) then
     raise exception 'Membership capture contains an unexplained history gap' using errcode='55000';
   end if;
   select * into first_event from learn_member_history where tenant_id=p_tenant and member_id=m.id order by sequence limit 1;
   select sequence into predecessor from learn_member_history where tenant_id=p_tenant and member_id=m.id
     and observed_at<p_start order by sequence desc limit 1;
   select count(*) into n from learn_member_history where tenant_id=p_tenant and member_id=m.id
     and (sequence=predecessor or observed_at between p_start and p_end);
   total_events:=total_events+n;
   if n>1000 or total_events>5000 then raise exception 'Membership history exceeds bounded review' using errcode='54000'; end if;
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'sequence',sequence::text,'kind',kind,
     'observedAt',observed_at,'before',before_state,'after',after_state) order by sequence),'[]') into events
     from learn_member_history where tenant_id=p_tenant and member_id=m.id
     and (sequence=predecessor or observed_at between p_start and p_end);
   members:=members||jsonb_build_array(jsonb_build_object('memberId',m.id,
     'coverageStart',first_event.observed_at,'firstKind',first_event.kind,
     'sourceThrough',case when first_event.id is not null then observed end,'count',n,'events',events));
 end loop;
 result:=jsonb_build_object('contract','member-capture@1','tenantId',p_tenant,
   'period',jsonb_build_object('start',p_start,'end',p_end),'observedAt',observed,
   'count',total_members,'members',members);
 if octet_length(result::text)>2097152 then raise exception 'Membership history exceeds payload limit' using errcode='54000'; end if;
 return result;
end $$;
revoke all on function public.learn_member_snapshot(public.team_members),public.learn_member_history_immutable(),
 public.learn_capture_member_change(),public.learn_member_capture_baseline(uuid,uuid),
 public.learn_member_history_read(uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.learn_member_capture_baseline(uuid,uuid) to service_role;
grant execute on function public.learn_member_history_read(uuid,timestamptz,timestamptz) to authenticated;

-- SOURCE 20261030000000_learn_scorecard_publication.sql
-- Original SHA-256 41ac2b5c7eeb97db980f6cb6d16aa13848b414418956a42ebb305628026c4088
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

-- SOURCE 20261030020000_learn_scorecard_draft_reader.sql
-- Original SHA-256 fcf606e367abfde7a8cfff64fa2b0409a259fe83ecba934ea0fa1dc2da187b35
-- Read by saved revision, not created_at: transaction clocks can tie or arrive out of order.
create function public.learn_scorecard_read_draft(p_tenant uuid,p_kind text,p_group uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare selected_value jsonb; selected_revision int; selected_status text; scope_key text;
begin
 if auth.uid() is null or p_tenant is distinct from current_tenant_id()
   or coalesce(current_user_role(),'') not in ('owner','admin') then
   raise exception 'Owner/admin access required' using errcode='42501';end if;
 if p_kind is null or p_kind not in ('member','team','job','customer')
   or (p_group is not null and (p_kind not in ('member','team') or not exists(select 1 from org_units where id=p_group and tenant_id=p_tenant))) then
   raise exception 'Invalid scorecard scope' using errcode='22023';end if;
 scope_key:=p_kind||':'||coalesce(p_group::text,'all');
 select e.value,c.version,c.status into selected_value,selected_revision,selected_status
 from operating_profile_entries e join config_versions c on c.id=e.version_id and c.tenant_id=e.tenant_id
 where e.tenant_id=p_tenant and e.scope_kind='tenant' and e.scope_ref=scope_key
  and e.namespace='learn_scorecards' and e.key like 'definition.%' and c.artifact_kind='learn_scorecard'
 order by c.version desc,e.id limit 1;
 if not found then return null;end if;
 if selected_status is distinct from 'draft' or selected_value->>'status' is distinct from 'draft'
  or selected_value->>'tenantId' is distinct from p_tenant::text
  or selected_value->>'subjectKind' is distinct from p_kind
  or nullif(selected_value->>'groupId','') is distinct from p_group::text
  or selected_value->>'version' is distinct from selected_revision::text then
  raise exception 'Saved scorecard revision is inconsistent' using errcode='22023';end if;
 return selected_value;
end $$;
revoke all on function public.learn_scorecard_read_draft(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_scorecard_read_draft(uuid,text,uuid) to authenticated;

revoke all on function public.learn_scorecard_save_draft(uuid,integer,jsonb,text) from service_role;
-- Explicitly release the current user's role helper for publication RLS. No body changes.
grant execute on function public.current_user_role() to authenticated;
-- A browser can inspect only its own same-company preview context. No preview writer is released.
revoke all on public.view_as_context from public,anon,authenticated,service_role;
grant select on public.view_as_context to authenticated;
grant select,insert,update,delete on public.view_as_context to service_role;
create policy learn_view_as_actor_boundary on public.view_as_context as restrictive for select to authenticated
 using(tenant_id=public.current_tenant_id() and actor_user_id=auth.uid());
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'learn_rules_membership_v1','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
