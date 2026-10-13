/** Read-only drift check against the last reviewed hosted schema and runtime.
 * This does not prove current data preservation, drain, approval or release health.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {savedCliToken} from './learn-test-readiness.mjs';
const project='tgbnakbxwcqjeimygroz',directory=process.argv[2];
if(process.env.LEARN_PRODUCTION_READ_ONLY_PROJECT!==project||!/^\.verification-results\/production-current-baseline-[a-z0-9-]+$/.test(directory??''))throw Error('Explicit read-only scope and fresh private directory required');
mkdirSync(directory,{mode:0o700});
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const token=savedCliToken();
async function api(path,query){const r=await fetch(`https://api.supabase.com/v1/projects/${project}${path}`,{method:query?'POST':'GET',headers:{Authorization:'Bearer '+token,...(query?{'Content-Type':'application/json'}:{})},...(query?{body:JSON.stringify({query})}:{}),redirect:'error',signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('Read-only baseline HTTP '+r.status);return r.json();}
const results=await Promise.allSettled([
 api('/database/query/read-only',readFileSync('scripts/verify/learn-release-schema-inventory.sql','utf8')),
 api('/functions'),
]);
if(results.some(r=>r.status!=='fulfilled'))throw Error('Current baseline unavailable; release remains unverified');
const schema=results[0].value[0]?.inventory;
const runtime=results[1].value.map(f=>({name:f.slug,id:f.id,version:f.version,hash:f.ezbr_sha256,jwt:f.verify_jwt,status:f.status})).sort((a,b)=>a.name.localeCompare(b.name));
const schemaPath='.verification-results/production-release-readonly-20261012/schema.json';
const runtimePath='.verification-results/learning-release-production-inventory-20261013.json';
const baselineSchema=JSON.parse(readFileSync(schemaPath));
const baselineRuntime=JSON.parse(readFileSync(runtimePath)).sort((a,b)=>a.name.localeCompare(b.name));
const differences={};
for(const kind of ['tables','functions','views']){
 if(!Array.isArray(schema?.[kind]))throw Error('Incomplete schema baseline');
 const key=x=>x.name+'('+String(x.arguments??'')+')';const before=new Map(baselineSchema[kind].map(x=>[key(x),x])),after=new Map(schema[kind].map(x=>[key(x),x]));
 differences[kind]={added:[...after.keys()].filter(k=>!before.has(k)),missing:[...before.keys()].filter(k=>!after.has(k)),changed:[...after.keys()].filter(k=>before.has(k)&&canonical(after.get(k))!==canonical(before.get(k)))};
}
const schemaMatches=canonical(schema)===canonical(baselineSchema),runtimeMatches=canonical(runtime)===canonical(baselineRuntime);
for(const[name,data]of[['schema.json',schema],['runtime.json',runtime]])writeFileSync(directory+'/'+name,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});
const report={state:schemaMatches&&runtimeMatches?'reviewed_hosted_baseline_unchanged':'hosted_baseline_drift',observedAt:new Date().toISOString(),project,schemaMatches,runtimeMatches,differences,functionCount:runtime.length,baselineSchemaSha256:sha(readFileSync(schemaPath)),baselineRuntimeSha256:sha(readFileSync(runtimePath)),currentSchemaSha256:sha(canonical(schema)),currentRuntimeSha256:sha(canonical(runtime)),productionChanges:0,providerRequests:0,limitations:['Public schema and hosted runtime definitions only; not a preservation snapshot, active-work drain or signed-in acceptance.','Matches the reviewed hosted schema; earlier isolated-archive deparsing differences are not ignored or reclassified by this check.']};
writeFileSync(directory+'/report.json',JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify(report));if(!schemaMatches||!runtimeMatches)process.exitCode=1;
