/** TEST-only transactional DDL rehearsal. Never commits or changes customer rows.
 * Requires explicit --rehearse and TEST allowlist; reuses the existing CLI login.
 * Fixed reviewed SQL is pinned by SHA-256. Not a generic SQL execution tool.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readTestCatalog, savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

export const SOURCE_SHA256 = '5bbff33c4ece496cd6220a9beb1fc0d70cb31e205f2deaa4a10026e4a3e219aa';
const SOURCE = new URL('../../supabase/release/learn-test/001_launch_metadata_views.sql', import.meta.url);
const MARKER = 'learn-test-launch-rehearsal/1';
const hash = value => createHash('sha256').update(value).digest('hex');
export const RELEASE_NAME='learn_launch_metadata_views_v1';
export function releaseSql(source = readFileSync(SOURCE, 'utf8')) {
  if (hash(source) !== SOURCE_SHA256) throw Error('Reviewed rehearsal SQL checksum differs');
  if (source.split('\nbegin;\n').length !== 2 || source.split('\ncommit;\n').length !== 2)
    throw Error('Unexpected release transaction framing');
  return source.replace('\nbegin;\n', `\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';
set local serviceos.release_source_sha256='${SOURCE_SHA256}';
set local lock_timeout='3s';
set local statement_timeout='30s';\n`);
}
export function rehearsalSql(source = readFileSync(SOURCE, 'utf8')) {
  return releaseSql(source).replace('\ncommit;\n', `
rollback;
select '${MARKER}' as rehearsal,
 not exists(select 1 from pg_catalog.pg_roles where rolname='learn_launch_metadata_reader') as reader_absent,
 not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname like 'learn_launch_%') as views_absent,
 not exists(select 1 from of_test_deploy.migrations where migration_name='${RELEASE_NAME}') as receipt_absent;
`);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
export function catalogFingerprint(result) {
  return hash(JSON.stringify(canonical({tables:result.inventory.tables,functions:result.inventory.functions,
    launchMetadata:result.inventory.launchMetadata,edgeFunctions:result.functions,
    ledger:result.report.customMigrationEntries})));
}
export async function rehearseLaunch({allowProjectRef,token,fetcher=fetch}) {
  // readTestCatalog validates the exact target, organization, health and login
  // before any database write request can be constructed.
  const before = await readTestCatalog({allowProjectRef,token,fetcher});
  const m=before.report.launchMetadata;
  if (m.state!=='blocked' || !m.roleIssues.includes('missing_reader_role')
    || !m.views.every(v=>v.issues.includes('missing_view')) || m.unexpectedRelations.length)
    throw Error('Rehearsal requires the verified not-yet-installed TEST read surface');
  const ledger=before.report.customMigrationEntries;
  if (!Array.isArray(ledger) || ledger.length!==1
    || ledger[0].migration_name!=='openfolk_test_learn_bootstrap_v5'
    || ledger[0].source_sha256!=='821515d9b8034b74826e1a81837c64d1b02804402da223715404d84b307a34d6')
    throw Error('TEST bootstrap ledger differs; inspect before rehearsal');
  const query=rehearsalSql();
  let acknowledged=false, httpStatus=null, databaseCode=null;
  try {
    const response=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{
      method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({query,read_only:false}),redirect:'error',signal:AbortSignal.timeout(45000),
    });
    httpStatus=response.status;
    let bytes=0;const chunks=[];
    for await(const chunk of response.body){bytes+=chunk.byteLength;if(bytes>1024*1024)throw Error();chunks.push(chunk);}
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!response.ok) {
      // Only retain a PostgreSQL error code, never response text or query data.
      if (/^[0-9A-Z]{5}$/.test(body?.code??'')) databaseCode=body.code;
      else databaseCode=/ERROR:\s*([0-9A-Z]{5}):/.exec(typeof body?.message==='string'?body.message:'')?.[1]??null;
    } else acknowledged=Array.isArray(body)&&body.length===1&&body[0].rehearsal===MARKER
      &&body[0].reader_absent===true&&body[0].views_absent===true&&body[0].receipt_absent===true;
  } catch { /* Unknown outcomes are inspected, never automatically retried. */ }
  let after=null;
  try {after=await readTestCatalog({allowProjectRef,token,fetcher});}catch { /* Report unverified state. */ }
  const beforeHash=catalogFingerprint(before),afterHash=after?catalogFingerprint(after):null;
  const unchanged=afterHash===beforeHash;
  return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,
    observedBefore:before.inventory.observedAt,observedAfter:after?.inventory.observedAt??null,
    state:acknowledged&&unchanged?'rehearsed_and_rolled_back':'rehearsal_not_verified',
    acknowledged,httpStatus,databaseCode,catalogUnchanged:unchanged,
    beforeCatalogSha256:beforeHash,afterCatalogSha256:afterHash,
    limitations:['No persistent release, real JWT/PostgREST test, function deployment or provider operation occurred.',
      'Catalog comparison covers the audited schema/privileges/ledger; source record contents are not read or backed up.',
      'An unverified result requires inspection; the write request is never retried automatically.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const args=process.argv.slice(2);
    if(args.length!==2||!args.includes('--rehearse')||!args.includes('--existing-cli-login')
      ||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST rehearsal and existing login required');
    const report=await rehearseLaunch({allowProjectRef:TEST_PROJECT,token:savedCliToken()});
    console.log(JSON.stringify(report,null,2));
    if(report.state!=='rehearsed_and_rolled_back')process.exitCode=1;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
