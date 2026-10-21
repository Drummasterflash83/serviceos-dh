/** Exact LIVE reader release; no provider call, identity link or client flag change. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { savedCliToken } from './learn-test-readiness.mjs';

const project = 'tgbnakbxwcqjeimygroz';
const tenant = '00000000-0000-0000-0000-000000000001';
const version = '20261112200000';
const name = 'new_dawn_job_home_identity_counts';
const sourceHash = 'a01378895de849e9f66c954a0686330983524976fc50c7dc2115f437feddb7d5';
const rollbackHash = 'b4037b30621b658eb8cf947c171db75bf92935ef08d4edad256e28a1c42271b3';
const baselineHash = '56446648307af94131589efbaeb2fe10549d0c3ab306d4521d61966a15f698d8';
const signature = 'public.new_dawn_open_job_status_summary(uuid,text)';
const sha = value => createHash('sha256').update(value).digest('hex');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const sourcePath = new URL(`../../supabase/migrations/${version}_${name}.sql`, import.meta.url);
const rollbackPath = new URL('../../supabase/release/new-dawn-job-home-identity-counts/rollback.sql', import.meta.url);

function transactionBody(path, expectedHash) {
  const source = readFileSync(path, 'utf8');
  if (sha(source) !== expectedHash || !/\nbegin;\s*\n/i.test(source) || !/\ncommit;\s*$/i.test(source))
    throw Error('job_home_source_or_rollback_changed');
  const body = source.slice(source.indexOf('\nbegin;') + 8, source.lastIndexOf('\ncommit;'));
  if (/^\s*(begin|commit);\s*$/im.test(body)) throw Error('job_home_nested_transaction');
  return { source, body };
}
const exactSource = () => transactionBody(sourcePath, sourceHash);
const exactRollback = () => transactionBody(rollbackPath, rollbackHash);

async function management(path, query, token = savedCliToken()) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${token}`,
      ...(query ? { 'Content-Type': 'application/json' } : {}) },
    ...(query ? { body: JSON.stringify({ query, read_only: path.endsWith('/read-only') }) } : {}),
  });
  if (!response.ok) throw Error(`job_home_management_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 100_000) throw Error('job_home_management_response_too_large');
  return JSON.parse(bytes.toString('utf8'));
}

const catalog = `select
 (select count(*)::int from supabase_migrations.schema_migrations where version::text='${version}') ledger_count,
 (select name from supabase_migrations.schema_migrations where version::text='${version}') ledger_name,
 (select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version::text='${version}') ledger_hash,
 encode(sha256(convert_to(pg_get_functiondef('${signature}'::regprocedure),'UTF8')),'hex') function_hash,
 has_function_privilege('authenticated','${signature}','EXECUTE') auth_execute,
 has_function_privilege('anon','${signature}','EXECUTE') anon_execute,
 has_function_privilege('service_role','${signature}','EXECUTE') service_execute,
 (select count(*)::int from public.feature_flags where tenant_id='${tenant}'::uuid
  and flag='new_dawn.open_job_page.operator_preview' and value='true'::jsonb) operator_flag_on`;

async function stage() {
  const [info, rows] = await Promise.all([
    management('', null), management('/database/query/read-only', catalog),
  ]);
  if (info?.id !== project || info.status !== 'ACTIVE_HEALTHY' ||
      !Array.isArray(rows) || rows.length !== 1) throw Error('job_home_catalog_unconfirmed');
  return rows[0];
}

function assess(row, installed) {
  if (row.ledger_count !== (installed ? 1 : 0) ||
      row.ledger_name !== (installed ? name : null) ||
      row.ledger_hash !== (installed ? sourceHash : null) ||
      row.function_hash !== (installed ? row.function_hash : baselineHash) ||
      !/^[a-f0-9]{64}$/.test(row.function_hash) ||
      row.auth_execute !== true || row.anon_execute !== false ||
      row.service_execute !== false || row.operator_flag_on !== 1) {
    throw Error('job_home_live_stage_changed');
  }
  return { state: installed ? 'installed' : 'ready', project, version, sourceHash,
    functionHash: row.function_hash, providerRequests: 0, identityLinksChanged: 0 };
}

function releaseSql() {
  const { source, body } = exactSource();
  exactRollback();
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='35s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $gate$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version::text='${version}')
  or encode(sha256(convert_to(pg_get_functiondef('${signature}'::regprocedure),'UTF8')),'hex')<>'${baselineHash}'
  or not exists(select 1 from public.feature_flags where tenant_id='${tenant}'::uuid
   and flag='new_dawn.open_job_page.operator_preview' and value='true'::jsonb)
 then raise exception 'job_home_release_state_changed';end if;
end $gate$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${version}','${name}',array[${literal(source)}]);
select '${version}' installed_version;
commit;`;
}

async function rollbackRehearsal() {
  exactSource(); exactRollback();
  assess(await stage(), false);
  const sql = `begin;
set local lock_timeout='3s';
set local statement_timeout='35s';
${exactSource().body}
do $check$ begin
 if encode(sha256(convert_to(pg_get_functiondef('${signature}'::regprocedure),'UTF8')),'hex')='${baselineHash}'
 then raise exception 'job_home_candidate_not_installed';end if;
end $check$;
${exactRollback().body}
do $check$ begin
 if encode(sha256(convert_to(pg_get_functiondef('${signature}'::regprocedure),'UTF8')),'hex')<>'${baselineHash}'
 then raise exception 'job_home_rollback_not_restored';end if;
end $check$;
rollback;
select 'rollback_rehearsed' state;`;
  const rows = await management('/database/query', sql);
  if (!Array.isArray(rows) || !rows.some(row => row?.state === 'rollback_rehearsed'))
    throw Error('job_home_rehearsal_unconfirmed');
  assess(await stage(), false);
  return { state: 'rollback_rehearsed', project, version, sourceHash, rollbackHash };
}

async function install() {
  exactSource();
  assess(await stage(), false);
  let acknowledged = false;
  try {
    const rows = await management('/database/query', releaseSql());
    acknowledged = Array.isArray(rows) && rows.some(row => row?.installed_version === version);
  } catch { /* Lost acknowledgement is resolved by readback, never blind replay. */ }
  const after = assess(await stage(), true);
  if (after.functionHash === baselineHash) throw Error('job_home_function_not_replaced');
  return { ...after, acknowledged };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--live-read-only')
      console.log(JSON.stringify(assess(await stage(), process.env.NEW_DAWN_JOB_HOME_INSTALLED === '1')));
    else if (args.length === 1 && args[0] === '--live-rollback-rehearsal')
      console.log(JSON.stringify(await rollbackRehearsal()));
    else if (args.length === 3 && args[0] === '--live-install-exact' &&
      args[1] === '--sha' && args[2] === sourceHash &&
      process.env.NEW_DAWN_JOB_HOME_PROJECT === project)
      console.log(JSON.stringify(await install()));
    else throw Error('job_home_exact_scope_required');
  } catch (error) {
    console.error(JSON.stringify({ state: 'stopped', reason: error instanceof Error ? error.message : 'unknown' }));
    process.exitCode = 1;
  }
}
