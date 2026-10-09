/** Fixed TEST metadata only; no source rows or credential values. */
import {readWorkerCatalog,WORKER_FUNCTIONS,WORKER_FUNCTION_QUERY} from './learn-slack-worker-catalog.mjs';
import {THREADS_NEW_FUNCTIONS} from './learn-slack-threads-bundle.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
export const THREADS_FUNCTIONS=[...WORKER_FUNCTIONS,...THREADS_NEW_FUNCTIONS];
export const THREADS_FUNCTION_QUERY=WORKER_FUNCTION_QUERY.replace(WORKER_FUNCTIONS.map(n=>`'${n}'`).join(','),THREADS_FUNCTIONS.map(n=>`'${n}'`).join(','));
export async function readThreadsCatalog(args){
 const c=await readWorkerCatalog(args),fetcher=args.fetcher??fetch;
 const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`,{method:'POST',headers:{Authorization:`Bearer ${args.token}`,'Content-Type':'application/json'},body:JSON.stringify({query:THREADS_FUNCTION_QUERY}),redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('Thread metadata unavailable');const chunks=[];let bytes=0;
 for await(const chunk of r.body??[]){bytes+=chunk.byteLength;if(bytes>2097152)throw Error('Thread metadata exceeds bound');chunks.push(chunk);}
 const rows=JSON.parse(Buffer.concat(chunks).toString());if(rows?.length!==1||!Array.isArray(rows[0]?.functions))throw Error('Thread definitions incomplete');
 return {...c,threadFunctions:rows[0].functions};
}
