/** TEST schema/config metadata only; no source rows or credential values. */
import {readThreadRecoveryCatalog} from './learn-slack-thread-recovery-catalog.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {RULES_FUNCTION_QUERY} from './learn-rules-catalog.mjs';
import {buildImportBundle} from './learn-import-bundle.mjs';
export const IMPORT_FUNCTIONS=buildImportBundle().manifest.functions;
export const IMPORT_FUNCTION_QUERY=RULES_FUNCTION_QUERY.replace(/p\.proname in \([^)]*\)/,`p.proname in (${IMPORT_FUNCTIONS.map(n=>`'${n}'`).join(',')})`).replace(' as functions',' as import_functions');
export const IMPORT_PROFILE_QUERY=`select coalesce(jsonb_agg(jsonb_build_object('tenant_id',tenant_id,'source_system',source_system,'entity_type',entity_type,'name',name,'definition',definition,'active',active,'version',version) order by name),'[]') as import_profiles from public.import_profiles where source_system='commusoft' and name in ('Commusoft Prepared Customers','Commusoft Prepared Sites','Commusoft Prepared Jobs')`;
export async function readGovernedImportCatalog(args){
 const c=await readThreadRecoveryCatalog(args);
 const f=await communicationQuery(args.token,IMPORT_FUNCTION_QUERY,args);
 const p=await communicationQuery(args.token,IMPORT_PROFILE_QUERY,args);
 if(f?.length!==1||!Array.isArray(f[0]?.import_functions)||p?.length!==1||!Array.isArray(p[0]?.import_profiles))throw Error('Import metadata incomplete');
 return {...c,importFunctions:f[0].import_functions,importProfiles:p[0].import_profiles};
}
