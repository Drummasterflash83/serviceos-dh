-- Signed-in customer review reads and confirmation. No source backfill or sync.
begin;
create function public.learn_business_input_review_access(p_tenant uuid,p_connection uuid default null)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare f text;begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then raise exception 'business_input_review_forbidden' using errcode='42501';end if;
 perform public.learn_import_batch_authority(p_tenant,auth.uid());
 foreach f in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
  perform 1 from public.feature_flags where tenant_id=p_tenant and flag=f and value='true'::jsonb for share;
  if not found then raise exception 'business_input_module_unavailable' using errcode='42501';end if;
 end loop;
 perform 1 from public.tenant_connectors where tenant_id=p_tenant and provider='commusoft' and connector_id='commusoft' and enabled and status='active' for share;
 if not found then raise exception 'business_input_connector_unavailable' using errcode='42501';end if;
 if p_connection is not null then
  perform 1 from public.provider_connections where tenant_id=p_tenant and id=p_connection and provider='commusoft'
   and status='configured' and revoked_at is null and verified_at<=clock_timestamp() for share;
  if not found then raise exception 'business_input_connection_unavailable' using errcode='42501';end if;
 end if;
end $$;
create function public.learn_business_input_text(p_value jsonb,p_key text) returns text
language sql immutable set search_path=pg_catalog as $$
 select case when jsonb_typeof(p_value->p_key)='string' then nullif(left(btrim(p_value->>p_key),1000),'') end;
$$;
create function public.learn_business_customer_summary(p_value jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object(
  'person_name',nullif(concat_ws(' ',public.learn_business_input_text(p_value->'contact','firstName'),public.learn_business_input_text(p_value->'contact','lastName')),''),
  'company_name',public.learn_business_input_text(p_value,'companyName'),
  'email',public.learn_business_input_text(p_value->'contact','email'),
  'phone',coalesce(public.learn_business_input_text(p_value->'contact','telephone'),public.learn_business_input_text(p_value->'contact','mobile')),
  'address',nullif(concat_ws(', ',public.learn_business_input_text(p_value,'addressLine1'),public.learn_business_input_text(p_value,'addressLine2'),public.learn_business_input_text(p_value,'addressLine3'),public.learn_business_input_text(p_value,'town'),public.learn_business_input_text(p_value,'province')),''),
  'postcode',public.learn_business_input_text(p_value,'postcode'),
  'source_type',public.learn_business_input_text(p_value,'type'),
  'customer_type',case when jsonb_typeof(p_value->'customerType') in ('number','string') then left(p_value->>'customerType',100) end);
$$;
create function public.learn_commusoft_review_connections(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;begin
 perform public.learn_business_input_review_access(p_tenant);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(nullif(left(non_secret_config->>'account_key',150),''),'Commusoft connection')) order by id),'[]') into result
  from public.provider_connections where tenant_id=p_tenant and provider='commusoft' and status='configured' and revoked_at is null and verified_at<=clock_timestamp();
 return jsonb_build_object('tenant_id',p_tenant,'connections',result);
end $$;
create function public.learn_commusoft_review_page(p_tenant uuid,p_connection uuid,p_after text default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;more boolean;last_id text;begin
 if p_connection is null or p_limit is null or p_limit not between 1 and 50 or
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
 ), bounded as (select * from latest order by external_id collate "C" limit p_limit+1), output as (
  select *,row_number() over(order by external_id collate "C") as n from bounded
 )
 select coalesce(jsonb_agg(jsonb_build_object('version_id',id,'external_id',external_id,'observed_at',committed_at,
   'summary',public.learn_business_customer_summary(payload),
   'link',case when link_id is not null then jsonb_build_object('entity_table',entity_table,'entity_id',entity_id,'card_id',card_id,'source_version_id',linked_version) end)
   order by external_id collate "C") filter(where n<=p_limit),'[]'),count(*)>p_limit,
   max(external_id collate "C") filter(where n<=p_limit) into result,more,last_id from output;
 return jsonb_build_object('tenant_id',p_tenant,'connection_id',p_connection,'rows',result,'next_cursor',case when more then last_id end);
end $$;

create function public.learn_commusoft_customer_candidates(p_tenant uuid,p_version uuid,p_kind text,p_search text default '',p_after uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;s jsonb;q text;result jsonb;more boolean;last_id uuid;
begin
 if p_version is null or p_kind is null or p_kind not in ('person','company') or p_search is null or length(btrim(p_search))>150
  or length(btrim(p_search))=1 or p_limit is null or p_limit not between 1 and 50 then raise exception 'business_input_search_invalid' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant);
 select * into v from public.learn_business_input_versions where id=p_version and tenant_id=p_tenant and provider='commusoft' and collection='properties';
 if not found then raise exception 'business_input_source_unavailable' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,v.connection_id);
 s:=public.learn_business_customer_summary(v.payload);q:=lower(btrim(p_search));
 with candidates as (
  select id,display_name as name,primary_email as email,primary_phone as phone,postcode from public.people where tenant_id=p_tenant and p_kind='person'
  union all select id,name,null,phone,postcode from public.companies where tenant_id=p_tenant and p_kind='company'
 ), matches as (
  select *,case
   when nullif(lower(btrim(email)),'')=nullif(lower(btrim(s->>'email')),'') then 'shared_email'
   when nullif(regexp_replace(phone,'[^0-9]','','g'),'')=nullif(regexp_replace(s->>'phone','[^0-9]','','g'),'') then 'shared_phone'
   when nullif(lower(btrim(name)),'')=nullif(lower(btrim(s->>case when p_kind='person' then 'person_name' else 'company_name' end)),'') then 'same_name'
   else 'search' end as reason from candidates
  where (p_after is null or id>p_after) and (
   (q<>'' and position(q in lower(concat_ws(' ',name,email,phone,postcode)))>0) or
   (q='' and (nullif(lower(btrim(email)),'')=nullif(lower(btrim(s->>'email')),'') or
    nullif(regexp_replace(phone,'[^0-9]','','g'),'')=nullif(regexp_replace(s->>'phone','[^0-9]','','g'),'') or
    nullif(lower(btrim(name)),'')=nullif(lower(btrim(s->>case when p_kind='person' then 'person_name' else 'company_name' end)),'') ))
  ) order by id limit p_limit+1
 ), numbered as (select *,row_number() over(order by id) as n from matches)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',left(name,1000),'email',left(email,1000),'phone',left(phone,1000),'postcode',left(postcode,1000),'reason',reason) order by id) filter(where n<=p_limit),'[]'),
  count(*)>p_limit,(array_agg(id order by id) filter(where n<=p_limit))[p_limit] into result,more,last_id from numbered;
 return jsonb_build_object('tenant_id',p_tenant,'version_id',p_version,'kind',p_kind,'rows',result,'next_cursor',case when more then last_id end);
end $$;

-- The existing private writer remains uncallable by authenticated clients.
-- The new facade supplies auth.uid(), never a caller-selected actor.
do $$declare d text;needle text:='if auth.role() is distinct from ''service_role'' then';begin
 d:=pg_get_functiondef('public.learn_commusoft_review_customer(uuid,uuid,uuid,text,uuid,text)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'business_input_writer_contract_changed';end if;
 execute replace(d,needle,'if auth.role() is distinct from ''service_role'' and not (auth.role()=''authenticated'' and auth.uid() is not null and p_actor is not distinct from auth.uid()) then');
end $$;
create function public.learn_commusoft_confirm_customer(p_tenant uuid,p_version uuid,p_kind text,p_target uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then raise exception 'business_input_review_forbidden' using errcode='42501';end if;
 return public.learn_commusoft_review_customer(p_tenant,auth.uid(),p_version,p_kind,p_target,p_reason);
end $$;
revoke all on function public.learn_business_input_review_access(uuid,uuid),public.learn_business_input_text(jsonb,text),public.learn_business_customer_summary(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.learn_commusoft_review_connections(uuid),public.learn_commusoft_review_page(uuid,uuid,text,integer),public.learn_commusoft_customer_candidates(uuid,uuid,text,text,uuid,integer),public.learn_commusoft_confirm_customer(uuid,uuid,text,uuid,text) from public,anon,service_role;
grant execute on function public.learn_commusoft_review_connections(uuid),public.learn_commusoft_review_page(uuid,uuid,text,integer),public.learn_commusoft_customer_candidates(uuid,uuid,text,text,uuid,integer),public.learn_commusoft_confirm_customer(uuid,uuid,text,uuid,text) to authenticated;
commit;
