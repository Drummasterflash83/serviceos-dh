-- Private, dated Commusoft free-of-charge closure evidence. A closure outcome
-- is not an invoice, payment, cost, job margin or completed-visit finding.
-- Installation creates no flag, source row, provider request or client grant.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.new_dawn_foc_closure_review(p_tenant uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();items jsonb;total integer;audit uuid:=gen_random_uuid();
begin
 if auth.role() is distinct from 'authenticated' or actor is null or p_tenant is null
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'foc_review_forbidden' using errcode='42501';end if;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 perform public.new_dawn_commusoft_job_actor_access(p_tenant,actor);
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.m3_foc_closure_review' and value='true'::jsonb for share;
 if not found then raise exception 'foc_review_disabled' using errcode='42501';end if;

 with latest_detail as materialized (
  select distinct on(r.job_id) r.* from public.new_dawn_commusoft_job_detail_reads r
  where r.tenant_id=p_tenant and r.state='complete'
  order by r.job_id,r.checked_at desc,r.id desc
 ), eligible as materialized (
  select r.job_id,left(j.job_number,100) as job_number,r.external_id,r.connection_id,r.source_version_id,
   v.content_hash as source_sha256,r.raw_sha256 as detail_sha256,r.checked_at,
   r.result#>>'{source_closure_facts,closedOnDateTime,value}' as closed_at_source,
   case when r.result#>>'{source_closure_facts,focReason,state}'='present'
    then r.result#>>'{source_closure_facts,focReason,value}' end as foc_reason_source
  from latest_detail r
  join public.jobs j on j.id=r.job_id and j.tenant_id=p_tenant
  join public.learn_business_input_current_links l on l.tenant_id=p_tenant
   and l.entity_kind='job' and l.entity_table='jobs' and l.entity_id=r.job_id
   and l.provider='commusoft' and l.collection='jobs'
   and l.connection_id=r.connection_id and l.source_version_id=r.source_version_id
   and l.external_id=r.external_id
  join public.learn_business_input_versions v on v.id=r.source_version_id
   and v.tenant_id=p_tenant and v.connection_id=r.connection_id
   and v.provider='commusoft' and v.collection='jobs' and v.external_id=r.external_id
  where r.result->>'version'='commusoft-exact-job-detail/5'
   and r.result#>>'{source_closure_facts,closedOutcome,state}'='present'
   and r.result#>>'{source_closure_facts,closedOutcome,value}'='FreeOfCharge'
   and r.raw_sha256~'^[0-9a-f]{64}$' and v.content_hash~'^[0-9a-f]{64}$'
   and j.metadata#>>'{learn_business_input,source_version_id}'=r.source_version_id::text
   and j.metadata#>>'{learn_business_input,connection_id}'=r.connection_id::text
   and j.source_system='commusoft:connection:'||r.connection_id::text
   and j.external_id=r.external_id
   and (select count(*) from public.learn_business_input_current_links x
    where x.tenant_id=p_tenant and x.entity_kind='job' and x.entity_table='jobs'
     and x.entity_id=r.job_id and x.provider='commusoft' and x.collection='jobs')=1
   and (public.learn_business_input_latest(p_tenant,r.connection_id,'commusoft','jobs',r.external_id)).id=r.source_version_id
 )
 select count(*)::integer,
  coalesce((select jsonb_agg(jsonb_build_object('job_id',s.job_id,'job_number',s.job_number,
    'external_id',s.external_id,'connection_id',s.connection_id,
    'source_version_id',s.source_version_id,'source_sha256',s.source_sha256,
    'detail_sha256',s.detail_sha256,'checked_at',s.checked_at,
    'closed_at_source',s.closed_at_source,'foc_reason_source',s.foc_reason_source)
    order by s.checked_at desc,s.job_id)
   from (select * from eligible order by checked_at desc,job_id limit 20)s),'[]'::jsonb)
 into total,items from eligible;

 perform public.learn_operator_input_access(p_tenant,actor,true);
 perform public.new_dawn_commusoft_job_actor_access(p_tenant,actor);
 insert into public.controlplane_change_log
 (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'client_jobs.foc_closure_review_read','jobs',p_tenant::text,
  jsonb_build_object('candidate_count',total,'shown',jsonb_array_length(items)),btrim(p_reason),audit::text,false,'new-dawn-foc-closure-review');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-foc-closure-review/1',
  'audience','openfolk_operator_only','tenant_id',p_tenant,'actor_id',actor,
  'source','Commusoft exact job detail','scope','recorded_free_of_charge_closure_not_invoice_or_payment',
  'checked_at',clock_timestamp(),'candidate_count',total,'rows',items,'audit_id',audit);
end $$;
revoke all on function public.new_dawn_foc_closure_review(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.new_dawn_foc_closure_review(uuid,text) to authenticated;
commit;
