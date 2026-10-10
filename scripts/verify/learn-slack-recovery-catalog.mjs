/** Fixed TEST metadata only; no source rows or credential values. */
import {readPacingCatalog} from './learn-slack-pacing-catalog.mjs';
import {THREADS_FUNCTIONS,THREADS_FUNCTION_QUERY} from './learn-slack-threads-catalog.mjs';
import {RECOVERY_NEW_FUNCTIONS} from './learn-slack-recovery-bundle.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
export const RECOVERY_FUNCTIONS=RECOVERY_NEW_FUNCTIONS;
export const RECOVERY_FUNCTION_QUERY=THREADS_FUNCTION_QUERY.replace(THREADS_FUNCTIONS.map(n=>`'${n}'`).join(','),RECOVERY_FUNCTIONS.map(n=>`'${n}'`).join(','));
export async function readRecoveryCatalog(args){
 const c=await readPacingCatalog(args),fetcher=args.fetcher??fetch;
 const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`,{method:'POST',headers:{Authorization:`Bearer ${args.token}`,'Content-Type':'application/json'},body:JSON.stringify({query:RECOVERY_FUNCTION_QUERY}),redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('Recovery metadata unavailable');const chunks=[];let bytes=0;
 for await(const chunk of r.body??[]){bytes+=chunk.byteLength;if(bytes>2097152)throw Error('Recovery metadata exceeds bound');chunks.push(chunk);}
 const rows=JSON.parse(Buffer.concat(chunks).toString());if(rows?.length!==1||!Array.isArray(rows[0]?.functions))throw Error('Recovery definitions incomplete');
 return {...c,recoveryFunctions:rows[0].functions};
}
