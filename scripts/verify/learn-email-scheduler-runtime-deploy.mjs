/** Install the reviewed scheduler runtime in TEST only; never sets keys or cron. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { edgeRuntimeBundle } from './learn-email-runtime-edge-bundle.mjs';
import { deployPinnedTestRuntime } from './learn-test-email-runtime-deploy.mjs';
import { readPhoneSavedResultsCatalog, phoneSavedResultsSourceQuery } from './learn-phone-saved-results-catalog.mjs';
import { communicationQuery } from './learn-card-communication-catalog.mjs';
import { TEST_PROJECT, savedCliToken } from './learn-test-readiness.mjs';
export const SCHEDULER_ENDPOINTS = ['email-scheduled-sync','email-workspace-scheduled-sync','email-workspace-backfill-scheduled-sync'].map(name=>({name,verifyJwt:false}));
export const SCHEDULER_SHA = '54f15596434f8aefac4f9314eae5ca8869213195b73b169f094d2dffd39d2eca';
export const SCHEDULER_RUNTIME_SCHEMA = '5f4ec0d83f684decfed7a64442dc107a';
export const SCHEDULER_FULL_SCHEMA = 'ebeeafeb978b7119d25b694fd210e71c';
export const schedulerBundle = () => edgeRuntimeBundle(SCHEDULER_ENDPOINTS);
const stable = rows => JSON.stringify([...rows].sort((a,b)=>a.name.localeCompare(b.name)));
export async function deployEmailSchedulers(args, {catalog=readPhoneSavedResultsCatalog,query=communicationQuery,deploy=deployPinnedTestRuntime}={}) {
  if(args.allowProjectRef!==TEST_PROJECT || Object.keys(args.replaceVersions??{}).length) throw Error('New TEST scheduler endpoints only');
  if(schedulerBundle().sha256!==SCHEDULER_SHA) throw Error('Scheduler source differs');
  const before=await catalog(args.token);
  if(before.fingerprint!==SCHEDULER_FULL_SCHEMA) throw Error('TEST release 060 required');
  const snapshot=phoneSavedResultsSourceQuery(before.catalog.phone), rows=await query(args.token,snapshot);
  if(rows.length!==113 || new Set(rows.map(r=>r.name)).size!==113) throw Error('Full preservation baseline required');
  const result=await deploy({...args,persistJournal:journal=>args.persistJournal({...journal,fullSchema:before.fingerprint,fullPreserved:rows})},{
    bundle:schedulerBundle,endpoints:SCHEDULER_ENDPOINTS,bundleSha:SCHEDULER_SHA,databaseFingerprint:SCHEDULER_RUNTIME_SCHEMA,
    version:'learn-email-scheduler-runtime/1',stagePrefix:'learn-email-scheduler-runtime-',
  });
  const [after,afterRows]=await Promise.all([catalog(args.token),query(args.token,snapshot)]);
  const preserved=after.fingerprint===before.fingerprint && stable(rows)===stable(afterRows);
  return {...result,state:preserved?result.state:'requires_inspection',fullPreservedDatasets:preserved?113:null,fullSchemaUnchanged:after.fingerprint===before.fingerprint,secretsCreated:0,schedulesActivated:0,providerRequests:0,productionChanged:false};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.slice(2).join(' ')!=='--deploy --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT) throw Error('Explicit TEST deployment required');
    const prefix='.verification-results/email-scheduler-runtime-deploy';
    const result=await deployEmailSchedulers({allowProjectRef:TEST_PROJECT,token:savedCliToken(),persistJournal:async journal=>{
      const fd=openSync(prefix+'-journal.json','wx',0o600);try{writeSync(fd,JSON.stringify(journal,null,2));fsyncSync(fd);}finally{closeSync(fd);}
    },onProgress:r=>console.log(JSON.stringify(r))});
    writeFileSync(prefix+'-result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result,null,2));
    if(result.state!=='deployed_needs_http_acceptance')process.exitCode=1;
  }catch(e){console.error('Scheduler deployment unconfirmed; inspect journal and inventory before retry: '+e.message);process.exitCode=1;}
}
