-- Strict operator-only extraction from already retained QuickBooks reports.
-- No provider call, client grant, schedule, flag seed or published figure.
begin;

create function public.learn_quickbooks_report_summary_extract(p_profit jsonb,p_receivables jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare pl_columns jsonb:=p_profit#>'{Columns,Column}';ar_columns jsonb:=p_receivables#>'{Columns,Column}';
 pl_rows jsonb:=p_profit#>'{Rows,Row}';ar_rows jsonb:=p_receivables#>'{Rows,Row}';
 gp jsonb;np jsonb;ar jsonb;n bigint;gp_text text;np_text text;amounts text[]:=array[]::text[];
 item jsonb;i int;total numeric:=0;
begin
 if p_profit#>>'{Header,ReportName}' is distinct from 'ProfitAndLoss'
  or p_receivables#>>'{Header,ReportName}' is distinct from 'AgedReceivables'
  or p_profit#>>'{Header,Currency}' is distinct from p_receivables#>>'{Header,Currency}'
  or not coalesce((p_profit#>>'{Header,Currency}') ~ '^[A-Z]{3}$',false)
  or jsonb_typeof(pl_columns) is distinct from 'array' or jsonb_array_length(pl_columns)<>2
  or pl_columns#>>'{0,ColType}' is distinct from 'Account'
  or pl_columns#>>'{1,ColType}' is distinct from 'Money'
  or jsonb_typeof(ar_columns) is distinct from 'array' or jsonb_array_length(ar_columns)<>7
  or ar_columns#>>'{0,ColType}' is distinct from 'Customer'
  or ar_columns#>>'{1,ColType}' is distinct from 'Money'
  or ar_columns#>>'{2,ColType}' is distinct from 'Money'
  or ar_columns#>>'{3,ColType}' is distinct from 'Money'
  or ar_columns#>>'{4,ColType}' is distinct from 'Money'
  or ar_columns#>>'{5,ColType}' is distinct from 'Money'
  or ar_columns#>>'{6,ColType}' is distinct from 'Money'
  or ar_columns#>>'{1,ColTitle}' is distinct from 'Current'
  or ar_columns#>>'{2,ColTitle}' is distinct from '1 - 30'
  or ar_columns#>>'{3,ColTitle}' is distinct from '31 - 60'
  or ar_columns#>>'{4,ColTitle}' is distinct from '61 - 90'
  or ar_columns#>>'{5,ColTitle}' is distinct from '91 and over'
  or ar_columns#>>'{6,ColTitle}' is distinct from 'Total'
  or jsonb_typeof(pl_rows) is distinct from 'array'
  or jsonb_typeof(ar_rows) is distinct from 'array' then
  raise exception 'report_summary_shape_held' using errcode='22023';end if;
 select count(*),(jsonb_agg(x))->0 into n,gp from jsonb_array_elements(pl_rows)x
  where x->>'type'='Section' and x->>'group'='GrossProfit';
 if n<>1 or jsonb_typeof(gp#>'{Summary,ColData}') is distinct from 'array'
  or jsonb_array_length(gp#>'{Summary,ColData}')<>2 then
  raise exception 'report_summary_shape_held' using errcode='22023';end if;
 select count(*),(jsonb_agg(x))->0 into n,np from jsonb_array_elements(pl_rows)x
  where x->>'type'='Section' and x->>'group'='NetIncome';
 if n<>1 or jsonb_typeof(np#>'{Summary,ColData}') is distinct from 'array'
  or jsonb_array_length(np#>'{Summary,ColData}')<>2 then
  raise exception 'report_summary_shape_held' using errcode='22023';end if;
 select count(*),(jsonb_agg(x))->0 into n,ar from jsonb_array_elements(ar_rows)x
  where x->>'type'='Section' and x->>'group'='GrandTotal';
 if n<>1 or jsonb_typeof(ar#>'{Summary,ColData}') is distinct from 'array'
  or jsonb_array_length(ar#>'{Summary,ColData}')<>7 then
  raise exception 'report_summary_shape_held' using errcode='22023';end if;
 gp_text:=gp#>>'{Summary,ColData,1,value}';np_text:=np#>>'{Summary,ColData,1,value}';
 if gp_text is null or np_text is null
  or gp_text !~ '^-?[0-9]{1,40}(\.[0-9]{1,10})?$'
  or np_text !~ '^-?[0-9]{1,40}(\.[0-9]{1,10})?$' then
  raise exception 'report_summary_amount_held' using errcode='22023';end if;
 for i in 1..6 loop
  item:=ar#>'{Summary,ColData}'->i;
  if item->>'value' is null or item->>'value' !~ '^-?[0-9]{1,40}(\.[0-9]{1,10})?$' then
   raise exception 'report_summary_amount_held' using errcode='22023';end if;
  amounts:=array_append(amounts,item->>'value');
  if i<6 then total:=total+(item->>'value')::numeric;end if;
 end loop;
 if total<>amounts[6]::numeric then
  raise exception 'report_summary_total_held' using errcode='22023';end if;
 return jsonb_build_object('currency',p_profit#>>'{Header,Currency}',
  'accounts_gross_profit',gp_text,'net_profit',np_text,
  'ar_current',amounts[1],'ar_1_30',amounts[2],'ar_31_60',amounts[3],
  'ar_61_90',amounts[4],'ar_91_plus',amounts[5],'ar_total',amounts[6]);
end $$;

create function public.learn_quickbooks_report_summary_preview(
 p_tenant uuid,p_profit_request uuid,p_receivables_request uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare pl public.learn_quickbooks_report_requests%rowtype;ar public.learn_quickbooks_report_requests%rowtype;
 pl_receipt public.learn_quickbooks_report_receipts%rowtype;ar_receipt public.learn_quickbooks_report_receipts%rowtype;
 summary jsonb;audit uuid;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null
  or p_profit_request is null or p_receivables_request is null or p_profit_request=p_receivables_request
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'report_summary_forbidden' using errcode='42501';end if;
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.report_summary_preview' and value='true'::jsonb for share;
 if not found then raise exception 'report_summary_disabled' using errcode='42501';end if;
 select * into pl from public.learn_quickbooks_report_requests
  where id=p_profit_request and tenant_id=p_tenant and actor_id=auth.uid()
   and report_kind='ProfitAndLoss' and state='complete' for share;
 select * into ar from public.learn_quickbooks_report_requests
  where id=p_receivables_request and tenant_id=p_tenant and actor_id=auth.uid()
   and report_kind='AgedReceivables' and state='complete' for share;
 if pl.id is null or ar.id is null or pl.connection_id<>ar.connection_id
  or pl.environment<>ar.environment or pl.realm_id<>ar.realm_id
  or pl.period_end<>ar.report_date or pl.accounting_method is null
  or ar.aging_method is distinct from 'Report_Date' then
  raise exception 'report_summary_scope_held' using errcode='42501';end if;
 select * into pl_receipt from public.learn_quickbooks_report_receipts
  where request_id=pl.id and tenant_id=p_tenant and report_kind='ProfitAndLoss'
   and validation_state='verified' for share;
 select * into ar_receipt from public.learn_quickbooks_report_receipts
  where request_id=ar.id and tenant_id=p_tenant and report_kind='AgedReceivables'
   and validation_state='verified' for share;
 if pl_receipt.request_id is null or ar_receipt.request_id is null then
  raise exception 'report_summary_receipt_held' using errcode='42501';end if;
 summary:=public.learn_quickbooks_report_summary_extract(
  pl_receipt.raw_response::jsonb,ar_receipt.raw_response::jsonb);
 if pl_receipt.header->>'StartPeriod' is distinct from pl.period_start::text
  or pl_receipt.header->>'EndPeriod' is distinct from pl.period_end::text
  or pl_receipt.header->>'ReportBasis' is distinct from pl.accounting_method
  or not exists(select 1 from jsonb_array_elements(case when
     jsonb_typeof(ar_receipt.header->'Option')='array' then ar_receipt.header->'Option'
     else '[]'::jsonb end) x
   where x->>'Name'='report_date' and x->>'Value'=ar.report_date::text) then
  raise exception 'report_summary_scope_held' using errcode='42501';end if;
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'report.summary_preview_read',jsonb_build_object(
  'profit_request',pl.id,'receivables_request',ar.id,
  'profit_sha256',pl_receipt.response_sha256,'receivables_sha256',ar_receipt.response_sha256),
  btrim(p_reason)) returning id into audit;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','quickbooks-report-summary-preview/1',
  'audience','openfolk_operator_only','tenant_id',p_tenant,'realm_id',pl.realm_id,
  'environment',pl.environment,'profit_request',pl.id,'receivables_request',ar.id,
  'profit_sha256',pl_receipt.response_sha256,'receivables_sha256',ar_receipt.response_sha256,
  'period_start',pl.period_start,'period_end',pl.period_end,
  'accounting_method',pl.accounting_method,'ar_as_of',ar.report_date,
  'aging_method',ar.aging_method,'report_time_profit',pl_receipt.header->>'Time',
  'report_time_receivables',ar_receipt.header->>'Time','source','QuickBooks Online',
  'scope','company_accounts_report_not_job_costing','summary',summary,'audit_id',audit);
end $$;

revoke all on function public.learn_quickbooks_report_summary_extract(jsonb,jsonb),
 public.learn_quickbooks_report_summary_preview(uuid,uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_quickbooks_report_summary_preview(uuid,uuid,uuid,text) to authenticated;
commit;
