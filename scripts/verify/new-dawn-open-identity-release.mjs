/** Exact-source, operator-read-only queue release. Never calls a provider or links a job. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { savedCliToken } from './learn-test-readiness.mjs';

const project = 'tgbnakbxwcqjeimygroz';
const version = '20261111170000';
const name = 'new_dawn_open_identity_priority';
const expectedSha = '6194386a46ea8402d996123cb95665b17a3cf60fd0109fffd6e4a4e28cb27bcd';
const routine = 'public.new_dawn_open_identity_review_page(uuid,uuid,text,text,integer)';
const helper = 'public.new_dawn_commusoft_exact_link_candidate(uuid,uuid,text,uuid)';
const sourcePath = new URL(`../../supabase/migrations/${version}_${name}.sql`, import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;

export function exactSource() {
  const source = readFileSync(sourcePath, 'utf8');
  if (sha(source) !== expectedSha || !/\nbegin;\n/i.test(source) ||
    !/\ncommit;\s*$/i.test(source)) throw Error('open_identity_release_source_changed');
  const body = source.slice(source.indexOf('\nbegin;') + 8, source.lastIndexOf('\ncommit;'));
  if (/^\s*(begin|commit);\s*$/im.test(body)) throw Error('open_identity_release_nested_transaction');
  return { source, body };
}

async function management(path, query, token = savedCliToken(), fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${token}`,
      ...(query ? { 'Content-Type': 'application/json' } : {}) },
    ...(query ? { body: JSON.stringify({ query }) } : {}),
  });
  if (!response.ok) throw Error(`open_identity_release_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 100_000) throw Error('open_identity_release_response_too_large');
  return JSON.parse(bytes.toString('utf8'));
}

const catalog = `select
 (select count(*)::int from supabase_migrations.schema_migrations
  where version::text='${version}') ledger_count,
 (select jsonb_build_object('name',name,'source_sha256',
  encode(sha256(convert_to(statements[1],'UTF8')),'hex'))
  from supabase_migrations.schema_migrations where version::text='${version}') ledger,
 to_regprocedure('${routine}') is not null function_present,
 to_regprocedure('${helper}') is not null helper_present,
 (select count(*)::int from public.feature_flags
  where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
   and flag='new_dawn.m2_link_review_queue' and value='true'::jsonb) review_flag_on,
 (select count(*)::int from public.provider_connections
  where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
   and provider='commusoft' and status='configured' and revoked_at is null) connections,
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
    throw Error('open_identity_release_catalog_unconfirmed');
  return rows[0];
}

export function assess(row, installed) {
  if (!row || row.ledger_count !== (installed ? 1 : 0) ||
    row.function_present !== installed || row.helper_present !== true ||
    row.review_flag_on !== 1 || row.connections !== 1 ||
    (installed && (row.ledger?.name !== name ||
      row.ledger?.source_sha256 !== expectedSha ||
      row.authenticated_execute !== true || row.anon_execute !== false ||
      row.service_execute !== false)) ||
    (!installed && (row.ledger !== null || row.authenticated_execute !== null ||
      row.anon_execute !== null || row.service_execute !== null)))
    throw Error('open_identity_release_live_state_changed');
  return { state: installed ? 'open_identity_rpc_installed' : 'ready_exact_open_identity_rpc',
    project, version, sourceSha256: expectedSha, providerRequests: 0, linkWrites: 0 };
}

export function releaseSql() {
  const { source, body } = exactSource();
  return `begin;\nset local lock_timeout='3s';\nset local statement_timeout='40s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $gate$ begin
 if exists(select 1 from supabase_migrations.schema_migrations
  where version::text='${version}') or to_regprocedure('${routine}') is not null
  or to_regprocedure('${helper}') is null
  or not exists(select 1 from public.feature_flags
   where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
    and flag='new_dawn.m2_link_review_queue' and value='true'::jsonb)
  or (select count(*) from public.provider_connections
   where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
    and provider='commusoft' and status='configured' and revoked_at is null)<>1
 then raise exception 'open_identity_release_state_changed';end if;
end $gate$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${version}','${name}',array[${literal(source)}]);
select 'open_identity_rpc_installed' state;
commit;`;
}

export async function installLive(token = savedCliToken(), fetcher = fetch) {
  exactSource();
  assess(await readStage(token, fetcher), false);
  let acknowledged = false;
  try {
    const rows = await management('/database/query', releaseSql(), token, fetcher);
    acknowledged = Array.isArray(rows) && rows.some(row => row?.state === 'open_identity_rpc_installed');
  } catch { /* Unknown acknowledgement: read back, never replay blindly. */ }
  assess(await readStage(token, fetcher), true);
  return { state: 'open_identity_rpc_installed', project, version,
    sourceSha256: expectedSha, acknowledged, providerRequests: 0, linkWrites: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--live-read-only')
      console.log(JSON.stringify(assess(await readStage(), false)));
    else if (args.length === 1 && args[0] === '--live-install-exact' &&
      process.env.NEW_DAWN_OPEN_IDENTITY_PROJECT === project)
      console.log(JSON.stringify(await installLive()));
    else throw Error('open_identity_release_exact_scope_required');
  } catch (error) {
    console.error(JSON.stringify({ state: 'open_identity_release_stopped',
      reason: error instanceof Error ? error.message : 'unknown' }));
    process.exitCode = 1;
  }
}
