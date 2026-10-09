/** Fixed TEST rollback rehearsal for measurement/review tables. */
import {pathToFileURL} from 'node:url';
import {checkedMeasurements,MEASUREMENTS_RELEASE_NAME as NAME} from './learn-measurements-bundle.mjs';
import {readMeasurementsCatalog} from './learn-measurements-catalog.mjs';
import {installedConflictRepair,conflictFingerprint} from './learn-test-scorecard-conflicts.mjs';
import {digest} from './learn-test-foundation-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const SOURCE_SHA256='8a1b32fd0a1896946a7a6f79dd3598eabfec237ca418a4fab6d3b7ee155a15e8';
export const MARKER='learn-test-measurements-rehearsal/1';
export const measurementFingerprint=c=>digest({prior:conflictFingerprint(c),measurementFunctions:c.measurementFunctions});
export function assertMeasurementPrerequisites(c){
 if(!installedConflictRepair(c))throw Error('Exact installed TEST rules and conflict repair required');
 const b=checkedMeasurements();
 if(c.tables.some(t=>b.manifest.tables.includes(t.name))||c.measurementFunctions.length||c.base.inventory.functions.some(f=>b.manifest.functions.includes(f.name)))throw Error('Measurement objects already exist');
}
export function measurementReleaseSql(){const b=checkedMeasurements();if(b.manifest.sha256!==SOURCE_SHA256)throw Error('Reviewed measurement checksum differs');if(b.sql.split('\nbegin;\n').length!==2||b.sql.split('\ncommit;\n').length!==2)throw Error('Unexpected measurement framing');return b.sql.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${SOURCE_SHA256}';\n`);}
export function measurementRehearsalSql(){return measurementReleaseSql().replace('\ncommit;\n',`\nrollback;\nselect '${MARKER}' as rehearsal,not exists(select 1 from of_test_deploy.migrations where migration_name='${NAME}') as receipt_absent;\n`);}
export async function rehearseMeasurements({allowProjectRef,token,fetcher=fetch}){
 const args={allowProjectRef,token,fetcher},before=await readMeasurementsCatalog(args);assertMeasurementPrerequisites(before);
 let acknowledged=false,httpStatus=null,databaseCode=null;
 try{
  const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:measurementRehearsalSql(),read_only:false}),redirect:'error',signal:AbortSignal.timeout(45000)});
  httpStatus=r.status;const chunks=[];let bytes=0;for await(const chunk of r.body??[]){bytes+=chunk.byteLength;if(bytes>1048576)throw Error();chunks.push(chunk);}
  const data=JSON.parse(Buffer.concat(chunks).toString());
  if(!r.ok)databaseCode=/ERROR:\s*([0-9A-Z]{5}):/.exec(typeof data?.message==='string'?data.message:'')?.[1]??null;
  else acknowledged=Array.isArray(data)&&data.length===1&&data[0].rehearsal===MARKER&&data[0].receipt_absent===true;
 }catch{/* No replay of an uncertain operation. */}
 let after=null;try{after=await readMeasurementsCatalog(args);}catch{}
 const beforeHash=measurementFingerprint(before),afterHash=after?measurementFingerprint(after):null,unchanged=beforeHash===afterHash;
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:acknowledged&&unchanged?'rehearsed_and_rolled_back':'requires_inspection',observedBefore:before.observedAt,observedAfter:after?.observedAt??null,acknowledged,httpStatus,databaseCode,catalogUnchanged:unchanged,beforeCatalogSha256:beforeHash,afterCatalogSha256:afterHash,
 limitations:['TEST rollback rehearsal only. No installation, source rows, membership baselines or provider operations.', 'Catalog and isolated SQL tests do not replace real signed-in user acceptance.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.slice(2).join(' ')!=='--rehearse --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST rehearsal and existing login required');const r=await rehearseMeasurements({allowProjectRef:TEST_PROJECT,token:savedCliToken()});console.log(JSON.stringify(r,null,2));if(r.state!=='rehearsed_and_rolled_back')process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
