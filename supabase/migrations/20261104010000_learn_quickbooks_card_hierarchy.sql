-- Prepare native QuickBooks customer/subaccount coverage for a reviewed card.
-- A reviewed parent identity is the only anchor. Conflicted child sources and
-- explicit child link decisions for another card (or an unlink) are boundaries.
-- This does not match a QuickBooks subaccount to a Commusoft job.
begin;
do $patch$
declare
 definition text;
 needle text:=$old$
 ),matched as materialized(
  select l.version_id,l.realm_id,l.entity,l.external_id,l.conflicted,l.last_observed_at,v.source_updated_at,v.payload,
   case when v.payload#>>'{CurrencyRef,value}' ~ '^[A-Z]{3}$' then v.payload#>>'{CurrencyRef,value}' end currency,
   public.learn_quickbooks_money(v.payload->'TotalAmt') amount,public.learn_quickbooks_money(v.payload->'Balance') balance
  from links k join public.learn_quickbooks_latest l on l.tenant_id=k.tenant_id and l.environment=k.environment and l.realm_id=k.realm_id
  join public.learn_quickbooks_source_versions v on v.id=l.version_id
  where k.current_identity and l.entity in ('Invoice','Payment','CreditMemo','SalesReceipt','Estimate') and v.payload#>>'{CustomerRef,value}'=k.external_id
 ),usable as materialized$old$;
 replacement text:=$new$
 ),customers as materialized(
  select l.realm_id,l.external_id,l.conflicted,v.payload,
   nullif(v.payload#>>'{ParentRef,value}','') parent_id
  from public.learn_quickbooks_latest l
  join public.learn_quickbooks_source_versions v on v.id=l.version_id
  where l.tenant_id=p_tenant and l.environment=p_environment and l.entity='Customer'
 ),accounts as(
  select k.realm_id,k.external_id customer_id,array[k.external_id] path,0 depth
  from links k where k.current_identity
  union all
  select c.realm_id,c.external_id,a.path||c.external_id,a.depth+1
  from accounts a join customers c on c.realm_id=a.realm_id and c.parent_id=a.customer_id
  where c.conflicted is false and a.depth<32 and not c.external_id=any(a.path)
   and not exists(
    select 1 from public.learn_quickbooks_customer_links held
    where (held.tenant_id,held.environment,held.realm_id,held.external_id)=
     (p_tenant,p_environment,c.realm_id,c.external_id)
     and (held.card_id is distinct from p_card or
      held.identity is distinct from public.learn_quickbooks_customer_identity(c.payload))
   )
 ),eligible as materialized(
  select distinct realm_id,customer_id from accounts
 ),matched as materialized(
  select l.version_id,l.realm_id,l.entity,l.external_id,l.conflicted,l.last_observed_at,v.source_updated_at,v.payload,
   case when v.payload#>>'{CurrencyRef,value}' ~ '^[A-Z]{3}$' then v.payload#>>'{CurrencyRef,value}' end currency,
   public.learn_quickbooks_money(v.payload->'TotalAmt') amount,public.learn_quickbooks_money(v.payload->'Balance') balance
  from eligible a join public.learn_quickbooks_latest l
   on l.tenant_id=p_tenant and l.environment=p_environment and l.realm_id=a.realm_id
  join public.learn_quickbooks_source_versions v on v.id=l.version_id
  where l.entity in ('Invoice','Payment','CreditMemo','SalesReceipt','Estimate')
   and v.payload#>>'{CustomerRef,value}'=a.customer_id
 ),usable as materialized$new$;
begin
 if to_regprocedure('public.learn_quickbooks_customer_finance(uuid,uuid,text,uuid,text)') is null then
  raise exception 'QuickBooks finance reader missing';end if;
 select pg_get_functiondef('public.learn_quickbooks_customer_finance(uuid,uuid,text,uuid,text)'::regprocedure)
 into definition;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
  or position('public.learn_quickbooks_retained_finance_access(' in definition)=0
  or position('customers as materialized(' in definition)>0 then
  raise exception 'QuickBooks finance reader differs; inspect before changing';end if;
 execute replace(replace(definition,'with links as materialized(',
  'with recursive links as materialized('),needle,replacement);
end $patch$;
commit;
