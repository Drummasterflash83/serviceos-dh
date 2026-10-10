/** Deploy only the pinned governed-only LEARN import endpoint in verified TEST. */
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,dirname,posix} from 'node:path';
import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {readImportBatchesCatalog} from './learn-import-batches-catalog.mjs';
import {installedImportBatches} from './learn-test-import-batches-release.mjs';
import {expectedImportEndpoint} from './learn-test-import-endpoint-catalog.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const IMPORT_ENDPOINT_FILES=['learn-data-import/index.ts','data-import/handler.ts','_shared/authz.ts','_shared/audit.ts','_shared/simwood.ts','_shared/imports/profile.ts','_shared/imports/redact.ts','_shared/imports/matching.ts','_shared/imports/job_number.ts','_shared/imports/row_failure.ts','_shared/imports/batches.ts'];
export function importEndpointBundle(){
 const files=IMPORT_ENDPOINT_FILES.map(path=>({path,source:readFileSync(new URL('../../supabase/functions/'+path,import.meta.url),'utf8')}));
 for(const f of files)for(const m of f.source.matchAll(/from\s+["'](\.[^"']+)["']/g)){const p=posix.normalize(posix.join(posix.dirname(f.path),m[1]));if(!IMPORT_ENDPOINT_FILES.includes(p))throw Error('Import endpoint dependency omitted: '+p);}
 return {files,sha256:createHash('sha256').update(JSON.stringify(files)).digest('hex')};
}
export const IMPORT_ENDPOINT_SHA='6f1fd6f7ee939fc9b5fbd6a166d6d629cab66afde553183c0e1d8f4092254bd1';
export function assertImportEndpoint(b){if(b.sha256!==IMPORT_ENDPOINT_SHA)throw Error('Reviewed import endpoint source differs');}
export function withPriorImportEndpoint(c){
 const prior=structuredClone(c);prior.base.functions=prior.base.functions.map(f=>f.slug==='learn-data-import'?expectedImportEndpoint().endpoint:f);
 prior.readinessCatalogSha256=catalogFingerprint(prior.base);return prior;
}
export async function deployImportEndpoint({allowProjectRef,token,fetcher=fetch,runCli=spawnSync}){
 const bundle=importEndpointBundle();assertImportEndpoint(bundle);
 const before=await readImportBatchesCatalog({allowProjectRef,token,fetcher});
 if(!installedImportBatches(before))throw Error('Exact TEST release 025 with the original import endpoint required');
 const stage=mkdtempSync(join(tmpdir(),'learn-import-endpoint-'));let status=null;
 try{
  for(const f of bundle.files){mkdirSync(dirname(join(stage,'supabase/functions',f.path)),{recursive:true});writeFileSync(join(stage,'supabase/functions',f.path),f.source);}
  writeFileSync(join(stage,'supabase/config.toml'),`project_id = "${TEST_PROJECT}"\n[functions.learn-data-import]\nverify_jwt = true\n`);
  const r=runCli('/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase',['functions','deploy','learn-data-import','--project-ref',TEST_PROJECT,'--use-api','--workdir',stage],{env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:120000,maxBuffer:2097152});status=r.status;
 }catch{/* Inspect even when process observation throws; never resubmit. */}
 finally{rmSync(stage,{recursive:true,force:true});}
 let after=null;try{after=await readImportBatchesCatalog({allowProjectRef,token,fetcher});}catch{}
 const endpoint=after?.base.functions.find(f=>f.slug==='learn-data-import');
 const rest=c=>JSON.stringify(c.base.functions.filter(f=>f.slug!=='learn-data-import').sort((a,b)=>a.slug.localeCompare(b.slug)));
 const schemaVerified=!!after&&installedImportBatches(withPriorImportEndpoint(after));
 const verified=status===0&&schemaVerified&&endpoint?.status==='ACTIVE'&&endpoint.verify_jwt===true&&endpoint.version===expectedImportEndpoint().endpoint.version+1&&endpoint.id===expectedImportEndpoint().endpoint.id&&rest(before)===rest(after);
 return {version:'learn-test-import-endpoint/2',projectRef:TEST_PROJECT,observedAt:new Date().toISOString(),state:verified?'deployed_needs_authenticated_acceptance':'requires_inspection',writeAttempted:true,cliExitStatus:status,schemaVerified,otherEndpointsUnchanged:!!after&&rest(before)===rest(after),sourceBundleSha256:bundle.sha256,files:IMPORT_ENDPOINT_FILES,endpoint:endpoint??null,limitations:['Only the governed-only LEARN endpoint was replaced; legacy data-import was not deployed or replaced.','No real file import, provider, secret, schedule or production change. CLI output is withheld.','Metadata is not signed-in HTTP acceptance. An uncertain deployment must be inspected, never replayed automatically.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.slice(2).join(' ')!=='--deploy --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST endpoint deployment required');const r=await deployImportEndpoint({allowProjectRef:TEST_PROJECT,token:savedCliToken()});console.log(JSON.stringify(r,null,2));if(r.state!=='deployed_needs_authenticated_acceptance')process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
