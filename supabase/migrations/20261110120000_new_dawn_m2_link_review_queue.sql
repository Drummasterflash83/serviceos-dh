-- Expose the existing audited exact-ID job review page behind an M2 tenant flag.
-- This does not create links, call Commusoft, or widen source visibility.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';

create function public.new_dawn_m2_link_review_page(
 p_tenant uuid,p_connection uuid,p_after text default null,
 p_limit integer default 50,p_reason text default null
) returns jsonb language plpgsql security definer
 set search_path=pg_catalog set statement_timeout='20s' as $$
declare result jsonb;
begin
 if auth.role() is distinct from 'authenticated' or p_tenant is null
  or p_connection is null or p_limit is null or p_limit not between 1 and 50
  then raise exception 'm2_link_review_invalid' using errcode='22023';end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.m2_link_review_queue' and value='true'::jsonb for share;
 if not found then raise exception 'm2_link_review_disabled' using errcode='42501';end if;
 result:=public.new_dawn_commusoft_exact_link_review_page(
  p_tenant,p_connection,p_after,p_limit,p_reason);
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.m2_link_review_queue' and value='true'::jsonb for share;
 if not found then raise exception 'm2_link_review_disabled' using errcode='42501';end if;
 return result;
end $$;
revoke all on function public.new_dawn_m2_link_review_page(uuid,uuid,text,integer,text)
 from public,anon,service_role;
grant execute on function public.new_dawn_m2_link_review_page(uuid,uuid,text,integer,text)
 to authenticated;
commit;
