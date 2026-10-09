/** Fixed schema-only metadata for the TEST measurement release. */
import {checkedMeasurements} from './learn-measurements-bundle.mjs';
import {readRulesCatalog,RULES_FUNCTION_QUERY} from './learn-rules-catalog.mjs';
import {checkedRules} from './learn-rules-bundle.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
export const MEASUREMENT_FUNCTION_QUERY=RULES_FUNCTION_QUERY.replace(checkedRules().manifest.functions.map(n=>`'${n}'`).join(','),checkedMeasurements().manifest.functions.map(n=>`'${n}'`).join(','));
export async function readMeasurementsCatalog({allowProjectRef,token,fetcher=fetch}){
 const c=await readRulesCatalog({allowProjectRef,token,fetcher});
 const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:MEASUREMENT_FUNCTION_QUERY}),redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('Measurement function metadata unavailable');
 const chunks=[];let bytes=0;for await(const chunk of r.body??[]){bytes+=chunk.byteLength;if(bytes>2097152)throw Error('Measurement metadata exceeds bound');chunks.push(chunk);}
 const rows=JSON.parse(Buffer.concat(chunks).toString());if(rows?.length!==1||!Array.isArray(rows[0].functions))throw Error('Measurement metadata incomplete');
 return {...c,measurementFunctions:rows[0].functions};
}
