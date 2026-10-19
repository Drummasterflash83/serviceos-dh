-- Company money evidence from retained QuickBooks invoices. This is a read
-- model, not an accounting P&L, job-cost calculation or complete A/R report.
-- Installation does not call QuickBooks, refresh a connection or seed values.
begin;

create function public.learn_quickbooks_strict_date(p_value text) returns date
language plpgsql immutable strict set search_path=pg_catalog as $$
declare parsed date;
begin
 if p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null;end if;
 parsed:=make_date(substr(p_value,1,4)::int,substr(p_value,6,2)::int,substr(p_value,9,2)::int);
 return parsed;
exception when others then return null;
end $$;

create function public.learn_quickbooks_owner_money(
 p_tenant uuid,
 p_environment text default 'production',
 p_operator_reason text default null
) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
 groups jsonb;
 attention jsonb;
 overdue_invoice_count bigint;
 record_count bigint;
 conflicted_count bigint;
 audit uuid;
 read_at timestamptz:=clock_timestamp();
 as_of date:=(clock_timestamp() at time zone 'UTC')::date;
begin
 if p_environment is null or p_environment not in ('sandbox','production') then
  raise exception 'quickbooks_request_invalid' using errcode='22023';
 end if;
 -- Existing retained-finance authority requires a current company owner/admin
 -- or an explicitly reasoned OpenFolk operator read. It checks live user state.
 perform public.learn_quickbooks_retained_finance_access(p_tenant,p_operator_reason);
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.owner_money' and value='true'::jsonb for share;
 if not found then raise exception 'owner_money_not_enabled' using errcode='42501';end if;

 with invoices as materialized(
  select l.realm_id,l.version_id,l.last_observed_at,l.conflicted,
   v.source_updated_at,v.payload,
   case when v.payload#>>'{CurrencyRef,value}' ~ '^[A-Z]{3}$'
    then v.payload#>>'{CurrencyRef,value}' end currency,
   public.learn_quickbooks_money(v.payload->'Balance') balance,
   public.learn_quickbooks_strict_date(v.payload->>'DueDate') due_date
  from public.learn_quickbooks_latest l
  join public.learn_quickbooks_source_versions v
   on v.id=l.version_id and v.tenant_id=l.tenant_id
  where l.tenant_id=p_tenant and l.environment=p_environment
   and l.entity='Invoice'
 ), usable as materialized(select * from invoices where not conflicted),
 totals as(
  select realm_id,currency,count(*) records,
   count(*) filter(where balance is null) missing_balances,
   count(*) filter(where balance>0 and due_date is null) undated_positive,
   count(*) filter(where balance<0) negative_balances,
   min(last_observed_at) oldest_observed_at,
   max(last_observed_at) newest_observed_at,
   max(source_updated_at) newest_source_updated_at,
   sum(balance) balance_total,
   coalesce(sum(balance) filter(where balance>0 and due_date<as_of),0::numeric) overdue_total,
   coalesce(sum(balance) filter(where balance>0 and due_date>=as_of),0::numeric) not_due_total,
   coalesce(sum(balance) filter(where balance>0 and due_date<as_of and due_date>=as_of-30),0::numeric) overdue_1_30,
   coalesce(sum(balance) filter(where balance>0 and due_date<as_of-30 and due_date>=as_of-60),0::numeric) overdue_31_60,
   coalesce(sum(balance) filter(where balance>0 and due_date<as_of-60 and due_date>=as_of-90),0::numeric) overdue_61_90,
   coalesce(sum(balance) filter(where balance>0 and due_date<as_of-90),0::numeric) overdue_91_plus
  from usable group by realm_id,currency
 )
 select
  coalesce((select jsonb_agg(jsonb_build_object(
   'realm_id',realm_id,'currency',currency,'records',records,
   'missing_balances',missing_balances,'undated_positive',undated_positive,
   'negative_balances',negative_balances,
   'oldest_observed_at',oldest_observed_at,'newest_observed_at',newest_observed_at,
   'newest_source_updated_at',newest_source_updated_at,
   'outstanding',case when currency is not null and missing_balances=0 then balance_total::text end,
   'overdue',case when currency is not null and missing_balances=0 and undated_positive=0 then overdue_total::text end,
   'not_due',case when currency is not null and missing_balances=0 and undated_positive=0 then not_due_total::text end,
   'overdue_1_30',case when currency is not null and missing_balances=0 and undated_positive=0 then overdue_1_30::text end,
   'overdue_31_60',case when currency is not null and missing_balances=0 and undated_positive=0 then overdue_31_60::text end,
   'overdue_61_90',case when currency is not null and missing_balances=0 and undated_positive=0 then overdue_61_90::text end,
   'overdue_91_plus',case when currency is not null and missing_balances=0 and undated_positive=0 then overdue_91_plus::text end
  ) order by realm_id,currency nulls last) from totals),'[]'::jsonb),
  (select count(*) from invoices),(select count(*) from invoices where conflicted)
 into groups,record_count,conflicted_count;

 -- A bounded source trail for the oldest overdue invoices. The reference is
 -- QuickBooks' own invoice identity, never an inferred Commusoft job link.
 with overdue as materialized(
  select l.realm_id,l.version_id,l.external_id,l.last_observed_at,
   v.payload,public.learn_quickbooks_money(v.payload->'Balance') balance,
   public.learn_quickbooks_strict_date(v.payload->>'DueDate') due_date,
   case when v.payload#>>'{CurrencyRef,value}' ~ '^[A-Z]{3}$'
    then v.payload#>>'{CurrencyRef,value}' end currency
  from public.learn_quickbooks_latest l
  join public.learn_quickbooks_source_versions v
   on v.id=l.version_id and v.tenant_id=l.tenant_id
  where l.tenant_id=p_tenant and l.environment=p_environment
   and l.entity='Invoice' and not l.conflicted
 ), eligible as materialized(
  select * from overdue where balance>0 and due_date<as_of
 ), oldest as(
  select * from eligible order by due_date,version_id limit 20
 )
 select coalesce((select jsonb_agg(jsonb_build_object(
   'realm_id',realm_id,'currency',currency,'source_version_id',version_id,
   'invoice_id',external_id,'document_number',left(payload->>'DocNumber',200),
   'customer_ref',left(payload#>>'{CustomerRef,value}',128),
   'due_date',due_date,'balance',balance::text,
   'last_observed_at',last_observed_at
  ) order by due_date,version_id) from oldest),'[]'::jsonb),
  (select count(*) from eligible)
 into attention,overdue_invoice_count;

 perform public.learn_quickbooks_retained_finance_access(p_tenant,p_operator_reason);
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'owner.money.read',
  jsonb_build_object('environment',p_environment,'records',record_count,
   'conflicted_records',conflicted_count,'as_of',as_of),
  p_operator_reason) returning id into audit;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object(
  'version','quickbooks-owner-money/1','tenant_id',p_tenant,'actor_id',auth.uid(),
  'environment',p_environment,'operator_mode',p_operator_reason is not null,
  'coverage','retained_unreconciled_invoices','source','QuickBooks Online',
  'as_of',as_of,'read_at',read_at,'audit_id',audit,
  'records',record_count,'conflicted_records',conflicted_count,'groups',groups,
  'overdue_invoice_count',overdue_invoice_count,'attention',attention,
  'accounts_gross_profit',jsonb_build_object('status','unavailable','reason','profit_and_loss_report_not_captured'),
  'field_gross_profit',jsonb_build_object('status','unavailable','reason','job_cost_mapping_not_verified'),
  'net_profit',jsonb_build_object('status','withheld','reason','owner_report_not_captured'),
  'arr',jsonb_build_object('status','unavailable','reason','recurrence_not_verified'),
  'further_works',jsonb_build_object('status','unavailable','reason','source_linkage_not_verified')
 );
end $$;

revoke all on function public.learn_quickbooks_strict_date(text),
 public.learn_quickbooks_owner_money(uuid,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_quickbooks_owner_money(uuid,text,text) to authenticated;
commit;
