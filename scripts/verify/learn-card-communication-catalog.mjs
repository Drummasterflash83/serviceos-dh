/** Exact read-only TEST metadata for the restricted card communication surface. */
import {readPhoneCatalog} from './learn-test-phone-access.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
export const COMMUNICATION_FUNCTION='learn_card_communications_read',COMMUNICATION_ROLE='learn_card_communication_reader';
export const COMMUNICATION_CATALOG_QUERY=`set local search_path=public,pg_catalog;
select jsonb_build_object(
 'policies',(select coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'roles',roles,'command',cmd,'using',qual,'check',with_check,'permissive',permissive) order by tablename,policyname),'[]') from pg_policies where schemaname='public' and policyname in ('learn_card_communication_profile','learn_card_communication_read')),
 'role',(select jsonb_build_object('name',rolname,'login',rolcanlogin,'inherit',rolinherit,'superuser',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,'bypassRls',rolbypassrls) from pg_roles where rolname='learn_card_communication_reader'),
 'memberships',(select coalesce(jsonb_agg(jsonb_build_object('role',r.rolname,'member',u.rolname,'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option) order by r.rolname,u.rolname),'[]') from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member where r.rolname='learn_card_communication_reader' or u.rolname='learn_card_communication_reader'),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),'owner',r.rolname,'securityDefiner',p.prosecdef,'settings',p.proconfig,'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.oid),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='public' and p.proname='learn_card_communications_read'),
 'readerGrants',(select coalesce(jsonb_agg(x order by x::text),'[]') from (
  select jsonb_build_object('schema',n.nspname,'table',c.relname,'column',a.attname,'privilege',g.privilege_type,'grantable',g.is_grantable) x from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(a.attacl) g join pg_roles r on r.oid=g.grantee where r.rolname='learn_card_communication_reader'
  union all select jsonb_build_object('schema',n.nspname,'table',c.relname,'column',null,'privilege',g.privilege_type,'grantable',g.is_grantable) from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(c.relacl) g join pg_roles r on r.oid=g.grantee where r.rolname='learn_card_communication_reader'
  union all select jsonb_build_object('schema',n.nspname,'privilege',g.privilege_type,'grantable',g.is_grantable) from pg_namespace n cross join lateral aclexplode(n.nspacl) g join pg_roles r on r.oid=g.grantee where r.rolname='learn_card_communication_reader'
 ) grants),
 'sourceAccess',(select jsonb_agg(x order by x::text) from (
  select jsonb_build_object('table',c.relname,'column',a.attname,'role',r,'select',has_column_privilege(r,c.oid,a.attnum,'SELECT'),'insert',has_column_privilege(r,c.oid,a.attnum,'INSERT'),'update',has_column_privilege(r,c.oid,a.attnum,'UPDATE'),'references',has_column_privilege(r,c.oid,a.attnum,'REFERENCES')) x from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped cross join unnest(array['anon','authenticated','service_role']) r where n.nspname='public' and c.relname in ('profiles','interactions')
 ) access)
) as communications`;
export async function communicationQuery(token,sql,{fetcher=fetch,readOnly=true}={}){
 const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly?'/read-only':''}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql,...(readOnly?{}:{read_only:false})}),redirect:'error',signal:AbortSignal.timeout(45000)});
 if(!r.ok)throw Error('TEST communication metadata/operation failed HTTP '+r.status);
 const chunks=[];let size=0;for await(const chunk of r.body??[]){size+=chunk.byteLength;if(size>4194304)throw Error('TEST communication response exceeds bound');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString());
}
export async function readCommunicationCatalog(args){const c=await readPhoneCatalog(args),rows=await communicationQuery(args.token,COMMUNICATION_CATALOG_QUERY,args);if(rows?.length!==1||!Array.isArray(rows[0]?.communications?.functions)||!Array.isArray(rows[0]?.communications?.sourceAccess))throw Error('Communication catalog incomplete');return {...c,communications:rows[0].communications};}
