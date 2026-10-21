/** Exact-source LIVE schema release. Does not request a provider or mutate source rows. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { savedCliToken } from './learn-test-readiness.mjs';

const project = 'tgbnakbxwcqjeimygroz';
const version = '20261111180000';
const name = 'new_dawn_learn_source_totals_reliability';
const expectedSha = 'ce75d19dc06fac899ae5581a7dad4031a003b306fa3c29fb36f278c6264d005e';
const routine = 'public.new_dawn_learn_daily_stats_part(uuid,text,text)';
const sourcePath = new URL(`../../supabase/migrations/${version}_${name}.sql`, import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;

export function exactSource() {
  const source = readFileSync(sourcePath, 'utf8');
  if (sha(source) !== expectedSha || !/\nbegin;\n/i.test(source) ||
    !/\ncommit;\s*$/i.test(source)) throw Error('learn_source_totals_source_changed');
  const body = source.slice(source.indexOf('\nbegin;') + 8, source.lastIndexOf('\ncommit;'));
  if (/^\s*(begin|commit);\s*$/im.test(body)) throw Error('learn_source_totals_nested_transaction');
  return { source, body };
}

async function management(path, query, token = savedCliToken(), fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${token}`,
      ...(query ? { 'Content-Type': 'application/json' } : {}) },
    ...(query ? { body: JSON.stringify({ query }) } : {}),
  });
  if (!response.ok) throw Error(`learn_source_totals_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 100_000) throw Error('learn_source_totals_response_too_large');
  return JSON.parse(bytes.toString('utf8'));
}

const catalog = `select
 (select count(*)::int from supabase_migrations.schema_migrations
  where version::text='${version}') ledger_count,
 (select jsonb_build_object('name',name,'source_sha256',
  encode(sha256(convert_to(statements[1],'UTF8')),'hex'))
  from supabase_migrations.schema_migrations where version::text='${version}') ledger,
 to_regprocedure('${routine}') is not null function_present,
 (select p.prosecdef from pg_proc p where p.oid=to_regprocedure('${routine}')) security_definer,
 (select p.proconfig @> array['statement_timeout=20s']::text[]
  from pg_proc p where p.oid=to_regprocedure('${routine}')) timeout_20s,
 (select count(*)::int from public.feature_flags
  where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
   and flag='new_dawn.learn_daily_stats.operator_preview' and value='true'::jsonb) operator_flag_on,
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
    throw Error('learn_source_totals_catalog_unconfirmed');
  return rows[0];
}

export function assess(row, installed) {
  if (!row || row.ledger_count !== (installed ? 1 : 0) ||
    row.function_present !== true || row.security_definer !== true ||
    row.operator_flag_on !== 1 || row.authenticated_execute !== true ||
    row.anon_execute !== false || row.service_execute !== false ||
    (installed && (row.ledger?.name !== name ||
      row.ledger?.source_sha256 !== expectedSha || row.timeout_20s !== true)) ||
    (!installed && (row.ledger !== null || row.timeout_20s === true)))
    throw Error('learn_source_totals_live_state_changed');
  return { state: installed ? 'learn_source_totals_installed' : 'ready_exact_learn_source_totals',
    project, version, sourceSha256: expectedSha, providerRequests: 0, sourceWrites: 0 };
}

export function releaseSql() {
  const { source, body } = exactSource();
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='40s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $gate$ begin
 if exists(select 1 from supabase_migrations.schema_migrations
  where version::text='${version}') or to_regprocedure('${routine}') is null
  or (select p.proconfig @> array['statement_timeout=20s']::text[]
      from pg_proc p where p.oid=to_regprocedure('${routine}')) is true
  or not exists(select 1 from public.feature_flags
   where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
    and flag='new_dawn.learn_daily_stats.operator_preview' and value='true'::jsonb)
 then raise exception 'learn_source_totals_release_state_changed';end if;
end $gate$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${version}','${name}',array[${literal(source)}]);
select 'learn_source_totals_installed' state;
commit;`;
}

export async function installLive(token = savedCliToken(), fetcher = fetch) {
  exactSource();
  assess(await readStage(token, fetcher), false);
  let acknowledged = false;
  try {
    const rows = await management('/database/query', releaseSql(), token, fetcher);
    acknowledged = Array.isArray(rows) &&
      rows.some(row => row?.state === 'learn_source_totals_installed');
  } catch { /* A lost acknowledgement is resolved by readback; never replay blindly. */ }
  assess(await readStage(token, fetcher), true);
  return { state: 'learn_source_totals_installed', project, version,
    sourceSha256: expectedSha, acknowledged, providerRequests: 0, sourceWrites: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--live-read-only')
      console.log(JSON.stringify(assess(await readStage(), false)));
    else if (args.length === 1 && args[0] === '--live-install-exact' &&
      process.env.NEW_DAWN_LEARN_SOURCE_TOTALS_PROJECT === project)
      console.log(JSON.stringify(await installLive()));
    else throw Error('learn_source_totals_exact_scope_required');
  } catch (error) {
    console.error(JSON.stringify({ state: 'learn_source_totals_release_stopped',
      reason: error instanceof Error ? error.message : 'unknown' }));
    process.exitCode = 1;
  }
}
