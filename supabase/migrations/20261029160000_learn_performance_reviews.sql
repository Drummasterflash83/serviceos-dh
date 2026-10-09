-- Human review is an append-only ledger, separate from immutable source facts.
-- Confirming an observation must never refresh its source timestamp or coverage.
begin;
create table public.learn_performance_reviews (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 measurement_id uuid not null references public.measurements(id),
 revision integer not null check(revision>0),
 decision text not null check(decision in ('confirmed','disputed')),
 reviewed_by uuid not null references public.profiles(id),
 reason text not null check(length(btrim(reason)) between 1 and 1000),
 created_at timestamptz not null default clock_timestamp(),
 unique(measurement_id,revision)
);
alter table public.learn_performance_reviews enable row level security;
create policy learn_performance_review_read on public.learn_performance_reviews for select to authenticated
 using(tenant_id=public.current_tenant_id() and coalesce(public.current_user_role(),'') in ('owner','admin'));
revoke all on public.learn_performance_reviews from public,anon,authenticated,service_role;
grant select on public.learn_performance_reviews to authenticated,service_role;
create trigger learn_performance_reviews_immutable before update or delete on public.learn_performance_reviews
 for each row execute function public.objectives_append_only();
create function public.learn_performance_review(
 p_tenant_id uuid,p_measurement_id uuid,p_request_id uuid,p_expected_revision integer,p_decision text,p_reason text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 prior public.learn_performance_reviews%rowtype;
 observed public.measurements%rowtype;
 current_revision integer;
begin
 if auth.uid() is null or p_tenant_id is distinct from public.current_tenant_id()
  or coalesce(public.current_user_role(),'') not in ('owner','admin')
  or exists(select 1 from public.view_as_context where actor_user_id=auth.uid()
   and ended_at is null and (expires_at is null or expires_at>now())) then
  raise exception 'Company owner/admin access required outside preview' using errcode='42501';
 end if;
 if p_measurement_id is null or p_request_id is null or p_expected_revision is null
  or p_expected_revision<0 or p_expected_revision>=2147483647
  or coalesce(p_decision,'') not in ('confirmed','disputed')
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
  raise exception 'A measurement, review decision, revision and reason are required' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-performance-review:'||p_request_id::text,0));
 select * into prior from public.learn_performance_reviews where id=p_request_id;
 if found then
  if prior.tenant_id<>p_tenant_id or prior.measurement_id<>p_measurement_id or prior.reviewed_by<>auth.uid()
   or prior.revision<>p_expected_revision+1 or prior.decision<>p_decision or prior.reason<>btrim(p_reason) then
   raise exception 'Review request identity changed' using errcode='40001';
  end if;
  return jsonb_build_object('reviewId',prior.id,'measurementId',prior.measurement_id,'revision',prior.revision,'decision',prior.decision,'reused',true);
 end if;
 -- The adapter correction path takes this same row lock. A stale card cannot
 -- approve an observation that has already been replaced by a new source fact.
 select * into observed from public.measurements where id=p_measurement_id and tenant_id=p_tenant_id for update;
 if not found or observed.subject_kind='tenant' then
  raise exception 'Performance observation unavailable' using errcode='22023';
 end if;
 if exists(select 1 from public.measurements where supersedes=observed.id) then
  raise exception 'Observation was corrected; reload before reviewing' using errcode='40001';
 end if;
 select coalesce(max(revision),0) into current_revision from public.learn_performance_reviews where measurement_id=observed.id;
 if current_revision<>p_expected_revision then
  raise exception 'Review changed; reload before reviewing' using errcode='40001';
 end if;
 insert into public.learn_performance_reviews(id,tenant_id,measurement_id,revision,decision,reviewed_by,reason)
  values(p_request_id,p_tenant_id,observed.id,current_revision+1,p_decision,auth.uid(),btrim(p_reason));
 return jsonb_build_object('reviewId',p_request_id,'measurementId',observed.id,'revision',current_revision+1,'decision',p_decision,'reused',false);
end $$;
revoke all on function public.learn_performance_review(uuid,uuid,uuid,integer,text,text) from public,anon,service_role;
grant execute on function public.learn_performance_review(uuid,uuid,uuid,integer,text,text) to authenticated;
commit;
