-- Recover one exact numerical correction; cancellation and correction share a lock.
begin;
create table public.learn_correction_cancellations (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 recorded_by uuid not null references public.profiles(id),
 request jsonb not null check(jsonb_typeof(request)='object' and octet_length(request::text)<=10000),
 recorded_at timestamptz not null default clock_timestamp()
);
alter table public.learn_correction_cancellations enable row level security;
revoke all on public.learn_correction_cancellations from public,anon,authenticated,service_role;
create trigger learn_correction_cancellations_immutable before update or delete on public.learn_correction_cancellations for each row execute function public.objectives_append_only();
create trigger learn_correction_cancellations_no_truncate before truncate on public.learn_correction_cancellations for each statement execute function public.objectives_append_only();

create function public.learn_performance_correction_resolve(p_tenant uuid,p_measurement uuid,p_request uuid,p_expected_review_revision integer,p_value numeric,p_reason text,p_cancel boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor_tenant uuid;actor_role text; prior public.learn_performance_corrections%rowtype;
 cancelled public.learn_correction_cancellations%rowtype; wanted jsonb;
begin
 select p.tenant_id,p.role into actor_tenant,actor_role from public.profiles p where p.id=auth.uid() for share;
 if auth.uid() is null or actor_tenant is distinct from p_tenant or coalesce(actor_role,'') not in ('owner','admin')
 or exists(select 1 from public.view_as_context where actor_user_id=auth.uid() and ended_at is null and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'Company owner/admin access required outside preview' using errcode='42501';end if;
 if p_tenant is null or p_measurement is null or p_request is null or p_expected_review_revision is null
 or p_expected_review_revision<0 or p_expected_review_revision>=2147483647 or p_cancel is null
 or length(btrim(coalesce(p_reason,''))) not between 1 and 1000
 or (p_value is not null and (p_value::text in ('NaN','Infinity','-Infinity') or abs(p_value)>1.7976931348623157e308)) then
  raise exception 'An exact correction request and recovery action are required' using errcode='22023';end if;
 wanted:=jsonb_build_object('measurement',p_measurement,'reviewRevision',p_expected_review_revision,'value',p_value,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('learn-performance-correction:'||p_request::text,0));
 select * into prior from public.learn_performance_corrections where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.predecessor_id<>p_measurement or prior.corrected_by<>auth.uid()
   or prior.expected_review_revision<>p_expected_review_revision or prior.corrected_value is distinct from p_value or prior.reason<>btrim(p_reason) then
   raise exception 'Correction request identity changed' using errcode='PT409';end if;
  return jsonb_build_object('state','recorded','tenantId',p_tenant,'actorId',auth.uid(),'measurementId',p_request,'predecessorId',p_measurement,'recordedAt',prior.created_at);
 end if;
 select * into cancelled from public.learn_correction_cancellations where id=p_request;
 if found then
  if cancelled.tenant_id<>p_tenant or cancelled.recorded_by<>auth.uid() or cancelled.request is distinct from wanted then
   raise exception 'Correction request identity changed' using errcode='PT409';end if;
  return jsonb_build_object('state','cancelled','tenantId',p_tenant,'actorId',auth.uid(),'measurementId',p_request,'predecessorId',p_measurement);
 end if;
 -- Do not confirm, correct or delete the predecessor when checking/cancelling.
 -- A stale review or superseded predecessor can still have its pending intent retired.
 perform 1 from public.measurements where id=p_measurement and tenant_id=p_tenant and subject_kind<>'tenant' and request_payload is not null;
 if not found then raise exception 'Performance observation unavailable' using errcode='22023';end if;
 if p_cancel then
  insert into public.learn_correction_cancellations(id,tenant_id,recorded_by,request) values(p_request,p_tenant,auth.uid(),wanted);
 end if;
 return jsonb_build_object('state',case when p_cancel then 'cancelled' else 'pending' end,'tenantId',p_tenant,'actorId',auth.uid(),'measurementId',p_request,'predecessorId',p_measurement);
end $$;
revoke all on function public.learn_performance_correction_resolve(uuid,uuid,uuid,integer,numeric,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.learn_performance_correction_resolve(uuid,uuid,uuid,integer,numeric,text,boolean) to authenticated;

-- Preserve the existing correction function identity, source calculation and ACL.
do $patch$
declare definition text; anchor text:=$anchor$ select * into parent from public.measurements where id=p_measurement and tenant_id=p_tenant for update;$anchor$;
begin
 definition:=pg_get_functiondef('public.learn_performance_correct(uuid,uuid,uuid,integer,numeric,text)'::regprocedure);
 if length(definition)-length(replace(definition,anchor,''))<>length(anchor)
 or position('learn_correction_cancellations' in definition)>0
 or position('learn-performance-correction:' in definition)=0 then
  raise exception 'Unexpected correction definition; recovery patch not applied';end if;
 execute replace(definition,anchor,$replacement$ if exists(select 1 from public.learn_correction_cancellations where id=p_request) then
  raise exception 'Correction request cancelled; review evidence before a new correction' using errcode='PT409';end if;
$replacement$||anchor);
end $patch$;
commit;
