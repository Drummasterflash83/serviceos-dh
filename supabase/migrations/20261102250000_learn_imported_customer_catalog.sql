-- Read retained customer accounts; never infer an identity or publish a link.
-- Existing company-owner/admin and logged finance-operator authority only.
begin;
create function public.learn_imported_source_text(p jsonb,path text[],maximum integer)
returns text language sql immutable set search_path=pg_catalog as $$
 select case when jsonb_typeof(p#>path)='string' then nullif(left(btrim(p#>>path),maximum),'') end;
$$;
revoke all on function public.learn_imported_source_text(jsonb,text[],integer) from public,anon,authenticated,service_role;
create function public.learn_imported_customer_sources(p_tenant uuid,p_environment text)
returns table(source_key text,provider text,scope_ref text,external_id text,version_id uuid,name text,contact_name text,email text,phone text,address text,source_active boolean,observed_at timestamptz,source_updated_at timestamptz,card_id uuid,review_state text)
language sql stable set search_path=pg_catalog as $$
 with cs_observed as materialized(
  select v.id,v.connection_id,v.external_id,max(p.committed_at) seen
  from public.learn_business_input_versions v join public.learn_business_input_observations o on o.version_id=v.id
  join public.learn_business_input_pages p on p.id=o.page_id and(p.tenant_id,p.connection_id,p.provider,p.collection)=(v.tenant_id,v.connection_id,v.provider,v.collection)
  where v.tenant_id=p_tenant and v.provider='commusoft' and v.collection='properties' group by v.id
 ),cs_ranked as materialized(select *,dense_rank() over(partition by connection_id,external_id order by seen desc) recency from cs_observed),
 cs_latest as materialized(select connection_id,external_id,min(id::text)::uuid version_id,max(seen) seen,count(*) versions from cs_ranked where recency=1 group by connection_id,external_id),
 cs as(
  select r.*,v.payload,public.learn_business_customer_summary(v.payload) summary,k.card_id linked_card,k.source_version_id reviewed_version,
   public.learn_business_customer_summary(old.payload)=public.learn_business_customer_summary(v.payload) current_review
  from cs_latest r join public.learn_business_input_versions v on v.id=r.version_id and v.tenant_id=p_tenant
  left join public.learn_business_input_links k on k.tenant_id=p_tenant and k.connection_id=r.connection_id and k.provider='commusoft' and k.collection='properties' and k.external_id=r.external_id and k.entity_kind='customer'
  left join public.learn_business_input_versions old on old.id=k.source_version_id and old.tenant_id=p_tenant
  where v.payload->>'type'='customer' or k.id is not null
 ),qb as(
  select l.*,v.payload,k.card_id linked_card,public.learn_quickbooks_customer_identity(v.payload)=k.identity current_review
  from public.learn_quickbooks_latest l join public.learn_quickbooks_source_versions v on v.id=l.version_id and v.tenant_id=p_tenant
  left join public.learn_quickbooks_customer_links k on(k.tenant_id,k.environment,k.realm_id,k.external_id)=(l.tenant_id,l.environment,l.realm_id,l.external_id)
  where l.tenant_id=p_tenant and l.environment=p_environment and l.entity='Customer'
   and v.payload->'Job' is distinct from 'true'::jsonb and nullif(v.payload#>>'{ParentRef,value}','') is null
 )
 select 'commusoft:'||c.connection_id::text||':'||c.external_id,'commusoft',c.connection_id::text,c.external_id,c.version_id,
  case when c.versions=1 then coalesce(c.summary->>'company_name','Customer record '||c.external_id) else 'Customer record '||c.external_id end,
  case when c.versions=1 then c.summary->>'person_name' end,case when c.versions=1 then c.summary->>'email' end,
  case when c.versions=1 then c.summary->>'phone' end,case when c.versions=1 then nullif(concat_ws(', ',c.summary->>'address',c.summary->>'postcode'),'') end,
  null::boolean,c.seen,null::timestamptz,
  case when c.versions=1 and c.current_review and exists(select 1 from public.customer_cards k where k.id=c.linked_card and k.tenant_id=p_tenant) then c.linked_card end,
  case when c.versions<>1 then 'source_conflict' when c.linked_card is null then 'unreviewed' when not coalesce(c.current_review,false) or not exists(select 1 from public.customer_cards k where k.id=c.linked_card and k.tenant_id=p_tenant) then 'review_changed' else 'reviewed' end
 from cs c
 union all
 select 'quickbooks:'||q.realm_id||':'||q.external_id,'quickbooks',q.realm_id,q.external_id,q.version_id,
  case when not q.conflicted then coalesce(public.learn_imported_source_text(q.payload,array['DisplayName'],500),public.learn_imported_source_text(q.payload,array['CompanyName'],500),'Customer record '||q.external_id) else 'Customer record '||q.external_id end,
  case when not q.conflicted then nullif(left(concat_ws(' ',public.learn_imported_source_text(q.payload,array['GivenName'],200),public.learn_imported_source_text(q.payload,array['MiddleName'],200),public.learn_imported_source_text(q.payload,array['FamilyName'],200)),1000),'') end,
  case when not q.conflicted then public.learn_imported_source_text(q.payload,array['PrimaryEmailAddr','Address'],500) end,
  case when not q.conflicted then coalesce(public.learn_imported_source_text(q.payload,array['PrimaryPhone','FreeFormNumber'],200),public.learn_imported_source_text(q.payload,array['Mobile','FreeFormNumber'],200)) end,
  case when not q.conflicted then nullif(left(concat_ws(', ',public.learn_imported_source_text(q.payload,array['BillAddr','Line1'],300),public.learn_imported_source_text(q.payload,array['BillAddr','Line2'],300),public.learn_imported_source_text(q.payload,array['BillAddr','Line3'],300),public.learn_imported_source_text(q.payload,array['BillAddr','City'],300),public.learn_imported_source_text(q.payload,array['BillAddr','CountrySubDivisionCode'],300),public.learn_imported_source_text(q.payload,array['BillAddr','PostalCode'],300),public.learn_imported_source_text(q.payload,array['BillAddr','Country'],300)),2000),'') end,
  case when q.payload->'Active'='true'::jsonb then true when q.payload->'Active'='false'::jsonb then false end,q.last_observed_at,q.source_updated_at,
  case when not q.conflicted and q.current_review and exists(select 1 from public.customer_cards k where k.id=q.linked_card and k.tenant_id=p_tenant) then q.linked_card end,
  case when q.conflicted then 'source_conflict' when q.linked_card is null then 'unreviewed' when not coalesce(q.current_review,false) or not exists(select 1 from public.customer_cards k where k.id=q.linked_card and k.tenant_id=p_tenant) then 'review_changed' else 'reviewed' end
 from qb q;
$$;
revoke all on function public.learn_imported_customer_sources(uuid,text) from public,anon,authenticated,service_role;

create function public.learn_imported_customer_catalog(p_tenant uuid,p_environment text default 'production',p_provider text default 'all',p_query text default '',p_after text default null,p_operator_reason text default null,p_group_key text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare entries jsonb;counts jsonb;next_key text;audit uuid;begin
 if p_environment is null or p_environment not in('production','sandbox') or p_provider is null or p_provider not in('all','commusoft','quickbooks')
  or p_query is null or length(btrim(p_query))>200 or (p_after is not null and(length(p_after)>240 or p_after!~'^(card:[a-f0-9-]{36}|(commusoft|quickbooks):[A-Za-z0-9-]{1,64}:[A-Za-z0-9-]{1,128})$')) or (p_group_key is not null and(length(p_group_key)>240 or p_group_key!~'^(card:[a-f0-9-]{36}|(commusoft|quickbooks):[A-Za-z0-9-]{1,64}:[A-Za-z0-9-]{1,128})$')) then raise exception 'imported_customer_request_invalid' using errcode='22023';end if;
 perform public.learn_quickbooks_retained_finance_access(p_tenant,p_operator_reason);
 with sources as materialized(select * from public.learn_imported_customer_sources(p_tenant,p_environment)),
 selected as materialized(
  select s.*,coalesce('card:'||s.card_id::text,s.source_key) account_key from sources s
  where (p_provider='all' or s.provider=p_provider) and (p_group_key is null or coalesce('card:'||s.card_id::text,s.source_key)=p_group_key)
 ),ranked as materialized(
  select *,row_number() over(partition by case when p_group_key is null then account_key else source_key end order by provider,source_key collate "C") source_rank from selected
 ),grouped as materialized(
  select case when p_group_key is null then coalesce('card:'||s.card_id::text,s.source_key) else s.source_key end key,s.card_id,
   left(coalesce(max(k.title),min(s.name)),1000) name,count(*) total_sources,
   jsonb_agg(jsonb_build_object('key',s.source_key,'provider',s.provider,'scope',s.scope_ref,'external_id',s.external_id,'version_id',s.version_id,'name',s.name,
    'contact_name',s.contact_name,'email',s.email,'phone',s.phone,'address',s.address,'active',s.source_active,'observed_at',s.observed_at,'source_updated_at',s.source_updated_at,'review_state',s.review_state) order by s.provider,s.source_key) filter(where s.source_rank<=5) sources,
   lower(concat_ws(' ',max(k.title),string_agg(concat_ws(' ',s.name,s.contact_name,s.email,s.phone,s.address,s.external_id),' '))) searchable
  from ranked s left join public.customer_cards k on k.id=s.card_id and k.tenant_id=p_tenant
  group by case when p_group_key is null then coalesce('card:'||s.card_id::text,s.source_key) else s.source_key end,s.card_id
 ),filtered as materialized(
  select * from grouped g where btrim(p_query)='' or position(lower(btrim(p_query)) in g.searchable)>0
 ),page as materialized(select * from filtered where p_after is null or key collate "C">p_after collate "C" order by key collate "C" limit 26),shown as(select * from page order by key collate "C" limit 25)
 select coalesce((select jsonb_agg(jsonb_build_object('key',key,'card_id',card_id,'name',name,'sources',sources,'total_sources',total_sources) order by key collate "C") from shown),'[]'),
  jsonb_build_object('commusoft_records',(select count(*) from sources where provider='commusoft'),'quickbooks_accounts',(select count(*) from sources where provider='quickbooks'),
   'displayed_accounts',(select count(*) from grouped),'matched_accounts',(select count(*) from grouped where total_sources>1),
   'unreviewed_records',(select count(*) from sources where review_state='unreviewed'),'records_needing_review',(select count(*) from sources where review_state in('source_conflict','review_changed')),'matching_results',(select count(*) from filtered)),
  case when (select count(*) from page)>25 then(select key from shown order by key collate "C" desc limit 1) end into entries,counts,next_key;
 perform public.learn_quickbooks_retained_finance_access(p_tenant,p_operator_reason);
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'customer.catalog.read',jsonb_build_object('environment',p_environment,'provider',p_provider,'group',p_group_key,'after',p_after,'sources',
  (select coalesce(jsonb_agg(x->'key'),'[]') from jsonb_array_elements(entries)e cross join jsonb_array_elements(e->'sources')x)),p_operator_reason) returning id into audit;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','imported-customer-catalog/1','tenant_id',p_tenant,'actor_id',auth.uid(),'environment',p_environment,'provider',p_provider,'query',btrim(p_query),'after',p_after,'group',p_group_key,
  'operator_mode',p_operator_reason is not null,'rows',entries,'counts',counts,'next_after',next_key,'audit_id',audit,'observed_at',clock_timestamp(),'coverage','retained_source_accounts');
end $$;
revoke all on function public.learn_imported_customer_catalog(uuid,text,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_imported_customer_catalog(uuid,text,text,text,text,text,text) to authenticated;
commit;
