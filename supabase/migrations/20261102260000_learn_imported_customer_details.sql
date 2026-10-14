-- Native source relationships are evidence, not automatic canonical matching.
begin;
create function public.learn_imported_business_records(p_tenant uuid,p_connection uuid,p_collection text)
returns table(version_id uuid,external_id text,payload jsonb,observed_at timestamptz,conflicted boolean)
language sql stable set search_path=pg_catalog as $$
 with observed as materialized(
  select v.id,v.external_id,max(p.committed_at) seen from public.learn_business_input_versions v
  join public.learn_business_input_observations o on o.version_id=v.id
  join public.learn_business_input_pages p on p.id=o.page_id and(p.tenant_id,p.connection_id,p.provider,p.collection)=(v.tenant_id,v.connection_id,v.provider,v.collection)
  where v.tenant_id=p_tenant and v.connection_id=p_connection and v.provider='commusoft' and v.collection=p_collection group by v.id
 ),ranked as(select *,dense_rank() over(partition by external_id order by seen desc) recency from observed),
 latest as(select external_id,min(id::text)::uuid id,max(seen) seen,count(*) n from ranked where recency=1 group by external_id)
 select v.id,l.external_id,v.payload,l.seen,l.n<>1 from latest l join public.learn_business_input_versions v on v.id=l.id;
$$;
revoke all on function public.learn_imported_business_records(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.learn_imported_customer_detail(p_tenant uuid,p_environment text,p_source_key text,p_source_version uuid,p_kind text,p_after uuid default null,p_operator_reason text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare root record;entries jsonb;next_id uuid;total bigint;held bigint;audit uuid;begin
 if p_environment is null or p_environment not in('production','sandbox') or p_source_key is null or length(p_source_key)>240 or p_source_key!~'^(commusoft|quickbooks):[A-Za-z0-9-]{1,64}:[A-Za-z0-9-]{1,128}$'
  or p_source_version is null or p_kind is null or p_kind not in('jobs','sites','contacts','transactions','subaccounts') then raise exception 'imported_customer_detail_invalid' using errcode='22023';end if;
 perform public.learn_quickbooks_retained_finance_access(p_tenant,p_operator_reason);
 select * into root from public.learn_imported_customer_sources(p_tenant,p_environment) where source_key=p_source_key;
 if not found then raise exception 'imported_customer_unavailable' using errcode='42501';end if;
 if root.version_id<>p_source_version or root.review_state='source_conflict' then raise exception 'imported_customer_source_changed' using errcode='PT409';end if;
 if (root.provider='commusoft' and p_kind not in('jobs','sites','contacts')) or(root.provider='quickbooks' and p_kind not in('transactions','subaccounts')) then raise exception 'imported_customer_detail_invalid' using errcode='22023';end if;
 if root.provider='commusoft' then
  with sites as materialized(
   select * from public.learn_imported_business_records(p_tenant,root.scope_ref::uuid,'properties')
   where payload->>'type'='workaddress' and jsonb_typeof(payload->'parentPropertyID')='number' and payload->>'parentPropertyID'=root.external_id
  ),records as materialized(
   select * from sites where p_kind='sites'
   union all
   select r.* from public.learn_imported_business_records(p_tenant,root.scope_ref::uuid,case when p_kind='contacts' then 'propertyContacts' else 'jobs' end) r
   where p_kind in('jobs','contacts') and jsonb_typeof(r.payload->'propertyID')='number'
    and(r.payload->>'propertyID'=root.external_id or exists(select 1 from sites s where not s.conflicted and s.external_id=r.payload->>'propertyID'))
  ),usable as materialized(select * from records where not conflicted),
  page as(select * from usable where p_after is null or version_id>p_after order by version_id limit 26),shown as(select * from page order by version_id limit 25)
  select coalesce((select jsonb_agg(jsonb_build_object('version_id',version_id,'external_id',external_id,
   'entity',case when p_kind='jobs' then 'Job' when p_kind='sites' then 'Site' else 'Contact' end,
   'title',case when p_kind='jobs' then coalesce(public.learn_imported_source_text(payload,array['description'],1000),'Job '||external_id)
    when p_kind='sites' then coalesce(public.learn_imported_source_text(payload,array['addressLine1'],1000),'Site '||external_id)
    else coalesce(nullif(concat_ws(' ',public.learn_imported_source_text(payload,array['firstName'],400),public.learn_imported_source_text(payload,array['lastName'],400)),''),'Contact record '||external_id) end,
   'status',public.learn_imported_source_text(payload,array['status'],200),
   'email',public.learn_imported_source_text(payload,array['email'],500),
   'phone',coalesce(public.learn_imported_source_text(payload,array['telephone'],200),public.learn_imported_source_text(payload,array['mobile'],200)),
   'address',case when p_kind='sites' then nullif(concat_ws(', ',public.learn_imported_source_text(payload,array['addressLine1'],300),public.learn_imported_source_text(payload,array['addressLine2'],300),public.learn_imported_source_text(payload,array['addressLine3'],300),public.learn_imported_source_text(payload,array['town'],300),public.learn_imported_source_text(payload,array['province'],300),public.learn_imported_source_text(payload,array['postcode'],100)),'') end,
   'role',public.learn_imported_source_text(payload,array['position'],300),
   'parent_reference',case when p_kind='sites' then payload->>'parentPropertyID' else payload->>'propertyID' end,
   'transaction_date',null,'due_date',null,'amount',null,'balance',null,'currency',null,'observed_at',observed_at) order by version_id) from shown),'[]'),
   (select count(*) from usable),(select count(*) from records where conflicted),
   case when(select count(*) from page)>25 then(select version_id from shown order by version_id desc limit 1) end into entries,total,held,next_id;
 else
  with recursive customers as materialized(
   select l.external_id,l.version_id,l.conflicted,l.last_observed_at,v.payload from public.learn_quickbooks_latest l join public.learn_quickbooks_source_versions v on v.id=l.version_id
   where l.tenant_id=p_tenant and l.environment=p_environment and l.realm_id=root.scope_ref and l.entity='Customer'
  ),hierarchy as(
   select c.*,array[c.external_id] path,0 depth from customers c where c.external_id=root.external_id and not c.conflicted
   union all
   select c.*,h.path||c.external_id,h.depth+1 from hierarchy h join customers c on c.payload#>>'{ParentRef,value}'=h.external_id
    where not c.conflicted and h.depth<5 and not c.external_id=any(h.path)
  ),records as materialized(
   select h.version_id,h.external_id,'Subaccount'::text entity,h.conflicted,h.last_observed_at observed_at,h.payload from hierarchy h where p_kind='subaccounts' and h.depth>0
   union all
   select l.version_id,l.external_id,l.entity,l.conflicted,l.last_observed_at,v.payload from public.learn_quickbooks_latest l join public.learn_quickbooks_source_versions v on v.id=l.version_id
   where p_kind='transactions' and l.tenant_id=p_tenant and l.environment=p_environment and l.realm_id=root.scope_ref and l.entity in('Invoice','Payment','CreditMemo','SalesReceipt','Estimate')
    and exists(select 1 from hierarchy h where h.external_id=v.payload#>>'{CustomerRef,value}')
  ),usable as materialized(select * from records where not conflicted),
  page as(select * from usable where p_after is null or version_id>p_after order by version_id limit 26),shown as(select * from page order by version_id limit 25)
  select coalesce((select jsonb_agg(jsonb_build_object('version_id',version_id,'external_id',external_id,'entity',entity,
   'title',case when entity='Subaccount' then coalesce(public.learn_imported_source_text(payload,array['FullyQualifiedName'],1000),public.learn_imported_source_text(payload,array['DisplayName'],1000),'Subaccount '||external_id)
    else entity||' · '||coalesce(public.learn_imported_source_text(payload,array['DocNumber'],200),external_id) end,
   'status',null,'email',case when entity='Subaccount' then public.learn_imported_source_text(payload,array['PrimaryEmailAddr','Address'],500) end,
   'phone',case when entity='Subaccount' then public.learn_imported_source_text(payload,array['PrimaryPhone','FreeFormNumber'],200) end,
   'address',null,'role',null,'parent_reference',case when entity='Subaccount' then payload#>>'{ParentRef,value}' else payload#>>'{CustomerRef,value}' end,
   'transaction_date',public.learn_imported_source_text(payload,array['TxnDate'],32),'due_date',public.learn_imported_source_text(payload,array['DueDate'],32),
   'amount',case when entity<>'Subaccount' then public.learn_quickbooks_money(payload->'TotalAmt')::text end,
   'balance',case when entity='Invoice' then public.learn_quickbooks_money(payload->'Balance')::text end,
   'currency',case when payload#>>'{CurrencyRef,value}' ~ '^[A-Z]{3}$' then payload#>>'{CurrencyRef,value}' end,'observed_at',observed_at) order by version_id) from shown),'[]'),
   (select count(*) from usable),(select count(*) from records where conflicted),
   case when(select count(*) from page)>25 then(select version_id from shown order by version_id desc limit 1) end into entries,total,held,next_id;
 end if;
 perform public.learn_quickbooks_retained_finance_access(p_tenant,p_operator_reason);
 if not exists(select 1 from public.learn_imported_customer_sources(p_tenant,p_environment) s where s.source_key=p_source_key and s.version_id=p_source_version and s.review_state<>'source_conflict') then raise exception 'imported_customer_source_changed' using errcode='PT409';end if;
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'customer.source_detail.read',jsonb_build_object('environment',p_environment,'source',p_source_key,'sourceVersion',p_source_version,'kind',p_kind,'after',p_after,'versions',
  (select coalesce(jsonb_agg(x->'version_id'),'[]') from jsonb_array_elements(entries)x)),p_operator_reason) returning id into audit;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','imported-customer-detail/1','tenant_id',p_tenant,'actor_id',auth.uid(),'environment',p_environment,'source_key',p_source_key,'source_version',p_source_version,'kind',p_kind,'after',p_after,
  'operator_mode',p_operator_reason is not null,'rows',entries,'total',total,'held',held,'next_after',next_id,'audit_id',audit,'observed_at',clock_timestamp(),'coverage','native_source_relationships');
end $$;
revoke all on function public.learn_imported_customer_detail(uuid,text,text,uuid,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_imported_customer_detail(uuid,text,text,uuid,text,uuid,text) to authenticated;
commit;
