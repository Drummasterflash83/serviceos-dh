/** Coordinated TEST Phone runtime; capture, schedules and credentials are not activated. */
import {openSync,writeSync,fsyncSync,closeSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {edgeRuntimeBundle} from './learn-email-runtime-edge-bundle.mjs';
import {deployPinnedTestRuntime} from './learn-test-email-runtime-deploy.mjs';
import {readPhoneProcessingCatalog,phoneProcessingSourceQuery,PHONE_PROCESSING_TABLES} from './learn-phone-processing-catalog.mjs';
import {EMAIL_DIAGNOSTIC_PRESERVED} from './learn-email-diagnostic-catalog.mjs';
const NEW_TABLES=PHONE_PROCESSING_TABLES.slice(3).map(n=>'public.'+n);
const PRESERVED=[...EMAIL_DIAGNOSTIC_PRESERVED,...NEW_TABLES];
const snapshot=catalog=>phoneProcessingSourceQuery(catalog.phone)+' union all '+NEW_TABLES.map(n=>`select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from ${n} s`).join(' union all ');
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const PHONE_PROCESSING_SCHEMA='7d31c2f3169a9a3da7298a131a7058eb';
export const PHONE_PROCESSING_RUNTIME_SCHEMA='b23dd2a253398d0dcb10b860363f75bd';
export const PHONE_PROCESSING_RUNTIME_SHA='6de94e2033c6a816ee68e01faf75f1b2ef6470cae22487c3a03aad56c12d14e0';
export const PHONE_PROCESSING_ENDPOINTS=['simwood-download-recording','phone-transcribe-recording','phone-analyse-transcript','phone-process-pipeline','phone-process-pending'].map(name=>({name,verifyJwt:true})).concat([{name:'platform-worker',verifyJwt:false}]);
export const phoneProcessingRuntimeBundle=()=>edgeRuntimeBundle(PHONE_PROCESSING_ENDPOINTS);
function sources(rows){
 if(!Array.isArray(rows)||rows.length!==PRESERVED.length||new Set(rows.map(r=>r.name)).size!==rows.length||rows.some(r=>!PRESERVED.includes(r.name)||!Number.isSafeInteger(r.count)||r.count<0||!/^[a-f0-9]{32}$/.test(r.fingerprint)))throw Error('Full phoneProcessing preservation snapshot required');
 return JSON.stringify([...rows].sort((a,b)=>a.name.localeCompare(b.name)));
}
export async function deployPhoneProcessingRuntime(args,{catalog=readPhoneProcessingCatalog,query=communicationQuery,deploy=deployPinnedTestRuntime}={}){
 if(args.allowProjectRef!==TEST_PROJECT||Object.keys(args.replaceVersions??{}).length)throw Error('Exact coordinated TEST Phone deployment required');
 if(phoneProcessingRuntimeBundle().sha256!==PHONE_PROCESSING_RUNTIME_SHA)throw Error('PhoneProcessing runtime source changed');
 const before=await catalog(args.token);
 const sourceSql=snapshot(before.catalog);
 const rows=await query(args.token,sourceSql);
 if(before.fingerprint!==PHONE_PROCESSING_SCHEMA)throw Error('Installed phoneProcessing schema required');
 const preserved=sources(rows);
 const result=await deploy({...args,replaceVersions:{'platform-worker':6,'phone-process-pending':1,'simwood-download-recording':3},persistJournal:journal=>args.persistJournal({...journal,phoneProcessingSchema:before.fingerprint,fullPreserved:rows})}, {
  bundle:phoneProcessingRuntimeBundle,endpoints:PHONE_PROCESSING_ENDPOINTS,bundleSha:PHONE_PROCESSING_RUNTIME_SHA,databaseFingerprint:PHONE_PROCESSING_RUNTIME_SCHEMA,
  version:'learn-phone-processing-runtime/1',stagePrefix:'learn-phone-processing-runtime-',
 });
 const [after,afterRows]=await Promise.all([catalog(args.token),query(args.token,sourceSql)]);
 return {...result,state:after.fingerprint===PHONE_PROCESSING_SCHEMA&&sources(afterRows)===preserved?result.state:'requires_inspection',phoneProcessingSchema:after.fingerprint,fullPreservedDataSets:sources(afterRows)===preserved?rows.length:null};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.slice(2).join(' ')!=='--deploy --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST Phone deployment required');
  const prefix='.verification-results/phone-processing-runtime-deploy';
  const result=await deployPhoneProcessingRuntime({allowProjectRef:TEST_PROJECT,token:savedCliToken(),persistJournal:async journal=>{
   const fd=openSync(prefix+'-journal.json','wx',0o600);try{writeSync(fd,JSON.stringify(journal,null,2));fsyncSync(fd);}finally{closeSync(fd);}
  },onProgress:r=>console.log(JSON.stringify(r))});
  writeFileSync(prefix+'-result.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result,null,2));
  if(result.state!=='deployed_needs_http_acceptance')process.exitCode=1;
 }catch{console.error('Phone processing deployment unconfirmed; inspect retained journal and TEST inventory before any retry.');process.exitCode=1;}
}
