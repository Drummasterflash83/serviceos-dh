/** Hosted TEST worker boundary checks; no capture jobs or operator grants are created. */
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {readEmailDiagnosticCatalog,EMAIL_DIAGNOSTIC_SNAPSHOT} from './learn-email-diagnostic-catalog.mjs';
import {DIAGNOSTIC_SCHEMA} from './learn-email-diagnostic-runtime-deploy.mjs';
import {edgeInventory} from './learn-test-email-runtime-deploy.mjs';
const check=(v)=>{if(!v)throw Error('TEST boundary check unconfirmed');};
const checks=[];let phase='preflight';
try{
 check(process.argv.slice(2).join(' ')==='--verify --existing-cli-login'&&process.env.LEARN_TEST_ALLOW_PROJECT_REF===TEST_PROJECT);
 const token=savedCliToken();
 const [schema,endpoints,before,active]=await Promise.all([readEmailDiagnosticCatalog(token),edgeInventory(token),communicationQuery(token,EMAIL_DIAGNOSTIC_SNAPSHOT),communicationQuery(token,"select count(*)::int as count from public.platform_jobs where status in ('queued','running','retrying')")]);
 check(schema.fingerprint===DIAGNOSTIC_SCHEMA&&active[0]?.count===0&&endpoints.some(e=>e.slug==='platform-worker'&&e.version===6&&e.status==='ACTIVE'&&e.verify_jwt===false));
 phase='existing TEST credentials';
 const response=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});check(response.ok);
 const keys=await response.json();
 function key(name){const matches=keys.filter(r=>r.name===name);check(matches.length===1);const value=matches[0].api_key;const claims=JSON.parse(Buffer.from(value.split('.')[1],'base64url'));check(claims.ref===TEST_PROJECT&&claims.role===name);return value;}
 const anon=key('anon'),service=key('service_role');
 async function probe(label,headers,body,status,code){phase=label;const r=await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/platform-worker`,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});const data=await r.json();check(r.status===status&&(!code||data.error?.code===code));checks.push({label,status:r.status,code:code??null});return data;}
 await probe('missing worker credentials',{}, {},403,'forbidden');
 await probe('anonymous and incorrect internal key',{Authorization:`Bearer ${anon}`,'x-serviceos-internal-key':'invalid'}, {},403,'forbidden');
 const empty=await probe('authorised empty filtered worker',{Authorization:`Bearer ${service}`,apikey:service,'x-serviceos-internal-key':service},{job_types:['acceptance.'+randomUUID()],batch_size:1},200);
 check(empty.success===true&&empty.claimed===0&&empty.failed===0);
 phase='source preservation';const after=await communicationQuery(token,EMAIL_DIAGNOSTIC_SNAPSHOT);const canonical=rows=>JSON.stringify([...rows].sort((a,b)=>a.name.localeCompare(b.name)));check(canonical(before)===canonical(after));
 const report={version:'learn-email-diagnostic-http/1',projectRef:TEST_PROJECT,observedAt:new Date().toISOString(),state:'worker_boundaries_and_empty_execution_verified',checks,preservedDataSets:after.length,limitations:['No provider requests, source capture, user creation, new grants or production changes.','This does not establish signed-in operator access or a successful real mailbox capture.']};
 writeFileSync('docs/operations/evidence/learn-email-diagnostic-http-2026-10-11.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch{writeFileSync('.verification-results/email-diagnostic-http-unconfirmed.json',JSON.stringify({phase,checks},null,2)+'\n',{mode:0o600});console.error('TEST diagnostic HTTP verification unconfirmed at '+phase);process.exitCode=1;}
