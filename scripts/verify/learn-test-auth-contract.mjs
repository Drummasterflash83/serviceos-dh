/** Fixed schema-only contract used before synthetic TEST acceptance fixtures. */
export const AUTH_CONTRACT_QUERY = `select jsonb_build_object(
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(pg_catalog.pg_get_constraintdef(k.oid)),'[]') from pg_catalog.pg_constraint k where k.conrelid=c.oid),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',pg_catalog.pg_get_functiondef(t.tgfoid))),'[]') from pg_catalog.pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)))
 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where (n.nspname='public' and c.relname in ('tenants','profiles','email_messages','phone_calls','phone_recordings','phone_transcripts','email_sync_runs','phone_sync_runs')) and c.relkind='r'),
 'authTriggers',(select coalesce(jsonb_agg(jsonb_build_object('definition',pg_catalog.pg_get_triggerdef(t.oid),'function',pg_catalog.pg_get_functiondef(t.tgfoid))),'[]') from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relname='users' and not t.tgisinternal)
) as contract`;
