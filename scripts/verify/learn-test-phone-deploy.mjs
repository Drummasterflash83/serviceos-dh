/** New TEST-only phone endpoints; fixed release/source and no secrets or schedules. */
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,dirname,posix} from 'node:path';
import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {installedPhone} from './learn-test-phone-catalog.mjs';
import {readRecoveryCatalog} from './learn-slack-recovery-catalog.mjs';import {installedRecovery} from './learn-test-recovery-release.mjs';import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const PHONE_ENDPOINTS=['simwood-sync-calls','simwood-sync-recordings','simwood-download-recording','simwood-test-connection'];
export const PHONE_FILES=[...PHONE_ENDPOINTS.map(n=>n+'/index.ts'),'_shared/authz.ts','_shared/simwood.ts','_shared/simwood-account.ts','_shared/phone-sync-completeness.ts','_shared/phone_pipeline.ts'];
export const PHONE_SHA256='56d1b9c228d80f6b84e79b7a814b4d957f93fe3f7dd6313e22d8c8cb25641249';
export function phoneBundle(){const files=PHONE_FILES.map(path=>({path,source:readFileSync(new URL('../../supabase/functions/'+path,import.meta.url),'utf8')}));for(const f of files)for(const match of f.source.matchAll(/from\s+["'](\.[^"']+)["']/g)){const path=posix.normalize(posix.join(posix.dirname(f.path),match[1]));if(!PHONE_FILES.includes(path))throw Error('Phone dependency omitted: '+path);}return{files,sha256:createHash('sha256').update(JSON.stringify(files)).digest('hex')};}
export function assertPhoneBundle(bundle){if(bundle.sha256!==PHONE_SHA256)throw Error('Reviewed phone source differs');}
export async function assertNoPhoneCredentials(token,fetcher=fetch){const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/secrets`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('TEST secret-name inventory unavailable');const data=await r.json();if(!Array.isArray(data)||data.some(s=>!s||typeof s.name!=='string')||data.some(s=>['SIMWOOD_USERNAME','SIMWOOD_PASSWORD'].includes(s.name)))throw Error('Provider credentials present or unverified: no provider-free acceptance permitted');}
export async function deployPhone({allowProjectRef,token,fetcher=fetch}){
 const bundle=phoneBundle();assertPhoneBundle(bundle);const before=await readRecoveryCatalog({allowProjectRef,token,fetcher});if(!installedRecovery(before))throw Error('Exact installed TEST release 014 required');
 if(before.base.functions.some(f=>PHONE_ENDPOINTS.includes(f.slug)))throw Error('Existing phone endpoint requires inspection; never retry uncertain deployment');
 await assertNoPhoneCredentials(token,fetcher);
 const stage=mkdtempSync(join(tmpdir(),'learn-phone-endpoints-')),attempts=[];
 try{
  for(const f of bundle.files){const target=join(stage,'supabase/functions',f.path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,f.source);}
  writeFileSync(join(stage,'supabase/config.toml'),`project_id = "${TEST_PROJECT}"\n`+PHONE_ENDPOINTS.map(n=>`[functions.${n}]\nverify_jwt = true\n`).join(''));
  const cli='/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase';
  for(const name of PHONE_ENDPOINTS){const r=spawnSync(cli,['functions','deploy',name,'--project-ref',TEST_PROJECT,'--use-api','--workdir',stage],{env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:60000,maxBuffer:2097152});attempts.push({name,cliExitStatus:r.status});if(r.status!==0)break;}
 }finally{rmSync(stage,{recursive:true,force:true});}
 let after=null;try{after=await readRecoveryCatalog({allowProjectRef,token,fetcher});}catch{}
 const endpoints=after?.base.functions.filter(f=>PHONE_ENDPOINTS.includes(f.slug)).map(f=>({name:f.slug,version:f.version,status:f.status,verifyJwt:f.verify_jwt}))??[];
 const unrelated=functions=>JSON.stringify(functions.filter(f=>!PHONE_ENDPOINTS.includes(f.slug)).sort((a,b)=>a.slug.localeCompare(b.slug)));
 const verified=attempts.length===4&&attempts.every(a=>a.cliExitStatus===0)&&after&&installedPhone(after)&&endpoints.length===4&&endpoints.every(e=>e.version===1&&e.status==='ACTIVE'&&e.verifyJwt===true)&&unrelated(before.base.functions)===unrelated(after.base.functions);
 return{version:'learn-test-phone-deploy/1',projectRef:TEST_PROJECT,observedAt:new Date().toISOString(),state:verified?'deployed_needs_user_acceptance':'requires_inspection',sourceBundleSha256:bundle.sha256,files:PHONE_FILES,attempts,endpoints,limitations:['Four TEST phone functions only; no secrets, schedule, schema, production or provider operation.','CLI source hash and deployment metadata are not authenticated handler acceptance. Uncertain deployment is never retried automatically.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.slice(2).join(' ')!=='--deploy --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST phone deployment required');const r=await deployPhone({allowProjectRef:TEST_PROJECT,token:savedCliToken()});console.log(JSON.stringify(r,null,2));if(r.state!=='deployed_needs_user_acceptance')process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
