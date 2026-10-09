/** Bind the existing TEST service credential to the worker's explicit trigger.
 * No new credential. Values stay in memory and CLI stdin, never args/files/logs. */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readWorkerCatalog} from './learn-slack-worker-catalog.mjs';
import {installedWorker} from './learn-test-worker-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
if(process.argv.slice(2).join(' ')!=='--bind-existing-test-key --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit existing TEST key reuse required');
const token=savedCliToken(),c=await readWorkerCatalog({allowProjectRef:TEST_PROJECT,token});if(!installedWorker(c))throw Error('Exact TEST worker schema required');
const r=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Existing TEST credential unavailable');
const keys=(await r.json()).filter(k=>k.name==='service_role');if(keys.length!==1)throw Error('Unique existing service credential required');
const key=keys[0].api_key,claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());if(claims.ref!==TEST_PROJECT||claims.role!=='service_role'||/[\r\n]/.test(key))throw Error('Credential scope differs');
const name='LEARN_SLACK_WORKER_KEY',cli='/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase',env={...process.env,SUPABASE_ACCESS_TOKEN:token};
const listed=spawnSync(cli,['secrets','list','--project-ref',TEST_PROJECT,'--output','json'],{env,encoding:'utf8',timeout:30000,maxBuffer:1048576});if(listed.status!==0)throw Error('Secret name inventory unavailable');
let inventory;
try{inventory=JSON.parse(listed.stdout);}catch{
 // This installed CLI emits its NAME/DIGEST table even with --output json.
 if(!/NAME\s*\|\s*DIGEST/.test(listed.stdout))throw Error('Secret inventory format differs');
 inventory=listed.stdout.split('\n').filter(line=>line.includes('|')&&!/NAME\s*\|\s*DIGEST/.test(line)&&!/^[-+|\s]+$/.test(line)).map(line=>{
  const match=/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\|\s*([a-f0-9]{64})\s*$/.exec(line);
  if(!match)throw Error('Secret inventory row format differs');return {name:match[1],digest:match[2]};
 });
}
if(!Array.isArray(inventory))throw Error('Secret inventory format differs');
const existing=inventory.filter(s=>s.name===name),digest=createHash('sha256').update(key).digest('hex');
if(existing.length&&!(existing.length===1&&[existing[0].digest,existing[0].value].includes(digest)))throw Error('Existing worker trigger binding requires inspection');
let status=null;if(!existing.length){
 const set=spawnSync(cli,['secrets','set','--env-file','/dev/stdin','--project-ref',TEST_PROJECT],{env,input:`${name}=${key}\n`,encoding:'utf8',timeout:45000,maxBuffer:1048576});status=set.status;
}
console.log(JSON.stringify({version:'learn-test-worker-key/1',projectRef:TEST_PROJECT,observedAt:new Date().toISOString(),name,state:existing.length?'existing_binding_matches':status===0?'configured_needs_http_verification':'requires_inspection',writeAttempted:!existing.length,cliExitStatus:status,reusedExistingServiceCredential:true},null,2));
if(!existing.length&&status!==0)process.exitCode=1;
