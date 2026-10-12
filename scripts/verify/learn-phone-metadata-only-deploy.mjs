/** TEST recording importer: explicit metadata-only option; no capture activation. */
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {savedCliToken,TEST_PROJECT,TEST_ORGANIZATION} from './learn-test-readiness.mjs';
import {edgeRuntimeBundle} from './learn-email-runtime-edge-bundle.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {preservationQuery} from './learn-commusoft-operator-run.mjs';
const check=(x,m)=>{if(!x)throw Error(m)};
check(process.argv[2]==='--deploy'&&process.env.LEARN_TEST_ALLOW_PROJECT_REF===TEST_PROJECT,'Explicit TEST deployment required');
const name='simwood-sync-recordings',stem='.verification-results/phone-metadata-only-runtime-v9',token=savedCliToken();
const bundle=edgeRuntimeBundle([{name,verifyJwt:true}]);
check(bundle.sha256==='5117e782024bef28864926251c9656fb21e2abc09e4fc54e1d36bd6089a56457'&&bundle.files.length===10,'Reviewed runtime closure differs');
const q=s=>communicationQuery(token,s,{readOnly:true});
async function metadata(path){const r=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}${path}`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});check(r.ok,'TEST metadata unavailable');return r.json();}
const identity=await metadata('');check(identity.id===TEST_PROJECT&&identity.organization_id===TEST_ORGANIZATION&&identity.status==='ACTIVE_HEALTHY','TEST identity changed');
const paused=await q("select count(*)::int active from public.tenant_connectors where provider='simwood' and enabled");check(paused.length===1&&paused[0].active===0,'Phone route must stay inactive for replacement');
const cronSchema=await q("select to_regclass('cron.job') is not null present");check(cronSchema.length===1,'Schedule metadata unavailable');if(cronSchema[0].present){const cron=await q("select count(*)::int active from cron.job where active");check(cron.length===1&&cron[0].active===0,'Unexpected active TEST schedule');}
const snapshot=preservationQuery(JSON.parse(readFileSync('.verification-results/commusoft-operator-2026-10-12.json')));
const catalog="select md5(coalesce(string_agg(pg_get_functiondef(p.oid),'' order by p.oid),'')) fingerprint from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in('f','p')";
const before=await q(snapshot),schema=await q(catalog),endpoints=await metadata('/functions');
const prior=endpoints.find(f=>f.slug===name);check(prior?.id==='0d980de4-9f6f-489c-8b29-103da9342a42'&&prior.version===8&&prior.status==='ACTIVE'&&prior.verify_jwt===true&&prior.ezbr_sha256==='f4381e965ef0f6173001a63b5e8f4b7bb6cb0dce2598be27cc3b5e83dca66c7c','Prior runtime differs; inspect before replacement');
const report={projectRef:TEST_PROJECT,state:'prepared',observedAt:new Date().toISOString(),sourceBundleSha256:bundle.sha256,sourcePaths:bundle.files.map(f=>f.path),before,schema,endpoints};
writeFileSync(stem+'-journal.json',JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
const stage=mkdtempSync(join(tmpdir(),'phone-metadata-only-'));let status;
try{
 for(const f of bundle.files){const path=join(stage,'supabase/functions',f.path);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,f.source);}
 writeFileSync(join(stage,'supabase/config.toml'),`project_id = "${TEST_PROJECT}"\n[functions.${name}]\nverify_jwt = true\n`);
 const r=spawnSync('/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase',['functions','deploy',name,'--project-ref',TEST_PROJECT,'--use-api','--workdir',stage],{env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:60000,maxBuffer:2097152});status=r.status;
}finally{rmSync(stage,{recursive:true,force:true});}
const after=await q(snapshot),afterSchema=await q(catalog),afterEndpoints=await metadata('/functions');
const endpoint=afterEndpoints.find(f=>f.slug===name),sort=rs=>JSON.stringify([...rs].sort((a,b)=>a.name.localeCompare(b.name)));
const rest=es=>JSON.stringify(es.filter(f=>f.slug!==name).sort((a,b)=>a.slug.localeCompare(b.slug)));
const result={state:'requires_inspection',projectRef:TEST_PROJECT,observedAt:new Date().toISOString(),sourceBundleSha256:bundle.sha256,cliExitStatus:status,endpoint:endpoint?{id:endpoint.id,name:endpoint.slug,version:endpoint.version,status:endpoint.status,verifyJwt:endpoint.verify_jwt,bundleSha256:endpoint.ezbr_sha256}:null,preservedDatasets:sort(before)===sort(after)?before.length:null,schemaUnchanged:JSON.stringify(schema)===JSON.stringify(afterSchema),otherEndpointsUnchanged:rest(endpoints)===rest(afterEndpoints),providerRequests:0,newAccounts:0,newGrants:0,productionChanged:false};
if(status===0&&result.preservedDatasets===194&&result.schemaUnchanged&&result.otherEndpointsUnchanged&&endpoint?.id===prior.id&&endpoint?.version===9&&endpoint?.status==='ACTIVE'&&endpoint?.verify_jwt===true)result.state='deployed_needs_hosted_acceptance';
writeFileSync(stem+'-result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result,null,2));if(result.state!=='deployed_needs_hosted_acceptance')process.exitCode=1;
