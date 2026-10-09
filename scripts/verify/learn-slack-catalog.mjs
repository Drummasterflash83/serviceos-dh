/** Fixed TEST Slack definitions only. Never reads messages or secret values. */
import {SLACK_FUNCTIONS} from './learn-slack-bundle.mjs';
import {readActionsCatalog} from './learn-actions-catalog.mjs';
import {RULES_FUNCTION_QUERY} from './learn-rules-catalog.mjs';
import {checkedRules} from './learn-rules-bundle.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
export const SLACK_FUNCTION_QUERY=RULES_FUNCTION_QUERY.replace(checkedRules().manifest.functions.map(n=>`'${n}'`).join(','),SLACK_FUNCTIONS.map(n=>`'${n}'`).join(','));
export async function readSlackCatalog({allowProjectRef,token,fetcher=fetch}){
 const c=await readActionsCatalog({allowProjectRef,token,fetcher});
 const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:SLACK_FUNCTION_QUERY}),redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('Slack definitions unavailable');const chunks=[];let size=0;
 for await(const chunk of r.body??[]){size+=chunk.byteLength;if(size>2097152)throw Error('Slack definitions exceed bound');chunks.push(chunk);}
 const rows=JSON.parse(Buffer.concat(chunks).toString());if(rows?.length!==1||!Array.isArray(rows[0]?.functions))throw Error('Slack definitions incomplete');
 return {...c,slackFunctions:rows[0].functions};
}
