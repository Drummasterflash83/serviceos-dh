/** Fixed TEST-only rollback rehearsal; no source rows or provider operations. */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { checkedFoundation,RELEASE_NAME } from './learn-foundation-bundle.mjs';
import { readFoundationCatalog } from './learn-foundation-catalog.mjs';
import { savedCliToken,TEST_PROJECT } from './learn-test-readiness.mjs';
export const SOURCE_SHA256='be6f2e94a8691469b82b45dce0c3c2011a68731fc8ae339e4a1ff11dfc3d5233';
export const MARKER='learn-test-foundation-rehearsal/1';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function foundationReleaseSql(){
 const b=checkedFoundation();
 if(b.manifest.sha256!==SOURCE_SHA256)throw Error('Reviewed foundation checksum differs');
 if(b.sql.split('\nbegin;\n').length!==2||b.sql.split('\ncommit;\n').length!==2)throw Error('Unexpected transaction framing');
 return b.sql.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';
set local serviceos.release_source_sha256='${SOURCE_SHA256}';
set local lock_timeout='3s';
set local statement_timeout='30s';\n`);
}
export function foundationRehearsalSql(){
 const tables=checkedFoundation().manifest.tables.map(n=>`'${n}'`).join(',');
 return foundationReleaseSql().replace('\ncommit;\n',`\nrollback;
select '${MARKER}' as rehearsal,
 not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in (${tables})) as tables_absent,
 to_regprocedure('public.learn_foundation_reference_guard()') is null as guard_absent,
 not exists(select 1 from of_test_deploy.migrations where migration_name='${RELEASE_NAME}') as receipt_absent;\n`);
}
export function foundationFingerprint(c){
 // Catalog arrays have stable SQL ordering. Volatile observation timestamps and
 // server version strings are deliberately outside the semantic comparison.
 return hash(JSON.stringify({tables:c.tables,helpers:c.helpers,readinessCatalogSha256:c.readinessCatalogSha256}));
}
export function assertFoundationPrerequisites(c){
 const b=checkedFoundation();
 if(c.projectRef!==TEST_PROJECT||!Array.isArray(c.tables)||!Array.isArray(c.helpers)
  || !/^[a-f0-9]{64}$/.test(c.readinessCatalogSha256??''))throw Error('Incomplete TEST foundation preflight');
 if(c.tables.some(t=>b.manifest.tables.includes(t.name)))throw Error('Foundation table already exists; inspect before rehearsal');
 if(!['tenants','profiles','config_versions','interactions'].every(n=>c.tables.some(t=>t.name===n&&t.owner==='postgres'))
  ||!['current_tenant_id','is_openfolk','set_updated_at'].every(n=>c.helpers.some(f=>f.name===n)))throw Error('Foundation dependencies missing');
 const ledger=c.readiness?.customMigrationEntries;
 if(!Array.isArray(ledger)||ledger.length!==2
  ||!ledger.some(e=>e.migration_name==='openfolk_test_learn_bootstrap_v5'&&e.source_sha256==='821515d9b8034b74826e1a81837c64d1b02804402da223715404d84b307a34d6')
  ||!ledger.some(e=>e.migration_name==='learn_launch_metadata_views_v1'&&e.source_sha256==='5bbff33c4ece496cd6220a9beb1fc0d70cb31e205f2deaa4a10026e4a3e219aa')
  ||ledger.some(e=>e.project_ref!==TEST_PROJECT))throw Error('TEST prerequisite receipts differ');
 if(c.readiness.launchMetadata?.state!=='needs_semantic_and_user_verification')throw Error('Restricted metadata surface differs');
}
export async function rehearseFoundation({allowProjectRef,token,fetcher=fetch}){
 const args={allowProjectRef,token,fetcher};
 const before=await readFoundationCatalog(args);assertFoundationPrerequisites(before);
 const query=foundationRehearsalSql();
 let acknowledged=false,httpStatus=null,databaseCode=null;
 try{
  const response=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{
   method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
   body:JSON.stringify({query,read_only:false}),redirect:'error',signal:AbortSignal.timeout(45000)});
  httpStatus=response.status;
  const chunks=[];let bytes=0;
  for await(const chunk of response.body){bytes+=chunk.byteLength;if(bytes>1048576)throw Error();chunks.push(chunk);}
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!response.ok){
   if(/^[0-9A-Z]{5}$/.test(body?.code??''))databaseCode=body.code;
   else databaseCode=/ERROR:\s*([0-9A-Z]{5}):/.exec(typeof body?.message==='string'?body.message:'')?.[1]??null;
  }else acknowledged=Array.isArray(body)&&body.length===1&&body[0].rehearsal===MARKER
   &&body[0].tables_absent===true&&body[0].guard_absent===true&&body[0].receipt_absent===true;
 }catch{/* Uncertain outcomes are inspected, never retried. */}
 let after=null;try{after=await readFoundationCatalog(args);}catch{/* Report unverified. */}
 const beforeHash=foundationFingerprint(before),afterHash=after?foundationFingerprint(after):null;
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,
  observedBefore:before.observedAt,observedAfter:after?.observedAt??null,
  state:acknowledged&&beforeHash===afterHash?'rehearsed_and_rolled_back':'rehearsal_not_verified',
  acknowledged,httpStatus,databaseCode,catalogUnchanged:beforeHash===afterHash,
  beforeCatalogSha256:beforeHash,afterCatalogSha256:afterHash,
  limitations:['All new foundation objects and the receipt were rolled back; this is not a persistent release.',
   'No customer rows, recorded audio, provider operations, real JWT acceptance or UI behavior were tested.',
   'Before/after comparison covers the recorded definitions, metadata-view privileges and migration receipts; it is not a backup.',
   'An unverified result requires inspection; the write request is never retried automatically.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.slice(2).join(' ')!=='--rehearse --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST rehearsal and existing login required');
  const report=await rehearseFoundation({allowProjectRef:TEST_PROJECT,token:savedCliToken()});
  console.log(JSON.stringify(report,null,2));if(report.state!=='rehearsed_and_rolled_back')process.exitCode=1;
 }catch(error){console.error(error.message);process.exitCode=1;}
}
