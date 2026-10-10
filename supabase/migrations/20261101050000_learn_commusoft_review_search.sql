-- Search retained inputs before pagination. Existing readers and writers remain unchanged.
-- No provider calls, source writes or wider review authority.
begin;
create function public.learn_commusoft_source_matches(p_payload jsonb,p_external text,p_kind text,p_search text)
returns boolean language sql immutable set search_path=pg_catalog as $$
 with term as (select lower(btrim(p_search)) as query), fields as (
 select case p_kind
  when 'customer' then concat_ws(' ',
   public.learn_business_input_text(p_payload,'companyName'),
   public.learn_business_input_text(p_payload->'contact','firstName'),public.learn_business_input_text(p_payload->'contact','lastName'),
   public.learn_business_input_text(p_payload->'contact','email'),public.learn_business_input_text(p_payload->'contact','telephone'),public.learn_business_input_text(p_payload->'contact','mobile'),
   public.learn_business_input_text(p_payload,'addressLine1'),public.learn_business_input_text(p_payload,'addressLine2'),public.learn_business_input_text(p_payload,'addressLine3'),
   public.learn_business_input_text(p_payload,'town'),public.learn_business_input_text(p_payload,'province'),public.learn_business_input_text(p_payload,'postcode'))
  when 'site' then concat_ws(' ',public.learn_business_input_text(p_payload,'addressLine1'),public.learn_business_input_text(p_payload,'addressLine2'),public.learn_business_input_text(p_payload,'addressLine3'),
   public.learn_business_input_text(p_payload,'town'),public.learn_business_input_text(p_payload,'province'),public.learn_business_input_text(p_payload,'postcode'))
  when 'job' then public.learn_business_input_text(p_payload,'description')
  when 'contact' then concat_ws(' ',public.learn_business_input_text(p_payload,'firstName'),public.learn_business_input_text(p_payload,'lastName'),public.learn_business_input_text(p_payload,'email'),public.learn_business_input_text(p_payload,'position'),
   (select string_agg(public.learn_business_input_text(ph,'number'),' ') from jsonb_array_elements(case when jsonb_typeof(p_payload->'telephones')='array' then p_payload->'telephones' else '[]'::jsonb end) ph)) end as value
 ) select coalesce(query='' or p_external=query or
  (case when p_kind='site' then p_payload->>'parentPropertyID' when p_kind in ('job','contact') then p_payload->>'propertyID' end)=query or
  strpos(lower(value),query)>0,false) from term,fields;
$$;
revoke all on function public.learn_commusoft_source_matches(jsonb,text,text,text) from public,anon,authenticated,service_role;
create function public.learn_commusoft_review_search(p_tenant uuid,p_connection uuid,p_search text default '',p_after text default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;more boolean;last_id text;begin
 if p_search is null or length(btrim(p_search))>150 or p_connection is null or p_limit is null or p_limit not between 1 and 50 or
  (p_after is not null and p_after!~'^[0-9]{1,16}$') then raise exception 'business_input_page_invalid' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,p_connection);
 with identities as (
  select distinct external_id from public.learn_business_input_versions
  where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft' and collection='properties'
   and (p_after is null or external_id collate "C">p_after collate "C")
 ), latest as (
  select s.*,l.id as link_id,l.entity_table,l.entity_id,l.card_id,l.source_version_id as linked_version
  from identities i cross join lateral (
   select v.id,v.external_id,v.payload,p.committed_at from public.learn_business_input_versions v
   join public.learn_business_input_observations o on o.version_id=v.id join public.learn_business_input_pages p on p.id=o.page_id
   where v.tenant_id=p_tenant and v.connection_id=p_connection and v.provider='commusoft' and v.collection='properties' and v.external_id=i.external_id
    and p.tenant_id=v.tenant_id and p.connection_id=v.connection_id and p.provider=v.provider and p.collection=v.collection
   order by p.committed_at desc,v.id limit 1
  ) s left join public.learn_business_input_links l on l.tenant_id=p_tenant and l.connection_id=p_connection
    and l.provider='commusoft' and l.collection='properties' and l.external_id=s.external_id
  where s.payload->>'type'='customer' or l.entity_kind='customer'
 ), bounded as (select * from latest where public.learn_commusoft_source_matches(payload,external_id,'customer',p_search) order by external_id collate "C" limit p_limit+1), output as (
  select *,row_number() over(order by external_id collate "C") as n from bounded
 )
 select coalesce(jsonb_agg(jsonb_build_object('version_id',id,'external_id',external_id,'observed_at',committed_at,
   'summary',public.learn_business_customer_summary(payload),
   'link',case when link_id is not null then jsonb_build_object('entity_table',entity_table,'entity_id',entity_id,'card_id',card_id,'source_version_id',linked_version) end)
   order by external_id collate "C") filter(where n<=p_limit),'[]'),count(*)>p_limit,
   max(external_id collate "C") filter(where n<=p_limit) into result,more,last_id from output;
 return jsonb_build_object('tenant_id',p_tenant,'connection_id',p_connection,'search',btrim(p_search),'rows',result,'next_cursor',case when more then last_id end);
end $$;

create function public.learn_commusoft_work_review_search(p_tenant uuid,p_connection uuid,p_kind text,p_search text default '',p_after text default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r record;v public.learn_business_input_versions%rowtype;l public.learn_business_input_links%rowtype;
 rows jsonb:='[]';owner jsonb;attempt jsonb;label text;parent text;customer text;v_collection text;last_id text;counted integer:=0;more boolean:=false;
begin
 if p_search is null or length(btrim(p_search))>150 or p_connection is null or p_kind is null or p_kind not in ('site','job','contact') or p_limit is null or p_limit not between 1 and 50
  or (p_after is not null and p_after!~'^[0-9]{1,16}$') then raise exception 'business_input_page_invalid' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,p_connection);
 v_collection:=case when p_kind='site' then 'properties' when p_kind='contact' then 'propertyContacts' else 'jobs' end;
 -- Resolve latest observations together, including ambiguous/missing sources.
 -- Only the bounded matching page needs relationship and projection lookups.
 for r in with identities as materialized (
  select distinct s.external_id collate "C" as external_id from public.learn_business_input_versions s
  where s.tenant_id=p_tenant and s.connection_id=p_connection and s.provider='commusoft' and s.collection=v_collection
   and (p_kind in ('job','contact') or s.payload->>'type'='workaddress')
   and (p_after is null or s.external_id collate "C">p_after collate "C")
 ), observed as (
  select s.external_id,s.id,dense_rank() over(partition by s.external_id order by p.committed_at desc) as recency
  from identities i join public.learn_business_input_versions s on s.external_id=i.external_id
  join public.learn_business_input_observations o on o.version_id=s.id join public.learn_business_input_pages p on p.id=o.page_id
  where s.tenant_id=p_tenant and s.connection_id=p_connection and s.provider='commusoft' and s.collection=v_collection
   and p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider=s.provider and p.collection=s.collection
 ), latest as (
  select external_id,case when count(distinct id)=1 then min(id::text)::uuid end as version_id from observed where recency=1 group by external_id
 ) select i.external_id,s.id as version_id from identities i left join latest x on x.external_id=i.external_id
  left join public.learn_business_input_versions s on s.id=x.version_id
  where public.learn_commusoft_source_matches(s.payload,i.external_id,p_kind,p_search)
  order by i.external_id collate "C" limit p_limit+1 loop
  counted:=counted+1;if counted>p_limit then more:=true;exit;end if;last_id:=r.external_id;
  select * into v from public.learn_business_input_versions where id=r.version_id;
  select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
   and learn_business_input_links.collection=v_collection and external_id=r.external_id;
  parent:=case when p_kind='site' then v.payload->>'parentPropertyID' else v.payload->>'propertyID' end;
  owner:=case when v.id is null then jsonb_build_object('state','held','reason','source_changed_or_ambiguous')
   else public.learn_commusoft_property_owner(p_tenant,p_connection,parent,p_kind in ('job','contact')) end;
  customer:=null;
  if owner->>'state'='ready' then
   if owner->>'person_id' is not null then select display_name into customer from public.people where tenant_id=p_tenant and id=(owner->>'person_id')::uuid;
   else select name into customer from public.companies where tenant_id=p_tenant and id=(owner->>'company_id')::uuid;end if;
  end if;
  select a.result into attempt from public.learn_business_input_projection_attempts a where a.tenant_id=p_tenant and a.source_version_id=v.id order by a.created_at desc,a.id desc limit 1;
  label:=case when p_kind='site' then public.learn_business_input_text(v.payload,'addressLine1') when p_kind='contact' then nullif(btrim(concat_ws(' ',public.learn_business_input_text(v.payload,'firstName'),public.learn_business_input_text(v.payload,'lastName'))),'') else public.learn_business_input_text(v.payload,'description') end;
  rows:=rows||jsonb_build_array(jsonb_build_object('external_id',r.external_id,'version_id',v.id,'title',coalesce(label,initcap(p_kind)||' '||r.external_id),
   'property_reference',case when parent~'^[1-9][0-9]{0,15}$' then parent end,'customer_name',left(customer,1000),'relationship_reason',owner->>'reason',
   'source_status',public.learn_business_input_text(v.payload,'status'),'linked_version_id',l.source_version_id,'last_result',attempt,
   'contact',case when p_kind='contact' then jsonb_build_object('email',public.learn_business_input_text(v.payload,'email'),'position',public.learn_business_input_text(v.payload,'position'),
    'phones',(select coalesce(jsonb_agg(x.number),'[]'::jsonb) from (select left(concat_ws(': ',ph->>'type',ph->>'number'),1000) as number from jsonb_array_elements(case when jsonb_typeof(v.payload->'telephones')='array' then v.payload->'telephones' else '[]'::jsonb end) ph where jsonb_typeof(ph->'number')='string' limit 50) x)) end,
   'selectable',v.id is not null and coalesce(p_kind in ('job','contact') or v.payload->>'type'='workaddress',false)));
 end loop;
 return jsonb_build_object('tenant_id',p_tenant,'connection_id',p_connection,'kind',p_kind,'search',btrim(p_search),'rows',rows,'next_cursor',case when more then last_id end);
end $$;

revoke all on function public.learn_commusoft_review_search(uuid,uuid,text,text,integer),public.learn_commusoft_work_review_search(uuid,uuid,text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_review_search(uuid,uuid,text,text,integer),public.learn_commusoft_work_review_search(uuid,uuid,text,text,text,integer) to authenticated;
commit;
