/** Fixed TEST-only rollback rehearsal; no source rows or provider operations. */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { checkedRules,RULES_RELEASE_NAME as RELEASE_NAME } from './learn-rules-bundle.mjs';
import { installedFoundation } from './learn-test-foundation-release.mjs';
import { readFoundationCatalog } from './learn-foundation-catalog.mjs';
import { savedCliToken,TEST_PROJECT } from './learn-test-readiness.mjs';
export const SOURCE_SHA256='37d1673acdc896d182b41e6e079475ef69da1d0cfc5c4fbc4017b9546be98562';
export const MARKER='learn-test-rules-rehearsal/1';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function rulesReleaseSql(){
 const b=checkedRules();
 if(b.manifest.sha256!==SOURCE_SHA256)throw Error('Reviewed rules checksum differs');
 if(b.sql.split('\nbegin;\n').length!==2||b.sql.split('\ncommit;\n').length!==2)throw Error('Unexpected transaction framing');
 return b.sql.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';
set local serviceos.release_source_sha256='${SOURCE_SHA256}';
set local lock_timeout='3s';
set local statement_timeout='30s';\n`);
}
export function rulesRehearsalSql(){
 const tables=checkedRules().manifest.tables.map(n=>`'${n}'`).join(',');
 return rulesReleaseSql().replace('\ncommit;\n',`\nrollback;
select '${MARKER}' as rehearsal,
 not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in (${tables})) as tables_absent,
 not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${checkedRules().manifest.functions.map(f=>`'${f}'`).join(',')})) as guard_absent,
 not exists(select 1 from of_test_deploy.migrations where migration_name='${RELEASE_NAME}') as receipt_absent;\n`);
}
export function rulesFingerprint(c){
 // Catalog arrays have stable SQL ordering. Volatile observation timestamps and
 // server version strings are deliberately outside the semantic comparison.
 return hash(JSON.stringify({tables:c.tables,helpers:c.helpers,readinessCatalogSha256:c.readinessCatalogSha256}));
}
export function assertRulesPrerequisites(c){
 if(!installedFoundation(c)||c.readiness.customMigrationEntries.length!==4)throw Error('Installed TEST foundation and helper repair required');
 const b=checkedRules();
 if(c.tables.some(t=>b.manifest.tables.includes(t.name))||c.base.inventory.functions.some(f=>b.manifest.functions.includes(f.name)))throw Error('Rules objects already exist');
 const role=c.base.inventory.functions.find(f=>f.name==='current_user_role');
 if(role?.authenticatedExecute!==false||role?.anonExecute!==false)throw Error('Current role helper privilege differs');
}
export async function rehearseRules({allowProjectRef,token,fetcher=fetch}){
 const args={allowProjectRef,token,fetcher,includeBase:true};
 const before=await readFoundationCatalog(args);assertRulesPrerequisites(before);
 const query=rulesRehearsalSql();
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
 const beforeHash=rulesFingerprint(before),afterHash=after?rulesFingerprint(after):null;
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,
  observedBefore:before.observedAt,observedAfter:after?.observedAt??null,
  state:acknowledged&&beforeHash===afterHash?'rehearsed_and_rolled_back':'rehearsal_not_verified',
  acknowledged,httpStatus,databaseCode,catalogUnchanged:beforeHash===afterHash,
  beforeCatalogSha256:beforeHash,afterCatalogSha256:afterHash,
  limitations:['All new rules objects and the receipt were rolled back; this is not a persistent release.',
   'No customer rows, recorded audio, provider operations, real JWT acceptance or UI behavior were tested.',
   'Before/after comparison covers the recorded definitions, metadata-view privileges and migration receipts; it is not a backup.',
   'An unverified result requires inspection; the write request is never retried automatically.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.slice(2).join(' ')!=='--rehearse --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST rehearsal and existing login required');
  const report=await rehearseRules({allowProjectRef:TEST_PROJECT,token:savedCliToken()});
  console.log(JSON.stringify(report,null,2));if(report.state!=='rehearsed_and_rolled_back')process.exitCode=1;
 }catch(error){console.error(error.message);process.exitCode=1;}
}
