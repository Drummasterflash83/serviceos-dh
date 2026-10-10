/** Schema and privilege metadata only; restricted to the verified TEST project. */
import {readFileSync} from 'node:fs';
import {readImportBatchesCatalog} from './learn-import-batches-catalog.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {RULES_FUNCTION_QUERY} from './learn-rules-catalog.mjs';
export const COMMUSOFT_MANIFEST=JSON.parse(readFileSync(new URL('../../supabase/release/learn-test/026_commusoft_inputs.manifest.json',import.meta.url)));
export const COMMUSOFT_FUNCTIONS=[...COMMUSOFT_MANIFEST.functions,...COMMUSOFT_MANIFEST.changedFunctions];
export const COMMUSOFT_BASE_TABLES=['tenants','profiles','view_as_context','config_versions','connector_accounts','provider_connections','tenant_connectors','platform_jobs','people','companies','customer_cards','sites','jobs'];
export const COMMUSOFT_HELPERS=['current_tenant_id','current_user_role','is_openfolk','set_updated_at','learn_foundation_reference_guard','learn_scorecard_revision_immutable','slack_version_immutable','learn_work_authority_input_lock','learn_work_registry_input_lock','learn_import_batch_authority'];
const quoted=a=>a.map(n=>`'${n}'`).join(',');
export const COMMUSOFT_FUNCTION_QUERY=RULES_FUNCTION_QUERY.replace(/p\.proname in \([^)]*\)/,`p.proname in (${quoted([...COMMUSOFT_FUNCTIONS,...COMMUSOFT_HELPERS])})`);
export const COMMUSOFT_GRANTS_QUERY=`select coalesce(jsonb_agg(x order by x::text),'[]') as grants from (
 select jsonb_build_object('table',c.relname,'column',null,'role',case when a.grantee=0 then 'public' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) x
 from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(c.relacl) a
 where n.nspname='public' and c.relname in (${quoted([...COMMUSOFT_BASE_TABLES,...COMMUSOFT_MANIFEST.tables])})
 union all
 select jsonb_build_object('table',c.relname,'column',col.attname,'role',case when a.grantee=0 then 'public' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute col on col.attrelid=c.oid cross join lateral aclexplode(col.attacl) a
 where n.nspname='public' and c.relname in (${quoted([...COMMUSOFT_BASE_TABLES,...COMMUSOFT_MANIFEST.tables])})
) acl`;
export async function readCommusoftCatalog(args){
 const c=await readImportBatchesCatalog(args);
 const [f,g]=await Promise.all([communicationQuery(args.token,COMMUSOFT_FUNCTION_QUERY,args),communicationQuery(args.token,COMMUSOFT_GRANTS_QUERY,args)]);
 if(f?.length!==1||!Array.isArray(f[0]?.functions)||g?.length!==1||!Array.isArray(g[0]?.grants))throw Error('Commusoft metadata incomplete');
 return {...c,commusoftFunctions:f[0].functions,commusoftGrants:g[0].grants};
}
