/** Read-only HTTP authority checks; positive behavior is separately covered by the
 * rolled-back SQL rehearsal. No JWT is forged and no login/grant is created. */
import {readFileSync,writeFileSync} from 'node:fs';
import {savedCliToken,TEST_PROJECT} from './learn-test-readiness.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {readPhoneOperatorCatalog,phoneOperatorSourceQuery} from './learn-phone-operator-catalog.mjs';
const requireValue=v=>{if(!v)throw Error('Verification did not pass');};
const ordered=rows=>JSON.stringify([...rows].sort((a,b)=>a.name.localeCompare(b.name)));
const path='.verification-results/phone-operator-http-result.json';
let report={state:'unconfirmed',projectRef:TEST_PROJECT,checks:[]};
try{
 requireValue(process.argv.slice(2).join(' ')==='--verify --existing-cli-login'&&process.env.LEARN_TEST_ALLOW_PROJECT_REF===TEST_PROJECT);
 const installed=JSON.parse(readFileSync('.verification-results/phone-operator-apply-result.json'));
 requireValue(installed.state==='installed_needs_hosted_acceptance'&&installed.projectRef===TEST_PROJECT);
 const token=savedCliToken(),catalog=await readPhoneOperatorCatalog(token);
 requireValue(catalog.fingerprint===installed.afterFingerprint);
 const snapshot=phoneOperatorSourceQuery(catalog.catalog.phone)+" union all select 'public.learn_phone_operator_reconciliations' as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from public.learn_phone_operator_reconciliations s";
 const before=await communicationQuery(token,snapshot);
 requireValue(before.length===112);
 const response=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
 requireValue(response.ok);const keys=await response.json();
 const id='00000000-0000-4000-8000-000000000000';
 const cases=[['attempt history','rpc/learn_operator_phone_attempts',{p_tenant:id}],
 ['reconcile','rpc/learn_operator_phone_reconcile',{p_tenant:id,p_request:id,p_actor:id,p_run:id,p_reason:'Synthetic access denial',p_mode:'check'}],
 ['private audit','learn_phone_operator_reconciliations?select=id&limit=1',null],
 ['private attempts','learn_phone_processing_attempts?select=run_id&limit=1',null]];
 for(const role of ['anon','service_role']){
  const matches=keys.filter(k=>k.name===role);requireValue(matches.length===1);
  const key=matches[0].api_key,claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url'));
  requireValue(claims.ref===TEST_PROJECT&&claims.role===role);
  for(const [name,route,body] of cases){
   // Processing attempts are an existing service-role reader, not a new denial.
   if(role==='service_role'&&name==='private attempts')continue;
   const r=await fetch(`https://${TEST_PROJECT}.supabase.co/rest/v1/${route}`,{method:body?'POST':'GET',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
   const data=await r.json();
   requireValue([401,403].includes(r.status)&&data.code==='42501');
   report.checks.push({role,name,status:r.status,code:data.code,passed:true});
  }
 }
 const [after,afterCatalog]=await Promise.all([communicationQuery(token,snapshot),readPhoneOperatorCatalog(token)]);
 requireValue(ordered(before)===ordered(after)&&afterCatalog.fingerprint===catalog.fingerprint);
 report={...report,state:'http_denials_verified',observedAt:new Date().toISOString(),schemaFingerprint:catalog.fingerprint,preservedDataSets:112,newUsers:0,newGrants:0,providerRequests:0,positiveSignedInAcceptance:false};
 writeFileSync(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report,null,2));
}catch{report={...report,state:'requires_inspection',observedAt:new Date().toISOString()};writeFileSync(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report,null,2));process.exitCode=1;}
