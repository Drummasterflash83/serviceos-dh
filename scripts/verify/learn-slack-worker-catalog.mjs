/** Fixed TEST function/privilege metadata. Never reads Vault values or source rows. */
import {readSlackCatalog} from './learn-slack-catalog.mjs';
import {RULES_FUNCTION_QUERY} from './learn-rules-catalog.mjs';
import {checkedRules} from './learn-rules-bundle.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
export const WORKER_FUNCTIONS=['platform_jobs_claim','platform_jobs_complete_email_v1','slack_history_commit_page',
 'learn_slack_commit_page_private','learn_slack_claim_jobs','learn_slack_finish_job','learn_slack_read_credential'];
export const WORKER_FUNCTION_QUERY=RULES_FUNCTION_QUERY.replace(checkedRules().manifest.functions.map(n=>`'${n}'`).join(','),WORKER_FUNCTIONS.map(n=>`'${n}'`).join(','));
export const WORKER_PRIVILEGE_QUERY=`select jsonb_build_object(
 'vault',(select coalesce(jsonb_agg(jsonb_build_object('name',extname,'version',extversion)),'[]') from pg_extension where extname='supabase_vault'),
 'vaultOwnerAccess',jsonb_build_object('schema',has_schema_privilege('postgres','vault','USAGE'),'read',has_table_privilege('postgres','vault.decrypted_secrets','SELECT')),
 'queue',(select jsonb_agg(jsonb_build_object('role',r,'select',has_table_privilege(r,'public.platform_jobs','SELECT'),'insert',has_table_privilege(r,'public.platform_jobs','INSERT'),'update',has_table_privilege(r,'public.platform_jobs','UPDATE'),'delete',has_table_privilege(r,'public.platform_jobs','DELETE')) order by r) from unnest(array['anon','authenticated','service_role'])r)
 ) as worker_prerequisites`;
export async function readWorkerCatalog({allowProjectRef,token,fetcher=fetch}){
 const c=await readSlackCatalog({allowProjectRef,token,fetcher});
 async function query(sql,key){
  const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql}),redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('Worker metadata unavailable');const chunks=[];let bytes=0;
  for await(const chunk of r.body??[]){bytes+=chunk.byteLength;if(bytes>2097152)throw Error('Worker metadata exceeds bound');chunks.push(chunk);}
  const rows=JSON.parse(Buffer.concat(chunks).toString());if(rows?.length!==1||!rows[0]?.[key])throw Error('Worker metadata incomplete');return rows[0][key];
 }
 const [workerFunctions,workerPrerequisites]=await Promise.all([query(WORKER_FUNCTION_QUERY,'functions'),query(WORKER_PRIVILEGE_QUERY,'worker_prerequisites')]);
 return {...c,workerFunctions,workerPrerequisites};
}
