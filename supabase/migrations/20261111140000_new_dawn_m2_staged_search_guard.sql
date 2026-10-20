-- Reversed staged canonical rows remain retained for audit. Hide only those
-- rows from the generic client card search; other rows and search grants stay.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.new_dawn_m2_staged_search_visible(
 p_tenant uuid,p_kind text,p_entity uuid
) returns boolean language plpgsql stable security definer
 set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();
begin
 if auth.role() is distinct from 'authenticated' or actor is null
  or p_tenant is null or p_entity is null or p_kind not in ('customer','job') then
  raise exception 'staged_search_forbidden' using errcode='42501';end if;
 if not exists(select 1 from public.profiles p
  where p.id=actor and p.tenant_id=p_tenant) then
  perform public.learn_operator_input_access(p_tenant,actor,false);
 end if;
 if p_kind='job' then
  return not exists(select 1 from public.new_dawn_m2_identity_items i
   join public.new_dawn_m2_identity_batches b on b.id=i.batch_id
   where b.tenant_id=p_tenant and i.kind='job'
    and i.entity_id=p_entity and i.state='reversed'
    and not exists(select 1 from public.learn_business_input_current_links l
     where l.tenant_id=p_tenant and l.entity_kind='job'
      and l.entity_id=p_entity));
 end if;
 return not exists(select 1 from public.new_dawn_m2_identity_items i
  join public.new_dawn_m2_identity_batches b on b.id=i.batch_id
  join public.learn_business_input_links source_link on source_link.id=i.link_id
   and source_link.tenant_id=b.tenant_id
  where b.tenant_id=p_tenant and i.kind='customer'
   and i.state='reversed' and source_link.card_id=p_entity
   and not exists(select 1 from public.learn_business_input_current_links l
    where l.tenant_id=p_tenant and l.entity_kind='customer'
     and l.card_id=p_entity));
end $$;
revoke all on function public.new_dawn_m2_staged_search_visible(uuid,text,uuid)
 from public,anon,service_role;
grant execute on function public.new_dawn_m2_staged_search_visible(uuid,text,uuid)
 to authenticated;

-- Preserve the existing security-invoker/RLS behavior and all search kinds.
-- Abort migration on a drifted implementation rather than replacing an
-- unknown newer search function.
do $$
declare definition text;invoker boolean;
 customer_needle text:='from public.customer_cards where tenant_id=p_tenant and true';
 job_needle text:='from public.jobs where tenant_id=p_tenant and true';
begin
 select pg_get_functiondef(p.oid),not p.prosecdef into definition,invoker
 from pg_proc p
 where p.oid='public.learn_card_search(uuid,text,text,integer,uuid)'::regprocedure;
 if definition is null
  or position(customer_needle in definition)=0
  or position(job_needle in definition)=0
  or not invoker then
  raise exception 'learn_card_search_contract_changed' using errcode='PT409';end if;
 definition:=replace(definition,customer_needle,
  customer_needle||' and public.new_dawn_m2_staged_search_visible(p_tenant,''customer'',id)');
 definition:=replace(definition,job_needle,
  job_needle||' and public.new_dawn_m2_staged_search_visible(p_tenant,''job'',id)');
 execute definition;
end $$;
commit;
