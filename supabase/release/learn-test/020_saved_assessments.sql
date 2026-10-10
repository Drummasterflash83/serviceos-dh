-- Retain canonical scoring inputs under published rules. Clients never submit scores.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' then raise exception 'Explicit TEST target required';end if;
 if coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed checksum required';end if;
 if (select count(*) from of_test_deploy.migrations)<>20 or not exists(select 1 from of_test_deploy.migrations where migration_name='learn_card_sources_v1' and source_sha256='cca8c835fdf7b3e088796ecd34dae4e09b6ed615f93386ff2f03cfdea9d86e86' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Exact source-reader release prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='learn_saved_assessments_v1') then raise exception 'Existing assessment release requires inspection';end if;
end $$;
create table public.learn_assessments (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 publication_id uuid not null references public.learn_scorecard_publications(id),
 subject_kind text not null check(subject_kind in ('member','team','job','customer')),
 subject_id uuid not null,
 window_start timestamptz not null,
 window_end timestamptz not null,
 recorded_at timestamptz not null,
 recorded_by uuid not null references public.profiles(id),
 reason text not null check(length(btrim(reason)) between 1 and 1000),
 request jsonb not null,
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=2097152),
 check(isfinite(window_start) and isfinite(window_end) and window_start<window_end and window_end<=recorded_at)
);
create index learn_assessment_history on public.learn_assessments(tenant_id,subject_kind,subject_id,recorded_at desc,id);
alter table public.learn_assessments enable row level security;
revoke all on public.learn_assessments from public,anon,authenticated,service_role;
grant select on public.learn_assessments to authenticated;
create policy learn_assessments_read on public.learn_assessments for select to authenticated
 using(tenant_id=public.current_tenant_id() and coalesce(public.current_user_role(),'') in ('owner','admin'));
create function public.learn_assessment_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'Saved assessments are immutable; retain and reassess' using errcode='23001';end $$;
create trigger learn_assessments_immutable before update or delete on public.learn_assessments for each row execute function public.learn_assessment_immutable();
create trigger learn_assessments_no_truncate before truncate on public.learn_assessments for each statement execute function public.learn_assessment_immutable();
revoke all on function public.learn_assessment_immutable() from public,anon,authenticated,service_role;

create function public.learn_assessment_save(p_tenant uuid,p_request uuid,p_publication uuid,p_kind text,p_subject uuid,p_group uuid,p_start timestamptz,p_end timestamptz,p_expected jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); prior learn_assessments%rowtype; policy jsonb; wanted jsonb;
 ms jsonb; rs jsonb; cs jsonb; heads jsonb; captured timestamptz; snap jsonb;
begin
 if actor is null or p_tenant is distinct from current_tenant_id() then
  raise exception 'Company owner/admin access required' using errcode='42501';end if;
 perform 1 from profiles where id=actor and tenant_id=p_tenant and role in ('owner','admin') for share;
 if not found or exists(select 1 from view_as_context where actor_user_id=actor and ended_at is null and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'Company owner/admin access outside preview required' using errcode='42501';end if;
 if p_request is null or p_publication is null or p_subject is null or p_kind is null or p_kind not in ('member','team','job','customer')
  or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_start>=p_end or p_end>clock_timestamp() or p_end-p_start>interval '366 days'
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or jsonb_typeof(p_expected) is distinct from 'array' then
  raise exception 'Published rules, completed period, expected evidence and reason required' using errcode='22023';end if;
 if jsonb_array_length(p_expected)>500 or octet_length(p_expected::text)>65536 then
  raise exception 'Assessment evidence exceeds the current window' using errcode='22023';end if;
 wanted:=jsonb_build_object('publication',p_publication,'kind',p_kind,'subject',p_subject,'group',p_group,'start',p_start,'end',p_end,'expected',p_expected,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('learn-assessment:'||p_request::text,0));
 select * into prior from learn_assessments where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.recorded_by<>actor or prior.request is distinct from wanted then
   raise exception 'Assessment request identity changed' using errcode='PT409';end if;
  return jsonb_build_object('assessmentId',prior.id,'recordedAt',prior.recorded_at,'reused',true);
 end if;
 policy:=learn_scorecard_policy_for_period(p_tenant,p_kind,p_group,p_start,p_end);
 if policy is null or policy#>>'{publication,id}' is distinct from p_publication::text then
  raise exception 'Published rules changed or do not cover this period' using errcode='PT409';end if;
 if (p_kind='member' and not exists(select 1 from team_members where id=p_subject and tenant_id=p_tenant))
  or (p_kind='team' and not exists(select 1 from org_units where id=p_subject and tenant_id=p_tenant))
  or (p_kind='job' and not exists(select 1 from jobs where id=p_subject and tenant_id=p_tenant))
  or (p_kind='customer' and not exists(select 1 from customer_cards where id=p_subject and tenant_id=p_tenant))
  or (p_group is not null and (p_kind not in ('member','team') or (p_kind='team' and p_subject<>p_group))) then
  raise exception 'Unknown company subject or group' using errcode='22023';end if;
 -- One MVCC statement captures all three ledgers; no client-provided values or review decisions.
 with m as materialized (
  select id,tenant_id,subject_kind,subject_id,policy_id,policy_revision,metric_key,value,unit,window_start,window_end,measured_at,source,source_through,sample_count,covered_count,eligible_count,review_state,evidence,exclusions,supersedes,group_ids,request_payload->>'manualCorrectionId' as correction_request_id
  from measurements where tenant_id=p_tenant and policy_id=(policy->>'id')::uuid and policy_revision=(policy->>'version')::int
   and subject_kind=p_kind and subject_id=p_subject and window_start=p_start and window_end=p_end order by measured_at,id limit 501
 ), r as materialized (
  select r.* from learn_performance_reviews r join m on m.id=r.measurement_id where r.tenant_id=p_tenant order by r.measurement_id,r.revision limit 1001
 ), c as materialized (
  select c.* from learn_performance_corrections c join m on m.id=c.id where c.tenant_id=p_tenant order by c.id limit 501
 ) select (select coalesce(jsonb_agg(to_jsonb(m) order by measured_at,id),'[]') from m),
  (select coalesce(jsonb_agg(to_jsonb(r) order by measurement_id,revision),'[]') from r),
  (select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from c),
  (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'reviewRevision',coalesce((select max(revision) from r where measurement_id=m.id),0)) order by m.id),'[]') from m)
 into ms,rs,cs,heads;
 if jsonb_array_length(ms)>500 or jsonb_array_length(rs)>1000 or jsonb_array_length(cs)>500 then
  raise exception 'Complete assessment evidence exceeds the current window' using errcode='22023';end if;
 if heads is distinct from p_expected then
  raise exception 'Measurements or reviews changed; reload before saving' using errcode='PT409';end if;
 if p_group is not null and p_kind='member' then
  if (jsonb_array_length(ms)=0 and not learn_member_group_covers(p_tenant,p_subject,p_group,p_start,p_end))
   or exists(select 1 from jsonb_array_elements(ms) m where not coalesce(m->'group_ids' @> jsonb_build_array(p_group),false)) then
   raise exception 'Observed team attribution does not cover this assessment' using errcode='22023';end if;
 end if;
 captured:=clock_timestamp();
 snap:=jsonb_build_object('version','learn-assessment/1','engine','learn-scorecards/1','policy',policy,
  'subject',jsonb_build_object('kind',p_kind,'id',p_subject,'groupIds',case when p_group is null then '[]'::jsonb else jsonb_build_array(p_group) end),
  'period',jsonb_build_object('start',p_start,'end',p_end),'assessedAt',captured,'measurements',ms,'reviews',rs,'corrections',cs);
 if octet_length(snap::text)>2097152 then raise exception 'Assessment snapshot exceeds current limit' using errcode='22023';end if;
 insert into learn_assessments(id,tenant_id,publication_id,subject_kind,subject_id,window_start,window_end,recorded_at,recorded_by,reason,request,snapshot)
 values(p_request,p_tenant,p_publication,p_kind,p_subject,p_start,p_end,captured,actor,btrim(p_reason),wanted,snap);
 return jsonb_build_object('assessmentId',p_request,'recordedAt',captured,'reused',false);
end $$;
revoke all on function public.learn_assessment_save(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_assessment_save(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,jsonb,text) to authenticated;
insert into of_test_deploy.migrations(migration_name,source_sha256,project_ref) values('learn_saved_assessments_v1',current_setting('serviceos.release_source_sha256'),'saatxzwxvdvqevbnskxy');
notify pgrst,'reload schema';
commit;
