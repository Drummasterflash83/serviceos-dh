/** One exact LIVE migration for bounded customer-card graph counts. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { savedCliToken } from './learn-test-readiness.mjs';

const project = 'tgbnakbxwcqjeimygroz';
const version = '20261112190000';
const name = 'new_dawn_card_graph_degree_counts';
const expectedSha = '8176fecdf713f208aeee691fdbb778b11981fd079ead07997e6001d7c5b124f0';
const signature = 'public.learn_customer_card_relationship_counts(uuid,uuid[])';
const quote = value => `'${value.replaceAll("'", "''")}'`;
const sha = value => createHash('sha256').update(value).digest('hex');

export function source() {
  const sql = readFileSync(new URL(`../../supabase/migrations/${version}_${name}.sql`, import.meta.url), 'utf8');
  if (sha(sql) !== expectedSha || !/^--[^\n]*\n--[^\n]*\nbegin;\n/i.test(sql) ||
    !/\ncommit;\s*$/i.test(sql) || /^\s*(?:begin|commit);\s*$/im.test(sql.slice(sql.indexOf('begin;') + 6, sql.lastIndexOf('commit;'))))
    throw Error('card_graph_source_changed');
  return sql;
}

const catalog = `select
 to_regprocedure('${signature}') is not null rpc_present,
 (select count(*)::int from supabase_migrations.schema_migrations where version::text='${version}') ledger_count,
 (select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version::text='${version}') ledger_sha,
 (select count(*)::int from pg_indexes where schemaname='public' and tablename='graph_edges' and indexname in ('graph_edges_tenant_from_idx','graph_edges_tenant_to_idx')) endpoint_indexes,
 (select coalesce(has_function_privilege('service_role','${signature}','EXECUTE'),false) from pg_proc where oid=to_regprocedure('${signature}')) service_execute,
 (select coalesce(has_function_privilege('anon','${signature}','EXECUTE'),false) from pg_proc where oid=to_regprocedure('${signature}')) anon_execute,
 (select coalesce(has_function_privilege('authenticated','${signature}','EXECUTE'),false) from pg_proc where oid=to_regprocedure('${signature}')) authenticated_execute`;

async function management(query, token, readOnly, fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? '/read-only' : ''}`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw Error(`card_graph_${readOnly ? 'read' : 'write'}_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 20000) throw Error('card_graph_management_response_too_large');
  return JSON.parse(bytes.toString('utf8'));
}

export function assess(rows) {
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (!row || row.endpoint_indexes !== 2 || !Number.isInteger(row.ledger_count))
    throw Error('card_graph_live_state_unconfirmed');
  if (row.ledger_count === 0 && row.rpc_present === false)
    return { state: 'absent', project, version, sourceSha256: expectedSha };
  if (row.ledger_count === 1 && row.rpc_present === true && row.ledger_sha === expectedSha &&
    row.service_execute === true && row.anon_execute === false && row.authenticated_execute === false)
    return { state: 'installed', project, version, sourceSha256: expectedSha };
  throw Error('card_graph_partial_or_changed_state');
}

export function releaseSql() {
  const sql = source();
  const body = sql.slice(sql.indexOf('begin;') + 6, sql.lastIndexOf('commit;'));
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $gate$ begin
 if to_regprocedure('${signature}') is not null
 or exists(select 1 from supabase_migrations.schema_migrations where version::text='${version}')
 or (select count(*) from pg_indexes where schemaname='public' and tablename='graph_edges'
     and indexname in ('graph_edges_tenant_from_idx','graph_edges_tenant_to_idx'))<>2
 then raise exception 'card_graph_release_state_changed'; end if;
end $gate$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${version}','${name}',array[${quote(sql)}]);
select 'card_graph_installed' state;
commit;`;
}

export async function readLive(token = savedCliToken(), fetcher = fetch) {
  source();
  return assess(await management(catalog, token, true, fetcher));
}

export async function installExact(token = savedCliToken(), fetcher = fetch) {
  if ((await readLive(token, fetcher)).state !== 'absent') throw Error('card_graph_not_absent');
  let acknowledged = false;
  try {
    const rows = await management(releaseSql(), token, false, fetcher);
    acknowledged = Array.isArray(rows) && rows.some(row => row?.state === 'card_graph_installed');
  } catch { /* A lost HTTP acknowledgement never authorises replay. */ }
  const after = await readLive(token, fetcher);
  if (after.state !== 'installed') throw Error('card_graph_write_outcome_unverified_no_replay');
  return { ...after, acknowledged, writeQueries: 1 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const mode = process.argv[2];
    if (process.argv.length !== 3) throw Error('card_graph_exact_mode_required');
    if (mode === '--live-read-only') console.log(JSON.stringify(await readLive()));
    else if (mode === '--live-install-exact' &&
      process.env.NEW_DAWN_CARD_GRAPH_PROJECT === project &&
      process.env.NEW_DAWN_CARD_GRAPH_SHA === expectedSha)
      console.log(JSON.stringify(await installExact()));
    else throw Error('card_graph_exact_authority_required');
  } catch (error) {
    console.error(JSON.stringify({ state: 'card_graph_release_stopped',
      reason: error instanceof Error ? error.message : 'unknown' }));
    process.exitCode = 1;
  }
}
