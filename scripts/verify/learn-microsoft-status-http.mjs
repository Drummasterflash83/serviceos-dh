/** Read-only HTTP authority checks; positive behavior is separately covered by the
 * rolled-back SQL rehearsal. No JWT is forged and no login/grant is created. */
import {readFileSync,writeFileSync} from 'node:fs';
import {savedCliToken,TEST_PROJECT} from './learn-test-readiness.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {readMicrosoftStatusCatalog,microsoftStatusSnapshot} from './learn-microsoft-status-catalog.mjs';
const requireValue=v=>{if(!v)throw Error('Verification did not pass');};
const ordered=rows=>JSON.stringify([...rows].sort((a,b)=>a.name.localeCompare(b.name)));
const path='.verification-results/microsoft-status-http-result.json';
let report={state:'unconfirmed',projectRef:TEST_PROJECT,checks:[]};
try{
 requireValue(process.argv.slice(2).join(' ')==='--verify --existing-cli-login'&&process.env.LEARN_TEST_ALLOW_PROJECT_REF===TEST_PROJECT);
 const installed=JSON.parse(readFileSync('.verification-results/microsoft-status-release-apply-result.json'));
 requireValue(installed.state==='installed_microsoft_status_verified'&&installed.projectRef===TEST_PROJECT);
 const token=savedCliToken(),catalog=await readMicrosoftStatusCatalog(token);
 requireValue(catalog.fingerprint===installed.afterFingerprint);
 const snapshot=microsoftStatusSnapshot(catalog.catalog.phone);
 const before=await communicationQuery(token,snapshot);
 requireValue(before.length===148);
 const response=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
 requireValue(response.ok);const keys=await response.json();
 const id='00000000-0000-4000-8000-000000000000';
 const cases=[['Microsoft operator status','rpc/learn_operator_microsoft_status',{p_tenant:id,p_after:null}]];
 for(const role of ['anon','service_role']){
  const matches=keys.filter(k=>k.name===role);requireValue(matches.length===1);
  const key=matches[0].api_key,claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url'));
  requireValue(claims.ref===TEST_PROJECT&&claims.role===role);
  for(const [name,route,body] of cases){
   const r=await fetch(`https://${TEST_PROJECT}.supabase.co/rest/v1/${route}`,{method:body?'POST':'GET',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
   const data=await r.json();
   requireValue([401,403].includes(r.status)&&data.code==='42501');
   report.checks.push({role,name,status:r.status,code:data.code,passed:true});
  }
 }
 const [after,afterCatalog]=await Promise.all([communicationQuery(token,snapshot),readMicrosoftStatusCatalog(token)]);
 requireValue(ordered(before)===ordered(after)&&afterCatalog.fingerprint===catalog.fingerprint);
 report={...report,state:'http_denials_verified',observedAt:new Date().toISOString(),schemaFingerprint:catalog.fingerprint,preservedDataSets:148,newUsers:0,newGrants:0,providerRequests:0,positiveSignedInAcceptance:false};
 writeFileSync(path,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report,null,2));
}catch{report={...report,state:'requires_inspection',observedAt:new Date().toISOString()};writeFileSync(path,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report,null,2));process.exitCode=1;}
