-- Operator-only accounts margin from one verified saved QuickBooks P&L pair.
-- No provider request, target comparison, client grant or flag seed.
begin;

create function public.learn_quickbooks_accounts_margin_preview(
  p_tenant uuid, p_profit_request uuid, p_receivables_request uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  report jsonb;
  receipt public.learn_quickbooks_report_receipts%rowtype;
  rows jsonb;
  income_row jsonb;
  cogs_row jsonb;
  gp_row jsonb;
  income_text text;
  cogs_text text;
  gp_text text;
  income_amount numeric;
  cogs_amount numeric;
  gp_amount numeric;
  audit uuid;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null
    or p_tenant is null or p_profit_request is null or p_receivables_request is null
    or p_profit_request=p_receivables_request or p_reason is null
    or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'accounts_margin_forbidden' using errcode='42501';
  end if;
  perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
  perform 1 from public.feature_flags where tenant_id=p_tenant
    and flag='new_dawn.report_margin_preview' and value='true'::jsonb for share;
  if not found then raise exception 'accounts_margin_disabled' using errcode='42501';end if;

  -- The existing reader checks actor, tenant, realm, environment, dates, basis,
  -- verified receipt hashes and the independent report-summary flag. It also
  -- creates the normal report-summary read audit before returning exact decimals.
  report:=public.learn_quickbooks_report_summary_preview(
    p_tenant,p_profit_request,p_receivables_request,p_reason);
  if report->>'tenant_id' is distinct from p_tenant::text
    or report->>'audience' is distinct from 'openfolk_operator_only'
    or report->>'environment' is null
    or report->>'environment' not in ('production','sandbox')
    or report->>'source' is distinct from 'QuickBooks Online'
    or report->>'scope' is distinct from 'company_accounts_report_not_job_costing'
    or report->>'profit_request' is distinct from p_profit_request::text
    or report->>'receivables_request' is distinct from p_receivables_request::text
    or report->>'period_end' is distinct from report->>'ar_as_of' then
    raise exception 'accounts_margin_pair_held' using errcode='42501';
  end if;
  select * into receipt from public.learn_quickbooks_report_receipts
    where request_id=p_profit_request and tenant_id=p_tenant
      and report_kind='ProfitAndLoss' and validation_state='verified'
      and response_sha256=report->>'profit_sha256' for share;
  if receipt.request_id is null then
    raise exception 'accounts_margin_receipt_held' using errcode='42501';
  end if;
  rows:=receipt.raw_response::jsonb#>'{Rows,Row}';
  if jsonb_typeof(rows) is distinct from 'array' then
    raise exception 'accounts_margin_shape_held' using errcode='22023';
  end if;
  if (select count(*) from jsonb_array_elements(rows) x
      where x->>'type'='Section' and x->>'group'='Income')<>1
    or (select count(*) from jsonb_array_elements(rows) x
      where x->>'type'='Section' and x->>'group'='COGS')<>1
    or (select count(*) from jsonb_array_elements(rows) x
      where x->>'type'='Section' and x->>'group'='GrossProfit')<>1 then
    raise exception 'accounts_margin_shape_held' using errcode='22023';
  end if;
  select x into income_row from jsonb_array_elements(rows) x
    where x->>'type'='Section' and x->>'group'='Income';
  select x into cogs_row from jsonb_array_elements(rows) x
    where x->>'type'='Section' and x->>'group'='COGS';
  select x into gp_row from jsonb_array_elements(rows) x
    where x->>'type'='Section' and x->>'group'='GrossProfit';
  if jsonb_typeof(income_row#>'{Summary,ColData}') is distinct from 'array'
    or jsonb_typeof(cogs_row#>'{Summary,ColData}') is distinct from 'array'
    or jsonb_typeof(gp_row#>'{Summary,ColData}') is distinct from 'array'
    or jsonb_array_length(income_row#>'{Summary,ColData}')<>2
    or jsonb_array_length(cogs_row#>'{Summary,ColData}')<>2
    or jsonb_array_length(gp_row#>'{Summary,ColData}')<>2
    or income_row#>>'{Summary,ColData,0,value}' is distinct from 'Total Income'
    or cogs_row#>>'{Summary,ColData,0,value}' is distinct from 'Total Cost of Sales'
    or gp_row#>>'{Summary,ColData,0,value}' is distinct from 'Gross Profit' then
    raise exception 'accounts_margin_shape_held' using errcode='22023';
  end if;
  income_text:=income_row#>>'{Summary,ColData,1,value}';
  cogs_text:=cogs_row#>>'{Summary,ColData,1,value}';
  gp_text:=gp_row#>>'{Summary,ColData,1,value}';
  if income_text is null or cogs_text is null or gp_text is null
    or income_text !~ '^-?[0-9]{1,40}(\.[0-9]{1,10})?$'
    or cogs_text !~ '^-?[0-9]{1,40}(\.[0-9]{1,10})?$'
    or gp_text !~ '^-?[0-9]{1,40}(\.[0-9]{1,10})?$'
    or gp_text is distinct from report#>>'{summary,accounts_gross_profit}' then
    raise exception 'accounts_margin_amount_held' using errcode='22023';
  end if;
  income_amount:=income_text::numeric;
  cogs_amount:=cogs_text::numeric;
  gp_amount:=gp_text::numeric;
  if income_amount<=0 or income_amount-cogs_amount<>gp_amount then
    raise exception 'accounts_margin_reconciliation_held' using errcode='22023';
  end if;
  perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
  perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
  insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
    values(p_tenant,auth.uid(),'report.accounts_margin_preview_read',jsonb_build_object(
      'profit_request',p_profit_request,'receivables_request',p_receivables_request,
      'profit_sha256',receipt.response_sha256,'report_summary_audit',report->>'audit_id'),
      btrim(p_reason)) returning id into audit;
  perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
  return jsonb_build_object(
    'version','quickbooks-accounts-margin-preview/1',
    'audience','openfolk_operator_only','tenant_id',p_tenant,'actor_id',auth.uid(),
    'source','QuickBooks Online','scope','company_accounts_not_job_margin',
    'realm_id',report->>'realm_id','environment',report->>'environment',
    'currency',report#>>'{summary,currency}',
    'profit_request',p_profit_request,'receivables_request',p_receivables_request,
    'profit_sha256',receipt.response_sha256,'receivables_sha256',report->>'receivables_sha256',
    'period_start',report->>'period_start','period_end',report->>'period_end',
    'accounting_method',report->>'accounting_method',
    'total_income',income_text,'accounts_gross_profit',gp_text,
    'accounts_gross_margin_pct',round(gp_amount/income_amount*100,2)::text,
    'denominator','QuickBooks Total Income',
    'target_comparison','withheld_unconfirmed_accounts_or_field_basis',
    'audit_id',audit,'report_summary_audit_id',report->>'audit_id');
end $$;

revoke all on function public.learn_quickbooks_accounts_margin_preview(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.learn_quickbooks_accounts_margin_preview(uuid,uuid,uuid,text)
  to authenticated;
commit;
