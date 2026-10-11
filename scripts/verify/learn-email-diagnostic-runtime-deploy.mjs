/** TEST worker replacement only. Existing database permissions and secrets remain unchanged. */
import {openSync,writeSync,fsyncSync,closeSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {edgeRuntimeBundle} from './learn-email-runtime-edge-bundle.mjs';
import {deployPinnedTestRuntime} from './learn-test-email-runtime-deploy.mjs';
import {readEmailDiagnosticCatalog,EMAIL_DIAGNOSTIC_SNAPSHOT,EMAIL_DIAGNOSTIC_PRESERVED} from './learn-email-diagnostic-catalog.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const DIAGNOSTIC_SCHEMA='a3b143ca0948e4f81ce1f1cfffaae3d0';
export const DIAGNOSTIC_RUNTIME_SCHEMA='fd212799ca3f6cb9624157bd9c24a90e';
export const DIAGNOSTIC_RUNTIME_SHA='38e546ff13e8a0acc35588c5e8cd5629f1862fe8745a1e3f5f2466151b0182bb';
export const DIAGNOSTIC_ENDPOINTS=[{name:'platform-worker',verifyJwt:false}];
export const diagnosticRuntimeBundle=()=>edgeRuntimeBundle(DIAGNOSTIC_ENDPOINTS);
function sources(rows){
 if(!Array.isArray(rows)||rows.length!==EMAIL_DIAGNOSTIC_PRESERVED.length||new Set(rows.map(r=>r.name)).size!==rows.length||rows.some(r=>!EMAIL_DIAGNOSTIC_PRESERVED.includes(r.name)||!Number.isSafeInteger(r.count)||r.count<0||!/^[a-f0-9]{32}$/.test(r.fingerprint)))throw Error('Full diagnostic preservation snapshot required');
 return JSON.stringify([...rows].sort((a,b)=>a.name.localeCompare(b.name)));
}
export async function deployEmailDiagnosticRuntime(args,{catalog=readEmailDiagnosticCatalog,query=communicationQuery,deploy=deployPinnedTestRuntime}={}){
 if(args.allowProjectRef!==TEST_PROJECT||Object.keys(args.replaceVersions??{}).length)throw Error('Exact TEST worker v5 replacement required');
 if(diagnosticRuntimeBundle().sha256!==DIAGNOSTIC_RUNTIME_SHA)throw Error('Diagnostic runtime source changed');
 const [before,rows]=await Promise.all([catalog(args.token),query(args.token,EMAIL_DIAGNOSTIC_SNAPSHOT)]);
 if(before.fingerprint!==DIAGNOSTIC_SCHEMA)throw Error('Installed diagnostic schema required');
 const preserved=sources(rows);
 const result=await deploy({...args,replaceVersions:{'platform-worker':5},persistJournal:journal=>args.persistJournal({...journal,diagnosticSchema:before.fingerprint,fullPreserved:rows})}, {
  bundle:diagnosticRuntimeBundle,endpoints:DIAGNOSTIC_ENDPOINTS,bundleSha:DIAGNOSTIC_RUNTIME_SHA,databaseFingerprint:DIAGNOSTIC_RUNTIME_SCHEMA,
  version:'learn-email-diagnostic-runtime/1',stagePrefix:'learn-email-diagnostic-runtime-',
 });
 const [after,afterRows]=await Promise.all([catalog(args.token),query(args.token,EMAIL_DIAGNOSTIC_SNAPSHOT)]);
 return {...result,state:after.fingerprint===DIAGNOSTIC_SCHEMA&&sources(afterRows)===preserved?result.state:'requires_inspection',diagnosticSchema:after.fingerprint,fullPreservedDataSets:sources(afterRows)===preserved?rows.length:null};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.slice(2).join(' ')!=='--deploy --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST worker replacement required');
  const prefix='.verification-results/email-diagnostic-runtime-deploy';
  const result=await deployEmailDiagnosticRuntime({allowProjectRef:TEST_PROJECT,token:savedCliToken(),persistJournal:async journal=>{
   const fd=openSync(prefix+'-journal.json','wx',0o600);try{writeSync(fd,JSON.stringify(journal,null,2));fsyncSync(fd);}finally{closeSync(fd);}
  },onProgress:r=>console.log(JSON.stringify(r))});
  writeFileSync(prefix+'-result.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result,null,2));
  if(result.state!=='deployed_needs_http_acceptance')process.exitCode=1;
 }catch{console.error('Diagnostic worker replacement unconfirmed; inspect retained journal and TEST inventory before any retry.');process.exitCode=1;}
}
