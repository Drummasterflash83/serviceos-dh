-- Search retained customers under existing operator authority; no links or grants are seeded.
begin;
create function public.learn_quickbooks_customer_search(p_tenant uuid,p_environment text,p_reason text,p_query text,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare entries jsonb;next_id uuid;audit uuid;needle text;begin
 if p_query is null or length(btrim(p_query))>200 or p_query ~ '[[:cntrl:]]' then raise exception 'quickbooks_search_invalid' using errcode='22023';end if;
 needle:=lower(btrim(p_query));
 if p_reason is null or p_environment is null or p_environment not in ('sandbox','production') then
  raise exception 'quickbooks_request_invalid' using errcode='22023';end if;
 perform public.learn_quickbooks_retained_finance_access(p_tenant,p_reason);
 with page as materialized(
  select v.id,l.realm_id,l.external_id,l.conflicted,l.last_observed_at,v.payload,k.card_id,coalesce(k.revision,0) revision
  from public.learn_quickbooks_latest l join public.learn_quickbooks_source_versions v on v.id=l.version_id
  left join public.learn_quickbooks_customer_links k on (k.tenant_id,k.environment,k.realm_id,k.external_id)=(l.tenant_id,l.environment,l.realm_id,l.external_id)
  where l.tenant_id=p_tenant and l.environment=p_environment and l.entity='Customer'
   and (needle='' or strpos(lower(concat_ws(' ',v.payload->>'FullyQualifiedName',v.payload->>'DisplayName',v.payload->>'CompanyName',v.payload#>>'{PrimaryEmailAddr,Address}',v.payload#>>'{PrimaryPhone,FreeFormNumber}',v.payload#>>'{BillAddr,PostalCode}',l.external_id)),needle)>0)
   and (p_after is null or v.id>p_after) order by v.id limit 26
 ),shown as(select * from page order by id limit 25)
 select coalesce((select jsonb_agg(jsonb_build_object('version_id',id,'realm_id',realm_id,'external_id',external_id,
  'name',left(coalesce(payload->>'FullyQualifiedName',payload->>'DisplayName','Unnamed customer'),500),
  'email',left(payload#>>'{PrimaryEmailAddr,Address}',500),'phone',left(payload#>>'{PrimaryPhone,FreeFormNumber}',200),
  'address',left((payload->'BillAddr')::text,2000),'parent_id',left(payload#>>'{ParentRef,value}',200),
  'conflicted',conflicted,'last_observed_at',last_observed_at,'card_id',card_id,'revision',revision::text) order by id) from shown),'[]'::jsonb),
  case when (select count(*) from page)>25 then (select id from shown order by id desc limit 1) end into entries,next_id;
 perform public.learn_quickbooks_retained_finance_access(p_tenant,p_reason);
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'customers.search',jsonb_build_object('filtered',needle<>'','environment',p_environment,'after',p_after,'versions',
  (select coalesce(jsonb_agg(x->'version_id'),'[]'::jsonb) from jsonb_array_elements(entries)x)),btrim(p_reason)) returning id into audit;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','quickbooks-customers/1','tenant_id',p_tenant,'actor_id',auth.uid(),
  'environment',p_environment,'after',p_after,'rows',entries,'next_after',next_id,'observed_at',clock_timestamp(),'audit_id',audit);
end $$;
revoke all on function public.learn_quickbooks_customer_search(uuid,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_quickbooks_customer_search(uuid,text,text,text,uuid) to authenticated;
commit;
