-- Classify a bounded page of cards by explicit reviewed business-source links.
-- A communication-derived identity is not, by itself, a confirmed customer.
-- This read does not change cards, links, source history, capture or scores.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create index if not exists learn_business_input_customer_card_lookup
  on public.learn_business_input_links(tenant_id,card_id)
  where entity_kind='customer' and card_id is not null;

create function public.learn_customer_card_provenance(p_tenant uuid,p_cards uuid[])
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb; wanted integer;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null
  or p_tenant is null or p_tenant is distinct from public.current_tenant_id()
 then raise exception 'customer_card_provenance_forbidden' using errcode='42501';end if;
 wanted:=cardinality(p_cards);
 if wanted is null or wanted not between 1 and 24
  or exists(select 1 from unnest(p_cards) as input(card_id) where card_id is null)
  or (select count(distinct card_id) from unnest(p_cards) as input(card_id))<>wanted
 then raise exception 'customer_card_provenance_invalid' using errcode='22023';end if;
 if (select count(*) from public.customer_cards c where c.tenant_id=p_tenant
    and c.id=any(p_cards))<>wanted
 then raise exception 'customer_card_provenance_unavailable' using errcode='42501';end if;

 select jsonb_agg(jsonb_build_object('id',c.id,'state',
    case when exists(select 1 from public.learn_business_input_links l
      where l.tenant_id=c.tenant_id and l.card_id=c.id and l.entity_kind='customer')
      or exists(select 1 from public.learn_quickbooks_customer_links q
      where q.tenant_id=c.tenant_id and q.card_id=c.id and q.environment='production')
    then 'reviewed_business_customer'
    when c.context ? 'projection' then 'communication_identity'
    else 'unconfirmed_identity' end) order by requested.ordinality)
 into result
 from unnest(p_cards) with ordinality requested(id,ordinality)
 join public.customer_cards c on c.id=requested.id and c.tenant_id=p_tenant;
 return jsonb_build_object('version','learn-customer-card-provenance/1',
   'tenantId',p_tenant,'cards',result);
end $$;
revoke all on function public.learn_customer_card_provenance(uuid,uuid[])
  from public,anon,authenticated,service_role;
grant execute on function public.learn_customer_card_provenance(uuid,uuid[])
  to authenticated;
commit;
