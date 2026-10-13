-- Read-only catalog preflight. Contains no customer rows, secret values or
-- function bodies. Execute separately against the explicitly selected hosted
-- TEST/production project; a local result is not proof of that project's state.
with required_functions(signature) as (values
 ('public.learn_operator_input_immutable()'),
 ('public.learn_operator_input_access(uuid,uuid,boolean)'),
 ('public.current_user_is_openfolk_operator(text)'),
 ('public.provider_secret_name(uuid,text,text)'),
 ('public.provider_secret_store(uuid,text,text,text)'),
 ('vault.create_secret(text,text,text,uuid)'),
 ('vault.update_secret(uuid,text,text,text,uuid)'),
 ('auth.uid()'),('auth.role()')
), dependencies as (
 select signature,to_regprocedure(signature) oid from required_functions
), tables as (
 select c.oid,c.relname,n.nspname,c.relrowsecurity,c.relowner
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where (n.nspname='public' and c.relname in ('tenants','profiles','platform_authority_grants','view_as_context','feature_flags'))
 or (n.nspname='auth' and c.relname='users')
 or (n.nspname='vault' and c.relname='decrypted_secrets')
)
select jsonb_build_object(
 'checkedAt',clock_timestamp(),
 'serverVersion',current_setting('server_version'),
 'functions',(select jsonb_agg(jsonb_build_object('signature',d.signature,'exists',p.oid is not null,'owner',pg_get_userbyid(p.proowner),
   'securityDefiner',p.prosecdef,'bodyHash',md5(p.prosrc),'settings',p.proconfig,
   'authenticatedExecute',case when p.oid is not null then has_function_privilege('authenticated',p.oid,'execute') end,
   'serviceExecute',case when p.oid is not null then has_function_privilege('service_role',p.oid,'execute') end) order by d.signature)
   from dependencies d left join pg_proc p on p.oid=d.oid),
 'tables',(select jsonb_agg(jsonb_build_object('schema',t.nspname,'name',t.relname,'owner',pg_get_userbyid(t.relowner),'rls',t.relrowsecurity,
   'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull) order by a.attnum)
     from pg_attribute a where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped),
   'indexes',(select jsonb_agg(pg_get_indexdef(i.indexrelid) order by i.indexrelid) from pg_index i where i.indrelid=t.oid)) order by t.nspname,t.relname) from tables t),
 'existingQuickBooksObjects',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind) order by c.relname),'[]')
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'learn_quickbooks_%')
);
