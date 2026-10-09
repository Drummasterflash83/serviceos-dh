/** Deploy only the reviewed work endpoint to the verified TEST project. */
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readActionsCatalog} from './learn-actions-catalog.mjs';
import {installedActions} from './learn-test-actions-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const ACTION_ENDPOINT_FILES=['work-transition/index.ts','_shared/authz.ts','_shared/audit.ts','_shared/work_transition.ts','_shared/work_authority.ts'];
export function actionEndpointBundle(){
 const files=ACTION_ENDPOINT_FILES.map(path=>({path,source:readFileSync(new URL('../../supabase/functions/'+path,import.meta.url),'utf8')}));
 return {files,sha256:createHash('sha256').update(JSON.stringify(files)).digest('hex')};
}
export async function deployActions({allowProjectRef,token,fetcher=fetch}){
 const before=await readActionsCatalog({allowProjectRef,token,fetcher});
 if(!installedActions(before))throw Error('Exact installed TEST action schema required');
 if(before.base.functions.some(f=>f.slug==='work-transition'))throw Error('Existing work endpoint requires explicit inspection before replacement');
 const bundle=actionEndpointBundle(),stage=mkdtempSync(join(tmpdir(),'learn-actions-endpoint-'));
 let status=null;
 try{
  mkdirSync(join(stage,'supabase/functions/work-transition'),{recursive:true});mkdirSync(join(stage,'supabase/functions/_shared'),{recursive:true});
  for(const f of bundle.files)writeFileSync(join(stage,'supabase/functions',f.path),f.source);
  writeFileSync(join(stage,'supabase/config.toml'),`project_id = "${TEST_PROJECT}"\n[functions.work-transition]\nverify_jwt = true\n`);
  const cli='/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase';
  const r=spawnSync(cli,['functions','deploy','work-transition','--project-ref',TEST_PROJECT,'--use-api','--workdir',stage],{env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:120000,maxBuffer:2097152});
  status=r.status;
  // CLI output is withheld; API/credential material never enters the report.
 }finally{rmSync(stage,{recursive:true,force:true});}
 let after=null;try{after=await readActionsCatalog({allowProjectRef,token,fetcher});}catch{}
 const endpoint=after?.base.functions.find(f=>f.slug==='work-transition');
 const rest=x=>JSON.stringify(x.filter(f=>f.slug!=='work-transition').sort((a,b)=>a.slug.localeCompare(b.slug)));
 const verified=status===0&&after&&installedActions(after)&&endpoint?.status==='ACTIVE'&&endpoint.verify_jwt===true&&rest(before.base.functions)===rest(after.base.functions);
 return {version:'learn-test-actions-deploy/1',projectRef:TEST_PROJECT,observedAt:new Date().toISOString(),state:verified?'deployed_needs_user_acceptance':'requires_inspection',writeAttempted:true,cliExitStatus:status,sourceBundleSha256:bundle.sha256,files:ACTION_ENDPOINT_FILES,endpoint:endpoint?{name:endpoint.slug,version:endpoint.version,status:endpoint.status,verifyJwt:endpoint.verify_jwt}:null,limitations:['Only the work-transition TEST endpoint was submitted; no prune, secrets, production or provider operations.','Deployment metadata is not signed-in HTTP acceptance; uncertain deployment is not retried automatically.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.slice(2).join(' ')!=='--deploy --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST endpoint deployment and saved login required');const r=await deployActions({allowProjectRef:TEST_PROJECT,token:savedCliToken()});console.log(JSON.stringify(r,null,2));if(r.state!=='deployed_needs_user_acceptance')process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
