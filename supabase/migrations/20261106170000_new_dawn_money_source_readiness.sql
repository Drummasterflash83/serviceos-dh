-- Operator-only source capability read. No amount, inferred job link, provider
-- request, schedule, client grant or flag is created by installation.
begin;

create function public.learn_quickbooks_money_source_readiness(
 p_tenant uuid,p_connection uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.learn_quickbooks_connections%rowtype;
 qbo_jobs bigint;bill_ref bigint;purchase_ref bigint;invoice_items bigint;item_cost bigint;
 invoice_recurring bigint;invoices bigint;bills bigint;purchases bigint;
 commusoft_versions bigint;commusoft_direct_cost bigint;
 observed timestamptz;audit uuid;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null
  or p_tenant is null or p_connection is null or p_reason is null
  or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'money_readiness_forbidden' using errcode='42501';end if;
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.money_source_readiness' and value='true'::jsonb for share;
 if not found then raise exception 'money_readiness_disabled' using errcode='42501';end if;
 select * into c from public.learn_quickbooks_connections
  where id=p_connection and tenant_id=p_tenant and realm_id is not null
   and environment in('production','sandbox') and status in('active','paused')
   and confirmed_at is not null for share;
 if not found then raise exception 'money_readiness_connection_unavailable' using errcode='42501';end if;

 with q as materialized(
  select l.entity,l.last_observed_at,v.payload
  from public.learn_quickbooks_latest l
  join public.learn_quickbooks_source_versions v on v.id=l.version_id
   and v.tenant_id=l.tenant_id and v.environment=l.environment
   and v.realm_id=l.realm_id and v.entity=l.entity and v.external_id=l.external_id
  where l.tenant_id=p_tenant and l.environment=c.environment and l.realm_id=c.realm_id
   and l.entity in('Customer','Invoice','Bill','Purchase','Item') and not l.conflicted
 ) select
  count(*) filter(where entity='Customer' and payload->'Job'='true'::jsonb and payload ? 'ParentRef'),
  count(*) filter(where entity='Bill' and (
   jsonb_path_exists(payload,'$.Line[*].AccountBasedExpenseLineDetail.CustomerRef') or
   jsonb_path_exists(payload,'$.Line[*].ItemBasedExpenseLineDetail.CustomerRef'))),
  count(*) filter(where entity='Purchase' and (
   jsonb_path_exists(payload,'$.Line[*].AccountBasedExpenseLineDetail.CustomerRef') or
   jsonb_path_exists(payload,'$.Line[*].ItemBasedExpenseLineDetail.CustomerRef'))),
  count(*) filter(where entity='Invoice' and
   jsonb_path_exists(payload,'$.Line[*].SalesItemLineDetail.ItemRef')),
  count(*) filter(where entity='Item' and payload ? 'PurchaseCost'),
  count(*) filter(where entity='Invoice' and payload ?| array[
   'RecurringInfo','RecurringTransactionRef','SubscriptionRef','ContractRef','billingFrequency']),
  count(*) filter(where entity='Invoice'),count(*) filter(where entity='Bill'),
  count(*) filter(where entity='Purchase'),max(last_observed_at)
 into qbo_jobs,bill_ref,purchase_ref,invoice_items,item_cost,invoice_recurring,
  invoices,bills,purchases,observed from q;

 select count(*),count(*) filter(where payload ?| array[
  'actualCost','totalCost','labourCost','laborCost','partsCost','expenses',
  'costs','materials','invoiceLines','invoices'])
 into commusoft_versions,commusoft_direct_cost
 from public.learn_business_input_versions
 where tenant_id=p_tenant and provider='commusoft' and collection='jobs';

 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'money.source_readiness_read',jsonb_build_object(
  'connection_id',c.id,'realm_id',c.realm_id,'environment',c.environment,
  'latest_invoice_count',invoices,'commusoft_job_version_count',commusoft_versions),
  btrim(p_reason)) returning id into audit;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','quickbooks-money-source-readiness/1',
  'audience','openfolk_operator_only','tenant_id',p_tenant,'connection_id',c.id,
  'environment',c.environment,'realm_id',c.realm_id,'read_at',clock_timestamp(),
  'latest_qbo_observed_at',observed,'audit_id',audit,
  'commusoft_scope','all_retained_tenant_connections',
  'retained',jsonb_build_object('invoice_latest',invoices,'bill_latest',bills,
   'purchase_latest',purchases,'qbo_job_customers',qbo_jobs,
   'bill_customer_line_refs',bill_ref,'purchase_customer_line_refs',purchase_ref,
   'invoice_item_refs',invoice_items,'items_with_purchase_cost_field',item_cost,
   'invoices_with_checked_recurring_markers',invoice_recurring,
   'commusoft_job_versions',commusoft_versions,
   'commusoft_jobs_with_checked_direct_cost_fields',commusoft_direct_cost),
  'field_gp',jsonb_build_object('status','held',
   'reason','cross_provider_job_mapping_and_actual_cost_not_verified'),
  'arr',jsonb_build_object('status','held',
   'reason','recurring_contract_and_period_not_verified'),
  'limits',jsonb_build_array('field_presence_is_not_financial_value',
   'customer_ref_is_not_commusoft_job_link','item_purchase_cost_is_not_actual_job_cost',
   'no_recurring_transaction_entity_in_current_import_adapter'));
end $$;

revoke all on function public.learn_quickbooks_money_source_readiness(uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_quickbooks_money_source_readiness(uuid,uuid,text) to authenticated;
commit;
