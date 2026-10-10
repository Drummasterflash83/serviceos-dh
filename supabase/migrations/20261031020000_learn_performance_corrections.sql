-- Manager numerical corrections retain originals, source freshness and independent review.
begin;
create table public.learn_performance_corrections (
 id uuid primary key references public.measurements(id),
 tenant_id uuid not null references public.tenants(id),
 predecessor_id uuid not null unique references public.measurements(id),
 previous_value numeric,
 corrected_value numeric,
 source_observed_at timestamptz not null,
 expected_review_revision integer not null check(expected_review_revision>=0 and expected_review_revision<2147483647),
 corrected_by uuid not null references public.profiles(id),
 reason text not null check(length(btrim(reason)) between 1 and 1000),
 created_at timestamptz not null,
 check(isfinite(source_observed_at) and isfinite(created_at) and source_observed_at<=created_at),
 check(previous_value is distinct from corrected_value)
);
alter table public.learn_performance_corrections enable row level security;
create policy learn_performance_correction_read on public.learn_performance_corrections for select to authenticated
 using(tenant_id=public.current_tenant_id() and coalesce(public.current_user_role(),'') in ('owner','admin'));
revoke all on public.learn_performance_corrections from public,anon,authenticated,service_role;
grant select on public.learn_performance_corrections to authenticated,service_role;
create trigger learn_performance_correction_immutable before update or delete on public.learn_performance_corrections
 for each row execute function public.objectives_append_only();
create trigger learn_performance_correction_no_truncate before truncate on public.learn_performance_corrections
 for each statement execute function public.objectives_append_only();

create function public.learn_performance_correct(p_tenant uuid,p_measurement uuid,p_request uuid,p_expected_review_revision integer,p_value numeric,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 actor_tenant uuid;actor_role text;
 parent public.measurements%rowtype;
 prior public.learn_performance_corrections%rowtype;
 previous_correction public.learn_performance_corrections%rowtype;
 current_revision integer;observed timestamptz;source_observed timestamptz;payload jsonb;receipt jsonb;
begin
 select p.tenant_id,p.role into actor_tenant,actor_role from public.profiles p where p.id=auth.uid() for share;
 if auth.uid() is null or actor_tenant is distinct from p_tenant or coalesce(actor_role,'') not in ('owner','admin')
 or exists(select 1 from public.view_as_context where actor_user_id=auth.uid() and ended_at is null and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'Company owner/admin access required outside preview' using errcode='42501';end if;
 if p_tenant is null or p_measurement is null or p_request is null or p_expected_review_revision is null
 or p_expected_review_revision<0 or p_expected_review_revision>=2147483647
 or length(btrim(coalesce(p_reason,''))) not between 1 and 1000
 or (p_value is not null and (p_value::text in ('NaN','Infinity','-Infinity') or abs(p_value)>1.7976931348623157e308)) then
  raise exception 'A measurement, finite value or withheld value, current review revision and reason are required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-performance-correction:'||p_request::text,0));
 select * into prior from public.learn_performance_corrections where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.predecessor_id<>p_measurement or prior.corrected_by<>auth.uid()
   or prior.expected_review_revision<>p_expected_review_revision or prior.corrected_value is distinct from p_value or prior.reason<>btrim(p_reason) then
   raise exception 'Correction request identity changed' using errcode='PT409';end if;
  return jsonb_build_object('measurementId',prior.id,'predecessorId',prior.predecessor_id,'reused',true);
 end if;
 select * into parent from public.measurements where id=p_measurement and tenant_id=p_tenant for update;
 if not found or parent.subject_kind='tenant' or parent.request_payload is null then
  raise exception 'Performance observation unavailable' using errcode='22023';end if;
 if exists(select 1 from public.measurements where supersedes=parent.id) then
  raise exception 'Observation already corrected; reload the card' using errcode='PT409';end if;
 select coalesce(max(revision),0) into current_revision from public.learn_performance_reviews where measurement_id=parent.id;
 if current_revision<>p_expected_review_revision then raise exception 'Review changed; reload the card' using errcode='PT409';end if;
 if parent.value is not distinct from p_value then raise exception 'Correction must change or withhold the value' using errcode='22023';end if;
 source_observed:=parent.measured_at;
 if parent.request_payload ? 'manualCorrectionId' then
  select * into previous_correction from public.learn_performance_corrections where id=parent.id and tenant_id=p_tenant;
  if not found or parent.request_payload->>'manualCorrectionId' is distinct from parent.id::text
   or previous_correction.predecessor_id is distinct from parent.supersedes or previous_correction.corrected_value is distinct from parent.value then
   raise exception 'Correction provenance is incomplete' using errcode='PT409';end if;
  source_observed:=previous_correction.source_observed_at;
 end if;
 observed:=clock_timestamp();
 if date_trunc('milliseconds',observed)<=date_trunc('milliseconds',parent.measured_at) then
  raise exception 'Observation is too recent; retry after reloading' using errcode='PT409';end if;
 -- Only the value and correction identity change. Counts, source watermark,
 -- unit, scope, evidence and exclusions remain those of the retained parent.
 payload:=parent.request_payload||jsonb_build_object('id',p_request,'supersedes',parent.id,'value',p_value,'observedAt',observed,'review','inferred','manualCorrectionId',p_request);
 receipt:=public.learn_performance_append(p_tenant,payload,btrim(p_reason));
 if receipt->>'measurementId' is distinct from p_request::text or receipt->>'reused' is distinct from 'false' then
  raise exception 'Correction append receipt differs' using errcode='PT409';end if;
 insert into public.learn_performance_corrections(id,tenant_id,predecessor_id,previous_value,corrected_value,source_observed_at,expected_review_revision,corrected_by,reason,created_at)
 values(p_request,p_tenant,parent.id,parent.value,p_value,source_observed,p_expected_review_revision,auth.uid(),btrim(p_reason),observed);
 return jsonb_build_object('measurementId',p_request,'predecessorId',parent.id,'reused',false);
end $$;
revoke all on function public.learn_performance_correct(uuid,uuid,uuid,integer,numeric,text) from public,anon,service_role;
grant execute on function public.learn_performance_correct(uuid,uuid,uuid,integer,numeric,text) to authenticated;
commit;
