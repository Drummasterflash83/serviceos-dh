/** Fixed TEST work function/sequence definitions; never reads captured source rows. */
import {checkedWork} from './learn-work-bundle.mjs';
import {readMeasurementsCatalog} from './learn-measurements-catalog.mjs';
import {RULES_FUNCTION_QUERY} from './learn-rules-catalog.mjs';
import {checkedRules} from './learn-rules-bundle.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
export const WORK_FUNCTION_QUERY=RULES_FUNCTION_QUERY.replace(checkedRules().manifest.functions.map(n=>`'${n}'`).join(','),checkedWork().manifest.functions.map(n=>`'${n}'`).join(','));
export const WORK_SEQUENCE_QUERY=`select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'owner',r.rolname,'type',format_type(s.seqtypid,null),'start',s.seqstart::text,'increment',s.seqincrement::text,'min',s.seqmin::text,'max',s.seqmax::text,'cache',s.seqcache::text,'cycle',s.seqcycle,'authenticatedAccess',has_sequence_privilege('authenticated',c.oid,'USAGE,SELECT,UPDATE'),'anonAccess',has_sequence_privilege('anon',c.oid,'USAGE,SELECT,UPDATE'),'serviceAccess',has_sequence_privilege('service_role',c.oid,'USAGE,SELECT,UPDATE')) order by c.relname),'[]') as sequences from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_sequence s on s.seqrelid=c.oid join pg_roles r on r.oid=c.relowner where n.nspname='public' and c.relname='learn_work_capture_sequence'`;
export async function readWorkCatalog({allowProjectRef,token,fetcher=fetch}){
 const c=await readMeasurementsCatalog({allowProjectRef,token,fetcher});
 async function read(query,key){const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Work metadata unavailable');const chunks=[];let size=0;for await(const chunk of r.body??[]){size+=chunk.byteLength;if(size>2097152)throw Error('Work metadata exceeds bound');chunks.push(chunk);}const rows=JSON.parse(Buffer.concat(chunks).toString());if(rows?.length!==1||!Array.isArray(rows[0][key]))throw Error('Work metadata incomplete');return rows[0][key];}
 const results=await Promise.allSettled([read(WORK_FUNCTION_QUERY,'functions'),read(WORK_SEQUENCE_QUERY,'sequences')]);
 if(results.some(r=>r.status!=='fulfilled'))throw Error('Work definition reads incomplete');
 return {...c,workFunctions:results[0].value,workSequences:results[1].value};
}
