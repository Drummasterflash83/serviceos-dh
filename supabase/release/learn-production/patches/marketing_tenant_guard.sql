-- Preserve the installed invoker trigger and all its tenant checks. Its previous
-- unqualified names fail when a restricted SECURITY DEFINER writer invokes it.
-- Exact installed definition/authority is checked by the enclosing package.
do $$declare d text;table_name text;needle text;begin
 d:=pg_get_functiondef('public.marketing_tenant_guard()'::regprocedure);
 foreach table_name in array array['people','companies','contact_points','marketing_tags','marketing_segments','marketing_lifecycle_stages','profiles'] loop
  needle:='from '||table_name||' ';
  if (length(d)-length(replace(d,needle,'')))<>length(needle) then
   raise exception 'Marketing tenant guard reference contract differs';end if;
  d:=replace(d,needle,'from public.'||table_name||' ');
 end loop;
 execute d;
end$$;
alter function public.marketing_tenant_guard() set search_path=pg_catalog;
