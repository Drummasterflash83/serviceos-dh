-- Resolve interrupted assessment saves under the same lock as the original save.
-- Cancellation retains a tombstone: a delayed request cannot create an assessment later.
begin;
create table public.learn_assessment_cancellations (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 recorded_by uuid not null references public.profiles(id),
 request jsonb not null check(jsonb_typeof(request)='object' and octet_length(request::text)<=70000),
 recorded_at timestamptz not null default clock_timestamp()
);
alter table public.learn_assessment_cancellations enable row level security;
revoke all on public.learn_assessment_cancellations from public,anon,authenticated,service_role;
create trigger learn_assessment_cancellations_immutable before update or delete on public.learn_assessment_cancellations for each row execute function public.learn_assessment_immutable();
create trigger learn_assessment_cancellations_no_truncate before truncate on public.learn_assessment_cancellations for each statement execute function public.learn_assessment_immutable();

create function public.learn_assessment_resolve(p_tenant uuid,p_request uuid,p_publication uuid,p_kind text,p_subject uuid,p_group uuid,p_start timestamptz,p_end timestamptz,p_expected jsonb,p_reason text,p_cancel boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); prior learn_assessments%rowtype; cancelled learn_assessment_cancellations%rowtype; wanted jsonb;
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
  return jsonb_build_object('state','recorded','tenantId',p_tenant,'actorId',actor,'assessmentId',prior.id,'recordedAt',prior.recorded_at);
 end if;
 select * into cancelled from learn_assessment_cancellations where id=p_request;
 if found then
  if cancelled.tenant_id<>p_tenant or cancelled.recorded_by<>actor or cancelled.request is distinct from wanted then
   raise exception 'Assessment request identity changed' using errcode='PT409';end if;
  return jsonb_build_object('state','cancelled','tenantId',p_tenant,'actorId',actor,'assessmentId',p_request);
 end if;
 if p_cancel is null then raise exception 'Recovery action required' using errcode='22023';end if;
 if p_cancel then
  insert into learn_assessment_cancellations(id,tenant_id,recorded_by,request) values(p_request,p_tenant,actor,wanted);
 end if;
 return jsonb_build_object('state',case when p_cancel then 'cancelled' else 'pending' end,'tenantId',p_tenant,'actorId',actor,'assessmentId',p_request);
end $$;
revoke all on function public.learn_assessment_resolve(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,jsonb,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.learn_assessment_resolve(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,jsonb,text,boolean) to authenticated;

-- Preserve the existing function's identity, owner, ACL and snapshot logic.
do $patch$
declare definition text; anchor text:=$anchor$ policy:=learn_scorecard_policy_for_period(p_tenant,p_kind,p_group,p_start,p_end);$anchor$;
begin
 definition:=pg_get_functiondef('public.learn_assessment_save(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,jsonb,text)'::regprocedure);
 if length(definition)-length(replace(definition,anchor,''))<>length(anchor)
  or position('learn_assessment_cancellations' in definition)>0 then
  raise exception 'Unexpected assessment save definition; recovery patch not applied';
 end if;
 execute replace(definition,anchor,$replacement$ if exists(select 1 from learn_assessment_cancellations where id=p_request) then
  raise exception 'Assessment request cancelled; review evidence before a new save' using errcode='PT409';
 end if;
$replacement$||anchor);
end $patch$;
commit;
