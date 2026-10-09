/** Deploy only the reviewed Slack-only worker endpoint to the verified TEST project. */
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readWorkerCatalog} from './learn-slack-worker-catalog.mjs';
import {installedWorker} from './learn-test-worker-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const WORKER_ENDPOINT_FILES=['learn-slack-worker/index.ts', '_shared/worker_contract.ts', '_shared/worker_handlers/slack_history.ts', '_shared/slack/slack_history.ts', '_shared/slack/slack_history_batch.ts', '_shared/slack/slack_history_binding.ts', '_shared/slack/slack_history_errors.ts', '_shared/slack/slack_history_persist.ts', '_shared/slack/slack_history_request.ts', '_shared/slack/slack_history_server.ts', '_shared/slack/slack_worker.ts', '_shared/slack/slack_worker_http.ts'];
export function workerEndpointBundle(){
 const files=WORKER_ENDPOINT_FILES.map(path=>({path,source:readFileSync(new URL('../../supabase/functions/'+path,import.meta.url),'utf8')}));
 return {files,sha256:createHash('sha256').update(JSON.stringify(files)).digest('hex')};
}
// Release 010 can only redeploy its verified history-only source. Later runtime
// changes need their own matching schema/rehearsal and complete dependency list.
export function assertRelease010Endpoint(bundle){
 if(bundle.sha256!=='100c2720fbae1e678b0a310c7c5081d21ac05defeed22ea07f0afc46e165f337')
  throw Error('Worker source has advanced beyond release 010; a matching reviewed schema and endpoint release are required');
}
export async function deployWorker({allowProjectRef,token,fetcher=fetch,replaceVersion}){
 const bundle=workerEndpointBundle();assertRelease010Endpoint(bundle);
 const before=await readWorkerCatalog({allowProjectRef,token,fetcher});
 if(!installedWorker(before))throw Error('Exact installed TEST durable worker schema required');
 const existing=before.base.functions.find(f=>f.slug==='learn-slack-worker');
 if(existing&&existing.version!==replaceVersion||!existing&&replaceVersion!==undefined)throw Error('Exact existing worker version required for replacement');
 if(existing&&(existing.status!=='ACTIVE'||existing.verify_jwt!==true))throw Error('Existing endpoint contract differs');
 const stage=mkdtempSync(join(tmpdir(),'learn-slack-worker-endpoint-'));
 let status=null;
 try{
  mkdirSync(join(stage,'supabase/functions/learn-slack-worker'),{recursive:true});mkdirSync(join(stage,'supabase/functions/_shared'),{recursive:true});
  for(const f of bundle.files){mkdirSync(dirname(join(stage,'supabase/functions',f.path)),{recursive:true});writeFileSync(join(stage,'supabase/functions',f.path),f.source);}
  writeFileSync(join(stage,'supabase/config.toml'),`project_id = "${TEST_PROJECT}"\n[functions.learn-slack-worker]\nverify_jwt = true\n`);
  const cli='/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase';
  const r=spawnSync(cli,['functions','deploy','learn-slack-worker','--project-ref',TEST_PROJECT,'--use-api','--workdir',stage],{env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:120000,maxBuffer:2097152});
  status=r.status;
  // CLI output is withheld; API/credential material never enters the report.
 }finally{rmSync(stage,{recursive:true,force:true});}
 let after=null;try{after=await readWorkerCatalog({allowProjectRef,token,fetcher});}catch{}
 const endpoint=after?.base.functions.find(f=>f.slug==='learn-slack-worker');
 const rest=x=>JSON.stringify(x.filter(f=>f.slug!=='learn-slack-worker').sort((a,b)=>a.slug.localeCompare(b.slug)));
 const verified=status===0&&after&&installedWorker(after)&&endpoint?.status==='ACTIVE'&&endpoint.verify_jwt===true&&rest(before.base.functions)===rest(after.base.functions);
 return {version:'learn-test-worker-deploy/1',projectRef:TEST_PROJECT,observedAt:new Date().toISOString(),state:verified?'deployed_needs_user_acceptance':'requires_inspection',writeAttempted:true,cliExitStatus:status,sourceBundleSha256:bundle.sha256,replacedVersion:existing?.version??null,files:WORKER_ENDPOINT_FILES,endpoint:endpoint?{name:endpoint.slug,version:endpoint.version,status:endpoint.status,verifyJwt:endpoint.verify_jwt}:null,limitations:['Only the learn-slack-worker TEST endpoint was submitted; no prune, secrets, production or provider operations.','Deployment metadata is not signed-in HTTP acceptance; uncertain deployment is not retried automatically.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.slice(2).join(' ')!=='--deploy --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST endpoint deployment and saved login required');const r=await deployWorker({allowProjectRef:TEST_PROJECT,token:savedCliToken(),...(process.env.LEARN_TEST_REPLACE_WORKER_VERSION?{replaceVersion:Number(process.env.LEARN_TEST_REPLACE_WORKER_VERSION)}:{})});console.log(JSON.stringify(r,null,2));if(r.state!=='deployed_needs_user_acceptance')process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
