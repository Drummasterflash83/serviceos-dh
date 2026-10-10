-- Read-only customer discovery across canonical and additional contact details.
-- A shared endpoint remains a review clue; no identity, card or consent is changed.
begin;
create or replace function public.learn_commusoft_customer_candidates(p_tenant uuid,p_version uuid,p_kind text,p_search text default '',p_after uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;s jsonb;q text;region text;source_email text;source_phones text[];search_phone text;
 result jsonb;more boolean;last_id uuid;
begin
 if p_version is null or p_kind is null or p_kind not in ('person','company') or p_search is null or length(btrim(p_search))>150
  or length(btrim(p_search))=1 or p_limit is null or p_limit not between 1 and 50 then raise exception 'business_input_search_invalid' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant);
 select * into v from public.learn_business_input_versions where id=p_version and tenant_id=p_tenant and provider='commusoft' and collection='properties';
 if not found then raise exception 'business_input_source_unavailable' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,v.connection_id);
 select non_secret_config->>'region' into region from public.provider_connections where id=v.connection_id and tenant_id=p_tenant;
 s:=public.learn_business_customer_summary(v.payload);q:=lower(btrim(p_search));source_email:=nullif(lower(btrim(s->>'email')),'');
 select coalesce(array_agg(distinct x) filter(where x is not null),'{}'::text[]) into source_phones from (
  select public.learn_business_contact_phone(public.learn_business_input_text(v.payload->'contact',field),region) x
  from unnest(array['telephone','mobile']) field
 ) numbers;
 search_phone:=case when q ~ '^[+0-9 ().-]+$' then public.learn_business_contact_phone(q,region) end;
 with candidates as (
  select id,display_name as name,primary_email as email,primary_phone as phone,postcode from public.people where tenant_id=p_tenant and p_kind='person' and (p_after is null or id>p_after)
  union all select id,name,null,phone,postcode from public.companies where tenant_id=p_tenant and p_kind='company' and (p_after is null or id>p_after)
 ), evidence as (
  select c.*,
   coalesce(case when nullif(lower(btrim(c.email)),'')=source_email then source_email end,
    (select min(cp.normalized_value) from public.contact_points cp where p_kind='person' and cp.tenant_id=p_tenant and cp.person_id=c.id and cp.channel='email' and cp.verification_state<>'invalid' and cp.normalized_value=source_email)) as matched_email,
   coalesce(case when public.learn_business_contact_phone(c.phone,region)=any(source_phones) then public.learn_business_contact_phone(c.phone,region) end,
    (select min(cp.normalized_value) from public.contact_points cp where p_kind='person' and cp.tenant_id=p_tenant and cp.person_id=c.id and cp.channel='phone' and cp.verification_state<>'invalid' and cp.normalized_value=any(source_phones))) as matched_phone,
   (select jsonb_build_object('channel',cp.channel,'value',left(cp.normalized_value,1000)) from public.contact_points cp
    where p_kind='person' and q<>'' and cp.tenant_id=p_tenant and cp.person_id=c.id and cp.channel in ('email','phone') and cp.verification_state<>'invalid'
     and (position(q in lower(concat_ws(' ',cp.value,cp.normalized_value)))>0 or (cp.channel='phone' and cp.normalized_value=search_phone))
    order by cp.channel,cp.normalized_value,cp.id limit 1) as searched_endpoint
  from candidates c
 ), matches as (
  select *,case when matched_email is not null then 'shared_email' when matched_phone is not null then 'shared_phone'
   when nullif(lower(btrim(name)),'')=nullif(lower(btrim(s->>case when p_kind='person' then 'person_name' else 'company_name' end)),'') then 'same_name'
   else 'search' end as reason,
   case when matched_email is not null then jsonb_build_object('channel','email','value',left(matched_email,1000))
    when matched_phone is not null then jsonb_build_object('channel','phone','value',left(matched_phone,1000)) else searched_endpoint end as match_detail
  from evidence where
   (q<>'' and (position(q in lower(concat_ws(' ',name,email,phone,postcode)))>0 or searched_endpoint is not null or public.learn_business_contact_phone(phone,region)=search_phone)) or
   (q='' and (matched_email is not null or matched_phone is not null or
    nullif(lower(btrim(name)),'')=nullif(lower(btrim(s->>case when p_kind='person' then 'person_name' else 'company_name' end)),'') ))
  order by id limit p_limit+1
 ), numbered as (select *,row_number() over(order by id) as n from matches)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',left(name,1000),'email',left(email,1000),'phone',left(phone,1000),'postcode',left(postcode,1000),'reason',reason,'match_detail',match_detail) order by id) filter(where n<=p_limit),'[]'),
  count(*)>p_limit,(array_agg(id order by id) filter(where n<=p_limit))[p_limit] into result,more,last_id from numbered;
 return jsonb_build_object('tenant_id',p_tenant,'version_id',p_version,'kind',p_kind,'rows',result,'next_cursor',case when more then last_id end);
end $$;
-- CREATE OR REPLACE retains the existing authenticated-only grants and owner.
commit;
