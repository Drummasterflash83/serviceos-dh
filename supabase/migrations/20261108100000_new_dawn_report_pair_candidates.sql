-- Bounded metadata-only selector for already retained QuickBooks report pairs.
-- No report amount, raw receipt, provider request, client grant, or flag seed.
begin;

create function public.learn_quickbooks_report_pair_candidates(p_tenant uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare candidates jsonb;audit uuid;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null
  or p_tenant is null or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'report_pair_candidates_forbidden' using errcode='42501';end if;
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.report_summary_preview' and value='true'::jsonb for share;
 if not found then raise exception 'report_pair_candidates_disabled' using errcode='42501';end if;

 with profit as (
  select p.id,p.connection_id,p.environment,p.realm_id,p.period_start,p.period_end,
   p.accounting_method,r.received_at,r.response_sha256,r.header
  from public.learn_quickbooks_report_requests p
  join public.learn_quickbooks_report_receipts r on r.request_id=p.id
   and r.tenant_id=p.tenant_id and r.report_kind='ProfitAndLoss'
  where p.tenant_id=p_tenant and p.actor_id=auth.uid() and p.state='complete'
   and p.report_kind='ProfitAndLoss' and p.environment='production'
   and p.period_end<=(clock_timestamp() at time zone 'UTC')::date
   and r.validation_state='verified'
   and r.header->>'ReportName'='ProfitAndLoss'
   and r.header->>'StartPeriod'=p.period_start::text
   and r.header->>'EndPeriod'=p.period_end::text
   and r.header->>'ReportBasis'=p.accounting_method
   and r.header->>'Currency' ~ '^[A-Z]{3}$'
  order by r.received_at desc,p.id desc limit 100
 ), pairs as (
  select p.*,a.ar_id,a.ar_received_at,a.ar_hash
  from profit p
  join lateral (
   select a.id as ar_id,r.received_at as ar_received_at,r.response_sha256 as ar_hash
   from public.learn_quickbooks_report_requests a
   join public.learn_quickbooks_report_receipts r on r.request_id=a.id
    and r.tenant_id=a.tenant_id and r.report_kind='AgedReceivables'
   where a.tenant_id=p_tenant and a.actor_id=auth.uid() and a.state='complete'
    and a.report_kind='AgedReceivables' and a.connection_id=p.connection_id
    and a.environment=p.environment and a.realm_id=p.realm_id
    and a.report_date=p.period_end and a.aging_method='Report_Date'
    and r.validation_state='verified'
    and r.header->>'ReportName'='AgedReceivables'
    and r.header->>'Currency'=p.header->>'Currency'
    and exists(select 1 from jsonb_array_elements(case when
      jsonb_typeof(r.header->'Option')='array' then r.header->'Option'
      else '[]'::jsonb end) opt
     where opt->>'Name'='report_date' and opt->>'Value'=a.report_date::text)
   order by r.received_at desc,a.id desc limit 1
  ) a on true
  order by p.received_at desc,p.id desc limit 12
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'profit_request',id,'receivables_request',ar_id,
  'period_start',period_start,'period_end',period_end,
  'accounting_method',accounting_method,'ar_as_of',period_end,
  'currency',header->>'Currency','realm_id',realm_id,
  'profit_received_at',received_at,'receivables_received_at',ar_received_at,
  'profit_sha256',response_sha256,'receivables_sha256',ar_hash)
  order by received_at desc,id desc),'[]'::jsonb) into candidates from pairs;

 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'report.pair_candidates_read',
  jsonb_build_object('candidate_count',jsonb_array_length(candidates)),btrim(p_reason))
 returning id into audit;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','quickbooks-report-pair-candidates/1',
  'audience','openfolk_operator_only','tenant_id',p_tenant,'actor_id',auth.uid(),
  'candidates',candidates,'audit_id',audit);
end $$;

revoke all on function public.learn_quickbooks_report_pair_candidates(uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_quickbooks_report_pair_candidates(uuid,text)
 to authenticated;
commit;
