-- Literal canonical-card search under the caller's existing table permissions/RLS.
-- No source imports, identity matching, scoring writes or table-grant changes.
begin;
create function public.learn_card_search(p_tenant uuid,p_kind text,p_query text,p_page integer default 0,p_group uuid default null)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare term text:=btrim(p_query); matches jsonb; result jsonb;
begin
 if auth.uid() is null then raise exception 'Sign-in required' using errcode='42501';end if;
 if p_tenant is null or p_kind is null or p_kind not in ('customer','job','member','team')
  or term is null or char_length(term) not between 1 and 120 or term ~ '[[:cntrl:]]'
  or p_page is null or p_page not between 0 and 10000
  or (p_group is not null and p_kind not in ('member','team')) then
  raise exception 'Invalid card search' using errcode='22023';end if;
 case p_kind
 when 'customer' then
  select coalesce(jsonb_agg(to_jsonb(r) order by r.updated_at desc nulls last,r.id),'[]'::jsonb) into matches
  from (select id,tenant_id,title,summary,person_id,company_id,owner_id,updated_at from public.customer_cards where tenant_id=p_tenant and true
   and (strpos(lower(coalesce(title,'')),lower(term))>0) order by updated_at desc nulls last,id limit 25 offset p_page*24) r;
 when 'job' then
  select coalesce(jsonb_agg(to_jsonb(r) order by r.updated_at desc nulls last,r.id),'[]'::jsonb) into matches
  from (select id,tenant_id,title,job_number,status,source_system,verified,updated_at from public.jobs where tenant_id=p_tenant and true
   and (strpos(lower(coalesce(title,'')),lower(term))>0 or strpos(lower(coalesce(job_number,'')),lower(term))>0) order by updated_at desc nulls last,id limit 25 offset p_page*24) r;
 when 'member' then
  select coalesce(jsonb_agg(to_jsonb(r) order by r.updated_at desc nulls last,r.id),'[]'::jsonb) into matches
  from (select id,tenant_id,display_name,formal_role,org_unit_id,profile_id,confirmed_at,effective_to,updated_at from public.team_members where tenant_id=p_tenant and effective_to is null and (p_group is null or org_unit_id=p_group)
   and (strpos(lower(coalesce(display_name,'')),lower(term))>0 or strpos(lower(coalesce(formal_role,'')),lower(term))>0) order by updated_at desc nulls last,id limit 25 offset p_page*24) r;
 when 'team' then
  select coalesce(jsonb_agg(to_jsonb(r) order by r.updated_at desc nulls last,r.id),'[]'::jsonb) into matches
  from (select id,tenant_id,name,kind,updated_at from public.org_units where tenant_id=p_tenant and (p_group is null or id=p_group)
   and (strpos(lower(coalesce(name,'')),lower(term))>0) order by updated_at desc nulls last,id limit 25 offset p_page*24) r;
 end case;
 select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into result
 from jsonb_array_elements(matches) with ordinality r(value,ord) where ord<=24;
 return jsonb_build_object('version','learn-card-search/1','tenantId',p_tenant,'kind',p_kind,'query',term,
  'page',p_page,'groupId',p_group,'rows',result,'hasMore',jsonb_array_length(matches)>24);
end $$;
revoke all on function public.learn_card_search(uuid,text,text,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_card_search(uuid,text,text,integer,uuid) to authenticated;
commit;
