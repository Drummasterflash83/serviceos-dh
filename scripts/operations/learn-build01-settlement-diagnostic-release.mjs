/** One-file installed-worker patch: settle identity diagnostics through the fixed SQL contract. */
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { savedCliToken, TEST_PROJECT } from '../verify/learn-test-readiness.mjs';

const mode=process.argv.slice(2).join(' ');
if(!['--plan-test','--deploy-test','--plan-live','--deploy-live'].includes(mode))
  throw Error('Exact settlement-diagnostic release mode required');
const isTest=mode.endsWith('test'),deploy=mode.startsWith('--deploy-');
const project=isTest?TEST_PROJECT:'tgbnakbxwcqjeimygroz';
if(process.env[isTest?'LEARN_TEST_ALLOW_PROJECT_REF':'LEARN_LIVE_ALLOW_PROJECT_REF']!==project)
  throw Error('Exact project allowlist required');
const endpoint='platform-worker',target='_shared/learn-processing-job.ts';
const priorSha='889cc2adfa190ef09b8673ae56c3096dc0828836fef507d285dd8e2022a3700e';
const cli='/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase';
const sha=data=>createHash('sha256').update(data).digest('hex');
const token=savedCliToken(),base=`https://api.supabase.com/v1/projects/${project}/functions`;
async function inventory(){
  const r=await fetch(base,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('Worker inventory unavailable');
  const rows=await r.json();
  if(!Array.isArray(rows)||new Set(rows.map(row=>row.slug)).size!==rows.length)
    throw Error('Worker inventory changed');
  return rows;
}
const before=await inventory(),prior=before.find(row=>row.slug===endpoint);
if(!prior||prior.status!=='ACTIVE'||prior.verify_jwt!==false)throw Error('Worker state changed');
const body=await fetch(`${base}/${endpoint}/body`,{headers:{Authorization:`Bearer ${token}`},
  redirect:'error',signal:AbortSignal.timeout(30000)});
if(!body.ok)throw Error('Serving executable unavailable');
const rollback=Buffer.from(await body.arrayBuffer());
if(!rollback.subarray(0,5).equals(Buffer.from('ESZIP')))throw Error('Serving executable invalid');
const root=mkdtempSync(join(tmpdir(),`build01-settlement-${isTest?'test':'live'}-`));
const download=join(root,'download'),stage=join(root,'stage');mkdirSync(download);
const fetched=spawnSync(cli,['functions','download',endpoint,'--project-ref',project,'--workdir',download],{
  env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:90000,maxBuffer:2097152});
if(fetched.status!==0)throw Error('Installed worker download failed');
const sourceRoot=join(download,'supabase/functions',endpoint);
function walk(dir){return readdirSync(dir).flatMap(name=>{const path=join(dir,name);
  return statSync(path).isDirectory()?walk(path):[path];});}
const files=walk(sourceRoot);
if(files.length!==119)throw Error('Installed worker closure changed');
function patchSource(source){
  const insert=`  const settledResult = { ...result.result ?? {} };\n  const failureReasons = settledResult.failure_reasons;\n  delete settledResult.failure_reasons;\n  let settledErrorCode = result.success ? null : result.error?.code ?? "processing_handler_failed";\n  if (ctx.jobType === "identity.resolve" && settledErrorCode === "identity_delivery_unconfirmed" && failureReasons && typeof failureReasons === "object" && !Array.isArray(failureReasons)) {\n    const reasons = Object.entries(failureReasons);\n    if (reasons.length === 1 && Number.isSafeInteger(reasons[0][1]) && Number(reasons[0][1]) > 0 && /^(?:identity_[a-z_]+|processing_[a-z_]+|sqlstate_[A-Z0-9]{5}|postgrest_PGRST[0-9]{3}|(?:publish|inspect)_(?:error_unclassified|receipt_invalid|transport_exception)|delivery_unconfirmed)$/.test(reasons[0][0])) {\n      const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];\n      const encoded = reasons[0][0].replace(/[0-9]/g, digit => \`_\${words[Number(digit)]}\`).replace(/__+/g, "_").toLowerCase();\n      const code = \`identity_diag_\${encoded}\`;\n      if (code.length <= 80) settledErrorCode = code;\n    }\n  }\n`;
  const changes=[
    ['  const request = crypto.randomUUID();\n','  const request = crypto.randomUUID();\n'+insert],
    ['    result: result.result ?? {},','    result: settledResult,'],
    ['    error_code: result.success ? null : result.error?.code ?? "processing_handler_failed"','    error_code: settledErrorCode'],
  ];
  for(const [before,after] of changes){
    if(source.split(before).length!==2)throw Error('Installed settlement anchor changed');
    source=source.replace(before,after);
  }
  if(ts.createSourceFile(target,source,ts.ScriptTarget.Latest,true).parseDiagnostics.length)
    throw Error('Candidate source syntax invalid');
  return source;
}
const changed=[],manifest=[];
for(const path of files){
  const rel=relative(sourceRoot,path).replaceAll('\\','/');
  const mapped=rel.startsWith('functions/')?rel.slice('functions/'.length):`${endpoint}/${rel}`;
  if(!/\.(ts|js|json)$/.test(mapped)||mapped.includes('..'))throw Error('Unexpected source path');
  let source=readFileSync(path,'utf8'),original=sha(source);
  if(mapped===target){if(original!==priorSha)throw Error('Installed settlement source changed');source=patchSource(source);}
  if(sha(source)!==original)changed.push(mapped);
  const dest=join(stage,'supabase/functions',mapped);
  mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,source,{mode:0o600});
  manifest.push([mapped,sha(source)]);
}
if(JSON.stringify(changed)!==JSON.stringify([target]))throw Error('Worker change set differs');
writeFileSync(join(stage,'supabase/config.toml'),`project_id = "${project}"\n[functions.${endpoint}]\nverify_jwt = false\n`,{mode:0o600});
const candidateSha=sha(JSON.stringify(manifest.sort((a,b)=>a[0].localeCompare(b[0]))));
const report={project,beforeVersion:prior.version,candidateSha,changedPaths:changed,
  sourceFiles:files.length,rollbackSha:sha(rollback),productionDataWrites:false};
if(!deploy){console.log(JSON.stringify({state:'reviewed_no_deployment',...report}));process.exit(0);}
const deployed=spawnSync(cli,['functions','deploy',endpoint,'--project-ref',project,'--use-api','--workdir',stage],{
  env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:120000,maxBuffer:2097152});
const after=await inventory(),current=after.find(row=>row.slug===endpoint);
const others=rows=>JSON.stringify(rows.filter(row=>row.slug!==endpoint)
  .map(row=>[row.slug,row.version,row.ezbr_sha256]).sort((a,b)=>a[0].localeCompare(b[0])));
const okay=deployed.status===0&&current?.version===prior.version+1&&
  current?.status==='ACTIVE'&&current?.verify_jwt===false&&others(after)===others(before);
console.log(JSON.stringify({state:okay?'deployed_needs_hosted_acceptance':'requires_inspection',...report,
  afterVersion:current?.version??null,otherFunctionsUnchanged:others(after)===others(before),
  cliStatus:deployed.status}));
if(!okay)process.exitCode=1;
