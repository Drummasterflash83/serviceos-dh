/** Exact-source, one-shot release for the existing audited open-job reader. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { savedCliToken } from './learn-test-readiness.mjs';

const project = 'tgbnakbxwcqjeimygroz';
const version = '20261112230000';
const name = 'new_dawn_open_job_status_filter';
const sourceSha = 'beb0616c16646124cf34ca5d2ccf0eba827361c5659c9bc5ed72f3aa8f647205';
const baselineSha = '6c60217cc018c32a334a26b8851631ac4a56e19b272b5a7dba4ee3b6182a743e';
const candidateSha = '408a51b873f52f48ee5acad60d932b8d2c7ee4d1ba20fb0c8e698a6cb26307f8';
const routine = 'public.new_dawn_open_job_page_base(uuid,text,text,text,integer)';
const sourcePath = new URL(`../../supabase/migrations/${version}_${name}.sql`, import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;

export function exactSource() {
  const source = readFileSync(sourcePath, 'utf8');
  if (hash(source) !== sourceSha || !/\nbegin;\n/i.test(source) ||
      !/\ncommit;\s*$/i.test(source)) throw Error('open_job_filter_source_changed');
  const body = source.slice(source.indexOf('\nbegin;') + 8, source.lastIndexOf('\ncommit;'));
  if (/^\s*(begin|commit);\s*$/im.test(body)) throw Error('open_job_filter_nested_transaction');
  return { source, body };
}

async function management(path, query, token = savedCliToken(), fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${token}`,
      ...(query ? { 'Content-Type': 'application/json' } : {}) },
    ...(query ? { body: JSON.stringify({ query }) } : {}),
  });
  if (!response.ok) throw Error(`open_job_filter_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 100_000) throw Error('open_job_filter_response_too_large');
  return JSON.parse(bytes.toString('utf8'));
}

const catalog = `select
 (select count(*)::int from supabase_migrations.schema_migrations
  where version::text='${version}') ledger_count,
 (select jsonb_build_object('name',name,'source_sha256',
  encode(sha256(convert_to(statements[1],'UTF8')),'hex'))
  from supabase_migrations.schema_migrations where version::text='${version}') ledger,
 encode(sha256(convert_to(pg_get_functiondef('${routine}'::regprocedure),'UTF8')),'hex') function_sha,
 has_function_privilege('authenticated','${routine}','EXECUTE') authenticated_execute,
 has_function_privilege('anon','${routine}','EXECUTE') anon_execute,
 has_function_privilege('service_role','${routine}','EXECUTE') service_execute`;

export async function readStage(token = savedCliToken(), fetcher = fetch) {
  const [info, rows] = await Promise.all([
    management('', null, token, fetcher),
    management('/database/query/read-only', catalog, token, fetcher),
  ]);
  if (info?.id !== project || info.status !== 'ACTIVE_HEALTHY' ||
      !Array.isArray(rows) || rows.length !== 1)
    throw Error('open_job_filter_catalog_unconfirmed');
  return rows[0];
}

export function assess(row, installed) {
  if (!row || row.ledger_count !== (installed ? 1 : 0) ||
      row.function_sha !== (installed ? candidateSha : baselineSha) ||
      row.authenticated_execute !== false || row.anon_execute !== false ||
      row.service_execute !== false ||
      (installed && (row.ledger?.name !== name || row.ledger?.source_sha256 !== sourceSha)) ||
      (!installed && row.ledger !== null))
    throw Error('open_job_filter_live_state_changed');
  return { state: installed ? 'installed' : 'ready_exact_open_job_filter',
    project, version, sourceSha256: sourceSha, functionSha256: row.function_sha,
    providerRequests: 0, sourceWrites: 0 };
}

export function releaseSql() {
  const { source, body } = exactSource();
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='40s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $gate$ begin
 if exists(select 1 from supabase_migrations.schema_migrations
  where version::text='${version}')
  or encode(sha256(convert_to(pg_get_functiondef('${routine}'::regprocedure),'UTF8')),'hex') <> '${baselineSha}'
  or has_function_privilege('authenticated','${routine}','EXECUTE')
  or has_function_privilege('anon','${routine}','EXECUTE')
  or has_function_privilege('service_role','${routine}','EXECUTE')
 then raise exception 'open_job_filter_release_state_changed'; end if;
end $gate$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${version}','${name}',array[${literal(source)}]);
select 'open_job_filter_installed' state;
commit;`;
}

export async function installLive(token = savedCliToken(), fetcher = fetch) {
  exactSource();
  assess(await readStage(token, fetcher), false);
  let acknowledged = false;
  try {
    const rows = await management('/database/query', releaseSql(), token, fetcher);
    acknowledged = Array.isArray(rows) &&
      rows.some(row => row?.state === 'open_job_filter_installed');
  } catch { /* Resolve a lost acknowledgement by readback; never replay blindly. */ }
  assess(await readStage(token, fetcher), true);
  return { state: 'open_job_filter_installed', project, version,
    sourceSha256: sourceSha, acknowledged, providerRequests: 0, sourceWrites: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--live-read-only')
      console.log(JSON.stringify(assess(await readStage(), false)));
    else if (args.length === 1 && args[0] === '--live-installed-read-only')
      console.log(JSON.stringify(assess(await readStage(), true)));
    else if (args.length === 1 && args[0] === '--live-install-exact' &&
      process.env.NEW_DAWN_OPEN_JOB_FILTER_PROJECT === project)
      console.log(JSON.stringify(await installLive()));
    else throw Error('open_job_filter_exact_scope_required');
  } catch (error) {
    console.error(JSON.stringify({ state: 'open_job_filter_release_stopped',
      reason: error instanceof Error ? error.message : 'unknown' }));
    process.exitCode = 1;
  }
}
