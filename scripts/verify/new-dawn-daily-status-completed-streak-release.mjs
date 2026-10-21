/** Exact-source, read-only preflight and separately authorised LIVE release. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { savedCliToken } from './learn-test-readiness.mjs';

const project = 'tgbnakbxwcqjeimygroz';
const version = '20261111190000';
const name = 'new_dawn_daily_status_completed_streak';
const sourceSha = '0542ab1e768a735ede4238d3bf270e184019fd1431a5b4958e8d750339045ce6';
const baselineVersion = '20261111160000';
const baselineName = 'new_dawn_daily_status_coverage_home';
const baselineSourceSha = '6615ee9a3846a07fc882cbae5ffda8087a72718fc1ec6809608fa848d965763f';
const baselineFunctionSha = '2215e373d11f125f9df8aedb12068a4174ecdbdfc6edf326d3ee513accf73e4c';
const routine = 'public.new_dawn_daily_status_coverage(uuid,text)';
const sourcePath = new URL(`../../supabase/migrations/${version}_${name}.sql`, import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;

export function exactSource() {
  const source = readFileSync(sourcePath, 'utf8');
  if (sha(source) !== sourceSha || !/\nbegin;\n/i.test(source) ||
    !/\ncommit;\s*$/i.test(source)) throw Error('completed_streak_source_changed');
  const body = source.slice(source.indexOf('\nbegin;') + 8, source.lastIndexOf('\ncommit;'));
  if (/^\s*(begin|commit);\s*$/im.test(body))
    throw Error('completed_streak_nested_transaction');
  return { source, body };
}

async function management(path, query, token = savedCliToken(), fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${token}`,
      ...(query ? { 'Content-Type': 'application/json' } : {}) },
    ...(query ? { body: JSON.stringify({ query }) } : {}),
  });
  if (!response.ok) throw Error(`completed_streak_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 100_000) throw Error('completed_streak_response_too_large');
  return JSON.parse(bytes.toString('utf8'));
}

const catalog = `select current_setting('server_version') server_version,
 (select count(*)::int from supabase_migrations.schema_migrations
  where version::text='${baselineVersion}') baseline_count,
 (select jsonb_build_object('name',name,'source_sha256',
  encode(sha256(convert_to(statements[1],'UTF8')),'hex'))
  from supabase_migrations.schema_migrations
  where version::text='${baselineVersion}') baseline,
 (select count(*)::int from supabase_migrations.schema_migrations
  where version::text='${version}') target_count,
 (select jsonb_build_object('name',name,'source_sha256',
  encode(sha256(convert_to(statements[1],'UTF8')),'hex'))
  from supabase_migrations.schema_migrations
  where version::text='${version}') target,
 to_regprocedure('${routine}') is not null function_present,
 case when to_regprocedure('${routine}') is null then null
  else encode(sha256(convert_to(pg_get_functiondef('${routine}'::regprocedure),'UTF8')),'hex') end function_sha,
 case when to_regprocedure('${routine}') is null then null
  else position('london_today' in pg_get_functiondef('${routine}'::regprocedure))>0 end has_completed_streak_guard,
 (select count(*)::int from public.feature_flags
  where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
   and flag='new_dawn.open_job_page.operator_preview' and value='true'::jsonb)
  operator_flag_on,
 case when to_regprocedure('${routine}') is null then null
  else has_function_privilege('authenticated','${routine}','EXECUTE') end authenticated_execute,
 case when to_regprocedure('${routine}') is null then null
  else has_function_privilege('anon','${routine}','EXECUTE') end anon_execute,
 case when to_regprocedure('${routine}') is null then null
  else has_function_privilege('service_role','${routine}','EXECUTE') end service_execute`;

export async function readStage(token = savedCliToken(), fetcher = fetch) {
  const [info, rows] = await Promise.all([
    management('', null, token, fetcher),
    management('/database/query/read-only', catalog, token, fetcher),
  ]);
  if (info?.id !== project || info.status !== 'ACTIVE_HEALTHY' ||
    !Array.isArray(rows) || rows.length !== 1)
    throw Error('completed_streak_catalog_unconfirmed');
  return rows[0];
}

export function assess(row, installed) {
  if (!row || !String(row.server_version).startsWith('17.') ||
    row.baseline_count !== 1 || row.baseline?.name !== baselineName ||
    row.baseline?.source_sha256 !== baselineSourceSha ||
    row.target_count !== (installed ? 1 : 0) ||
    (installed ? row.target?.name !== name || row.target?.source_sha256 !== sourceSha
      : row.target !== null) ||
    row.function_present !== true || row.operator_flag_on !== 1 ||
    row.authenticated_execute !== true || row.anon_execute !== false ||
    row.service_execute !== false ||
    (installed ? row.function_sha === baselineFunctionSha ||
      row.has_completed_streak_guard !== true
      : row.function_sha !== baselineFunctionSha ||
        row.has_completed_streak_guard !== false))
    throw Error('completed_streak_live_state_changed');
  return { state: installed ? 'completed_streak_installed' : 'ready_exact_completed_streak',
    project, version, sourceSha256: sourceSha, providerRequests: 0 };
}

export function releaseSql() {
  const { source, body } = exactSource();
  return `begin;\nset local lock_timeout='3s';\nset local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $gate$ begin
 if (select count(*) from supabase_migrations.schema_migrations
   where version::text='${baselineVersion}')<>1
  or (select name from supabase_migrations.schema_migrations
   where version::text='${baselineVersion}') is distinct from '${baselineName}'
  or (select encode(sha256(convert_to(statements[1],'UTF8')),'hex')
   from supabase_migrations.schema_migrations
   where version::text='${baselineVersion}') is distinct from '${baselineSourceSha}'
  or exists(select 1 from supabase_migrations.schema_migrations
   where version::text='${version}')
  or to_regprocedure('${routine}') is null
  or encode(sha256(convert_to(pg_get_functiondef('${routine}'::regprocedure),'UTF8')),'hex') is distinct from '${baselineFunctionSha}'
  or has_function_privilege('authenticated','${routine}','EXECUTE') is distinct from true
  or has_function_privilege('anon','${routine}','EXECUTE') is distinct from false
  or has_function_privilege('service_role','${routine}','EXECUTE') is distinct from false
  or not exists(select 1 from public.feature_flags
   where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
    and flag='new_dawn.open_job_page.operator_preview' and value='true'::jsonb)
 then raise exception 'completed_streak_release_state_changed';end if;
end $gate$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${version}','${name}',array[${literal(source)}]);
select 'completed_streak_installed' state;
commit;`;
}

export async function installLive(token = savedCliToken(), fetcher = fetch) {
  exactSource();
  assess(await readStage(token, fetcher), false);
  let acknowledged = false;
  try {
    const rows = await management('/database/query', releaseSql(), token, fetcher);
    acknowledged = Array.isArray(rows) && rows.some(row => row?.state === 'completed_streak_installed');
  } catch { /* Lost acknowledgement: read back and never replay blindly. */ }
  assess(await readStage(token, fetcher), true);
  return { state: 'completed_streak_installed', project, version,
    sourceSha256: sourceSha, acknowledged, providerRequests: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--live-read-only')
      console.log(JSON.stringify(assess(await readStage(), false)));
    else if (args.length === 1 && args[0] === '--live-install-exact' &&
      process.env.NEW_DAWN_COMPLETED_STREAK_PROJECT === project)
      console.log(JSON.stringify(await installLive()));
    else throw Error('completed_streak_exact_scope_required');
  } catch (error) {
    console.error(JSON.stringify({ state: 'completed_streak_release_stopped',
      reason: error instanceof Error ? error.message : 'unknown' }));
    process.exitCode = 1;
  }
}
