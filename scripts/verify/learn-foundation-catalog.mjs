/** Read-only TEST definitions for an additive foundation release. No table rows. */
import { pathToFileURL } from 'node:url';
import { catalogFingerprint } from './learn-test-launch-rehearsal.mjs';
import { readTestCatalog,savedCliToken,TEST_PROJECT } from './learn-test-readiness.mjs';
export const FOUNDATION_CATALOG_QUERY=`select jsonb_build_object(
 'version','learn-foundation-catalog/1','observedAt',clock_timestamp(),'serverVersion',current_setting('server_version'),
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',r.rolname,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
   from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',k.conname,'kind',k.contype,'definition',pg_catalog.pg_get_constraintdef(k.oid)) order by k.conname),'[]') from pg_catalog.pg_constraint k where k.conrelid=c.oid),
 'indexes',(select coalesce(jsonb_agg(jsonb_build_object('name',i.indexname,'definition',i.indexdef) order by i.indexname),'[]') from pg_catalog.pg_indexes i where i.schemaname='public' and i.tablename=c.relname),
 'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',p.policyname,'roles',p.roles,'command',p.cmd,'using',p.qual,'check',p.with_check,'permissive',p.permissive) order by p.policyname),'[]') from pg_catalog.pg_policies p where p.schemaname='public' and p.tablename=c.relname),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',p.proname) order by t.tgname),'[]') from pg_catalog.pg_trigger t join pg_catalog.pg_proc p on p.oid=t.tgfoid where t.tgrelid=c.oid and not t.tgisinternal),
 'authenticatedSelect',pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT'),
 'authenticatedWrite',pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
 'anonAccess',pg_catalog.has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
 'serviceDml',(select bool_and(pg_catalog.has_table_privilege('service_role',c.oid,p)) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p)) order by c.relname)
 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace join pg_catalog.pg_roles r on r.oid=c.relowner where n.nspname='public' and c.relkind='r'),
 'foundationGuard',(select jsonb_build_object('definition',pg_catalog.pg_get_functiondef(p.oid),'owner',r.rolname,
  'securityDefiner',p.prosecdef,'settings',p.proconfig,
  'authenticatedExecute',pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'anonExecute',pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),
  'serviceExecute',pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE'))
  from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
  where p.oid=to_regprocedure('public.learn_foundation_reference_guard()')),
 'helpers',(select jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_catalog.pg_get_functiondef(p.oid)) order by p.proname)
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('current_tenant_id','current_user_role','is_openfolk','set_updated_at'))
) as catalog`;
export async function readFoundationCatalog({allowProjectRef,token,fetcher=fetch,includeBase=false}){
  const base=await readTestCatalog({allowProjectRef,token,fetcher});
  const response=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:FOUNDATION_CATALOG_QUERY}),
    redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Foundation metadata query failed');
  const chunks=[];let bytes=0;
  for await(const chunk of response.body){bytes+=chunk.byteLength;if(bytes>8388608)throw Error('Foundation metadata exceeds bound');chunks.push(chunk);}
  const rows=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!Array.isArray(rows)||rows.length!==1||!Array.isArray(rows[0]?.catalog?.tables)||!Array.isArray(rows[0]?.catalog?.helpers))throw Error('Incomplete foundation catalog');
  return {...(includeBase?{base}:{}),projectRef:TEST_PROJECT,readiness:base.report,readinessCatalogSha256:catalogFingerprint(base),...rows[0].catalog};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.slice(2).join(' ')!=='--existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST catalog and existing login required');
    console.log(JSON.stringify(await readFoundationCatalog({allowProjectRef:TEST_PROJECT,token:savedCliToken()}),null,2));
  }catch{console.error('TEST foundation metadata inspection failed; details withheld');process.exitCode=1;}
}
