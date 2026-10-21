/** Exact-source release for saved Commusoft work descriptions on MD Home. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { savedCliToken } from './learn-test-readiness.mjs';

const project = 'tgbnakbxwcqjeimygroz';
const version = '20261113020000';
const name = 'new_dawn_customer_work_descriptions';
const sourceHash = '6af7397766541cea5c8c6e5f9e704d5f70344beb00c23272aeb8c11985d7dcd8';
const priorHash = 'a2f5916d204014e3affced8136308a74e67d6c0d42ea7856cdf27d7276f813c0';
const candidateHash = '99c5e202c99aec449c20cc89b4f87923a97fef79dbd8804e9c9e0fa2fae16eea';
const stage1 = 'd1a2c9e754b285d6a8360427d5e75db1d7359a969871b53fb09365981e1ef46c';
const stage2 = '2c19c89b0c24cd896655702c1095614400db7d36c4ca14be10a437815ae7fa49';
const signature = 'public.new_dawn_customer_blockers(uuid,text)';
const sourcePath = new URL(`../../supabase/migrations/${version}_${name}.sql`, import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const literal = value => `'${value.replaceAll("'", "''")}'`;

export function exactSource() {
  const source = readFileSync(sourcePath, 'utf8');
  if (sha(source) !== sourceHash || !/\nbegin;\s*\n/i.test(source) ||
      !/\ncommit;\s*$/i.test(source)) throw Error('work_descriptions_source_changed');
  const body = source.slice(source.indexOf('\nbegin;') + 8, source.lastIndexOf('\ncommit;'));
  if (/^\s*(?:begin|commit);\s*$/im.test(body)) throw Error('work_descriptions_nested_transaction');
  return { source, body };
}

async function management(path, query, token = savedCliToken(), fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${token}`,
      ...(query ? { 'Content-Type': 'application/json' } : {}) },
    ...(query ? { body: JSON.stringify({ query }) } : {}),
  });
  if (!response.ok) throw Error(`work_descriptions_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 100_000) throw Error('work_descriptions_response_too_large');
  return JSON.parse(bytes.toString('utf8'));
}

const catalog = `select
 (select count(*)::int from supabase_migrations.schema_migrations where version::text='20261113000000') stage_1_count,
 (select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version::text='20261113000000') stage_1_hash,
 (select count(*)::int from supabase_migrations.schema_migrations where version::text='20261113010000') stage_2_count,
 (select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version::text='20261113010000') stage_2_hash,
 (select count(*)::int from supabase_migrations.schema_migrations where version::text='${version}') ledger_count,
 (select name from supabase_migrations.schema_migrations where version::text='${version}') ledger_name,
 (select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version::text='${version}') ledger_hash,
 to_regclass('public.new_dawn_commusoft_current_job_source') is not null cache_present,
 exists(select 1 from pg_trigger where tgname='new_dawn_commusoft_current_job_source_observe'
  and tgrelid='public.learn_business_input_observations'::regclass and not tgisinternal) trigger_present,
 encode(sha256(convert_to(pg_get_functiondef('${signature}'::regprocedure),'UTF8')),'hex') function_hash,
 has_function_privilege('authenticated','${signature}','EXECUTE') auth_execute,
 has_function_privilege('anon','${signature}','EXECUTE') anon_execute,
 has_function_privilege('service_role','${signature}','EXECUTE') service_execute`;

export function assess(row) {
  if (!row || row.stage_1_count !== 1 || row.stage_1_hash !== stage1 ||
      row.stage_2_count !== 1 || row.stage_2_hash !== stage2 ||
      row.cache_present !== true || row.trigger_present !== true ||
      row.auth_execute !== true || row.anon_execute !== false ||
      row.service_execute !== false) throw Error('work_descriptions_dependency_changed');
  if (row.ledger_count === 0 && row.ledger_name === null && row.ledger_hash === null &&
      row.function_hash === priorHash)
    return { state: 'ready_exact', project, version, sourceHash, functionHash: priorHash };
  if (row.ledger_count === 1 && row.ledger_name === name && row.ledger_hash === sourceHash &&
      row.function_hash === candidateHash)
    return { state: 'installed', project, version, sourceHash, functionHash: candidateHash };
  throw Error('work_descriptions_stage_changed');
}

export async function readStage(token = savedCliToken(), fetcher = fetch) {
  const [info, rows] = await Promise.all([
    management('', null, token, fetcher),
    management('/database/query/read-only', catalog, token, fetcher),
  ]);
  if (info?.id !== project || info.status !== 'ACTIVE_HEALTHY' ||
      !Array.isArray(rows) || rows.length !== 1) throw Error('work_descriptions_catalog_unconfirmed');
  return assess(rows[0]);
}

export function releaseSql() {
  const { source, body } = exactSource();
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='35s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $gate$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version::text='${version}')
  or encode(sha256(convert_to(pg_get_functiondef('${signature}'::regprocedure),'UTF8')),'hex')<>'${priorHash}'
  or not exists(select 1 from supabase_migrations.schema_migrations where version::text='20261113000000'
   and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${stage1}')
  or not exists(select 1 from supabase_migrations.schema_migrations where version::text='20261113010000'
   and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${stage2}')
  or to_regclass('public.new_dawn_commusoft_current_job_source') is null
  or not exists(select 1 from pg_trigger where tgname='new_dawn_commusoft_current_job_source_observe'
   and tgrelid='public.learn_business_input_observations'::regclass and not tgisinternal)
  or not has_function_privilege('authenticated','${signature}','EXECUTE')
  or has_function_privilege('anon','${signature}','EXECUTE')
  or has_function_privilege('service_role','${signature}','EXECUTE')
 then raise exception 'work_descriptions_release_state_changed'; end if;
end $gate$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${version}','${name}',array[${literal(source)}]);
select '${version}' installed_version;
commit;`;
}

export async function installLive(token = savedCliToken(), fetcher = fetch) {
  if ((await readStage(token, fetcher)).state !== 'ready_exact')
    throw Error('work_descriptions_already_installed');
  try { await management('/database/query', releaseSql(), token, fetcher); }
  catch { /* Resolve uncertain acknowledgement by readback; never replay. */ }
  const result = await readStage(token, fetcher);
  if (result.state !== 'installed') throw Error('work_descriptions_install_unconfirmed');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--live-read-only')
      console.log(JSON.stringify(await readStage()));
    else if (args.length === 3 && args[0] === '--live-install-exact' && args[1] === '--sha' &&
        args[2] === sourceHash && process.env.NEW_DAWN_WORK_DESCRIPTIONS_PROJECT === project)
      console.log(JSON.stringify(await installLive()));
    else throw Error('work_descriptions_exact_scope_required');
  } catch (error) {
    console.error(JSON.stringify({ state: 'stopped',
      reason: error instanceof Error ? error.message : 'unknown' }));
    process.exitCode = 1;
  }
}
