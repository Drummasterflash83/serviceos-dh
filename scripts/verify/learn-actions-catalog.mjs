/** Fixed TEST action definitions and public vocabularies; no work/source rows. */
import {ACTIONS_FUNCTIONS} from './learn-actions-bundle.mjs';
import {readWorkCatalog} from './learn-work-catalog.mjs';
import {RULES_FUNCTION_QUERY} from './learn-rules-catalog.mjs';
import {checkedRules} from './learn-rules-bundle.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
export const ACTIONS_FUNCTION_QUERY=RULES_FUNCTION_QUERY.replace(checkedRules().manifest.functions.map(n=>`'${n}'`).join(','),ACTIONS_FUNCTIONS.map(n=>`'${n}'`).join(','));
// object_classes may not exist before installation; its definition/seeds are read separately after the structural read.
export const ACTIONS_REGISTRY_QUERY=`select jsonb_build_object(
 'permissions',(select coalesce(jsonb_agg(to_jsonb(r) order by permission),'[]') from public.authority_permissions r),
 'types',(select coalesce(jsonb_agg(to_jsonb(r) order by domain,object_type),'[]') from public.domain_object_types r),
 'states',(select coalesce(jsonb_agg(to_jsonb(r) order by domain,object_type,state),'[]') from public.state_definitions r),
 'transitions',(select coalesce(jsonb_agg(to_jsonb(r) order by domain,object_type,from_state,to_state),'[]') from public.state_transitions r)) as registries`;
export const ACTIONS_CLASSES_QUERY=`select coalesce(jsonb_agg(to_jsonb(r) order by class),'[]') as classes from public.object_classes r`;
export async function readActionsCatalog({allowProjectRef,token,fetcher=fetch}){
 const c=await readWorkCatalog({allowProjectRef,token,fetcher});
 async function read(query,key){const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Action catalog unavailable');const chunks=[];let size=0;for await(const chunk of r.body??[]){size+=chunk.byteLength;if(size>2097152)throw Error('Action catalog exceeds bound');chunks.push(chunk);}const rows=JSON.parse(Buffer.concat(chunks).toString());if(rows?.length!==1||!rows[0]?.[key]||typeof rows[0][key]!=='object')throw Error('Action catalog incomplete');return rows[0][key];}
 const results=await Promise.allSettled([read(ACTIONS_FUNCTION_QUERY,'functions'),read(ACTIONS_REGISTRY_QUERY,'registries'),c.tables.some(t=>t.name==='object_classes')?read(ACTIONS_CLASSES_QUERY,'classes'):Promise.resolve([])]);
 if(results.some(r=>r.status!=='fulfilled'))throw Error('Action catalog reads incomplete');
 return {...c,actionFunctions:results[0].value,actionRegistries:results[1].value,actionClasses:results[2].value};
}
