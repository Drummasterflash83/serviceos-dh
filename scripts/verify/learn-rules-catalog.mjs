/** Schema-only details of the fixed rules functions, in the verified TEST project. */
import { checkedRules } from './learn-rules-bundle.mjs';
import { readFoundationCatalog } from './learn-foundation-catalog.mjs';
import { TEST_PROJECT } from './learn-test-readiness.mjs';
export const RULES_FUNCTION_QUERY=`select coalesce(jsonb_agg(jsonb_build_object(
 'name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),
 'owner',r.rolname,'securityDefiner',p.prosecdef,'settings',p.proconfig,
 'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
 'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
 'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.proname),'[]') as functions
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
 where n.nspname='public' and p.proname in (${checkedRules().manifest.functions.map(n=>`'${n}'`).join(',')})`;
export async function readRulesCatalog({allowProjectRef,token,fetcher=fetch}){
 const c=await readFoundationCatalog({allowProjectRef,token,fetcher,includeBase:true});
 const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:RULES_FUNCTION_QUERY}),redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('Rules function metadata unavailable');
 const chunks=[];let bytes=0;for await(const chunk of r.body??[]){bytes+=chunk.byteLength;if(bytes>2097152)throw Error('Rules metadata exceeds bound');chunks.push(chunk);}
 const rows=JSON.parse(Buffer.concat(chunks).toString());
 if(rows?.length!==1||!Array.isArray(rows[0].functions))throw Error('Rules function metadata incomplete');
 return {...c,rulesFunctions:rows[0].functions};
}
