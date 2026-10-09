-- TEST-only policy helper access. Existing bodies and source table grants stay unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' then raise exception 'Explicit TEST target required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_card_work_foundations_v1' and source_sha256='be6f2e94a8691469b82b45dce0c3c2011a68731fc8ae339e4a1ff11dfc3d5233' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Foundation prerequisite missing';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='learn_foundation_helper_access_v1') then raise exception 'Helper access receipt already exists';end if;
 if not exists(select 1 from pg_proc where oid='public.current_tenant_id()'::regprocedure and proowner='postgres'::regrole and pg_get_functiondef(oid)='CREATE OR REPLACE FUNCTION public.current_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''pg_catalog''
AS $function$
  select tenant_id from public.profiles where id = auth.uid()
$function$
') then raise exception 'Reviewed helper definition differs';end if;
 if not exists(select 1 from pg_proc where oid='public.is_openfolk()'::regprocedure and proowner='postgres'::regrole and pg_get_functiondef(oid)='CREATE OR REPLACE FUNCTION public.is_openfolk()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''pg_catalog''
AS $function$
  select coalesce((select role = ''openfolk'' from public.profiles where id = auth.uid()), false);
$function$
') then raise exception 'Reviewed helper definition differs';end if;
 if has_function_privilege('anon','public.current_tenant_id()','EXECUTE') or has_function_privilege('anon','public.is_openfolk()','EXECUTE') then raise exception 'Unexpected anonymous helper access';end if;
end $$;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.is_openfolk() to authenticated;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'learn_foundation_helper_access_v1','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
