/** Drift-checked, schema-only LIVE release for the staged M2 identity batch. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { savedCliToken } from './learn-test-readiness.mjs';

const project = 'tgbnakbxwcqjeimygroz';
const tenant = '00000000-0000-0000-0000-000000000001';
const migrations = [
  ['20261111100000', 'new_dawn_m2_staged_identity_batch', '6eb30fa19b428db6bb43b55300552ae762e2e00eea1a2bc593e7f75569e142cf'],
  ['20261111110000', 'new_dawn_m2_staged_identity_apply', '957f5739bdcdae0f1fc7bf1ecdaf8e7cb413669a5d5ec470a074bbde8e61bff3'],
  ['20261111120000', 'new_dawn_m2_staged_identity_reversal', '8615ec01f0625b4589d0867e623643f0f034a2871de4ec82c474ab082de5975d'],
  ['20261111130000', 'new_dawn_m2_staged_identity_summary', '81e6afa0be611da53c28c639951b30fc769cf9bd79e53d70f93b574b4c64af10'],
  ['20261111140000', 'new_dawn_m2_staged_search_guard', '6059a58fae6ef27097ccb9942230ede1edb3bb831f286001abc1ab9cee275338'],
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sqlLiteral = value => `'${value.replaceAll("'", "''")}'`;

export function exactSources() {
  return migrations.map(([version, name, digest]) => {
    const source = readFileSync(new URL(`../../supabase/migrations/${version}_${name}.sql`, import.meta.url), 'utf8');
    if (sha(source) !== digest || !/\nbegin;\n/i.test(source) || !/\ncommit;\s*$/i.test(source))
      throw Error(`identity_release_source_changed_${version}`);
    const body = source.slice(source.indexOf('\nbegin;') + 8, source.lastIndexOf('\ncommit;'));
    if (/^\s*(begin|commit);\s*$/im.test(body)) throw Error(`identity_release_nested_transaction_${version}`);
    return { version, name, digest, source, body };
  });
}

const versions = migrations.map(([version]) => sqlLiteral(version)).join(',');
const existing = {
  currentLinksView: '4a82874423af1e28d27c0d5aa19158dbc82165ed39dda04b429672fae2f62082',
  cardSearchFunction: '6ac809b881991048b1cb6f22664ad536cfef925008cd4dc97b7b58b9905a634e',
};
const catalog = `select
 (select count(*)::int from supabase_migrations.schema_migrations where version::text in (${versions})) ledger_count,
 (select jsonb_agg(jsonb_build_object('version',version::text,'name',name,'source_sha256',
   encode(sha256(convert_to(statements[1],'UTF8')),'hex')) order by version::text)
   from supabase_migrations.schema_migrations where version::text in (${versions})) ledger_rows,
 to_regclass('public.new_dawn_m2_identity_batches') is not null batch_table,
 to_regclass('public.new_dawn_m2_identity_items') is not null item_table,
 to_regprocedure('public.new_dawn_m2_identity_batch_register(uuid,uuid,uuid,jsonb,jsonb,text,text)') is not null register_function,
 to_regprocedure('public.new_dawn_m2_identity_apply_group(uuid,text)') is not null apply_function,
 to_regprocedure('public.new_dawn_m2_identity_reverse_group(uuid,text,text)') is not null reverse_function,
 encode(sha256(convert_to(pg_get_viewdef('public.learn_business_input_current_links'::regclass,true),'UTF8')),'hex') current_links_view_sha256,
 encode(sha256(convert_to(pg_get_functiondef('public.learn_card_search(uuid,text,text,integer,uuid)'::regprocedure),'UTF8')),'hex') card_search_sha256,
 pg_get_viewdef('public.learn_business_input_current_links'::regclass,true) like '%new_dawn_m2_direct_job_events%' direct_reversal_visible,
 pg_get_functiondef('public.learn_card_search(uuid,text,text,integer,uuid)'::regprocedure) like '%new_dawn_m2_staged_search_visible%' search_guard_visible,
 (select count(*)::int from public.feature_flags where tenant_id='${tenant}'::uuid
   and flag='new_dawn.m2_staged_batch_apply' and value='true'::jsonb) apply_enabled,
 (select count(*)::bigint from public.people where tenant_id='${tenant}'::uuid) people_count,
 (select count(*)::bigint from public.companies where tenant_id='${tenant}'::uuid) company_count,
 (select count(*)::bigint from public.sites where tenant_id='${tenant}'::uuid) site_count,
 (select count(*)::bigint from public.jobs where tenant_id='${tenant}'::uuid) job_count,
 (select count(*)::bigint from public.learn_business_input_links where tenant_id='${tenant}'::uuid) link_count`;

async function management(path, query, readOnly, token = savedCliToken(), fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${token}`, ...(query ? { 'Content-Type': 'application/json' } : {}) },
    ...(query ? { body: JSON.stringify({ query, read_only: readOnly }) } : {}),
  });
  if (!response.ok) throw Error(`identity_release_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 1_000_000) throw Error('identity_release_response_too_large');
  return JSON.parse(bytes.toString('utf8'));
}

export async function readStage(token = savedCliToken(), fetcher = fetch) {
  const [info, rows] = await Promise.all([
    management('', null, true, token, fetcher),
    management('/database/query/read-only', catalog, true, token, fetcher),
  ]);
  if (info?.id !== project || info.status !== 'ACTIVE_HEALTHY' || !Array.isArray(rows) || rows.length !== 1)
    throw Error('identity_release_catalog_unconfirmed');
  const row = rows[0];
  if (row.batch_table || row.item_table) {
    if (!row.batch_table || !row.item_table) throw Error('identity_release_partial_schema');
    const counts = await management('/database/query/read-only',
      'select (select count(*)::int from public.new_dawn_m2_identity_batches) batch_count,' +
      ' (select count(*)::int from public.new_dawn_m2_identity_items) item_count',
      true, token, fetcher);
    if (!Array.isArray(counts) || counts.length !== 1) throw Error('identity_release_batch_counts_unconfirmed');
    return { ...row, ...counts[0] };
  }
  return { ...row, batch_count: 0, item_count: 0 };
}

export function assess(row, installed) {
  if (!row || row.ledger_count !== (installed ? 5 : 0) ||
    row.batch_table !== installed || row.item_table !== installed ||
    row.register_function !== installed || row.apply_function !== installed ||
    row.reverse_function !== installed || row.apply_enabled !== 0 ||
    row.batch_count !== 0 || row.item_count !== 0 ||
    (installed && (row.direct_reversal_visible !== true || row.search_guard_visible !== true)) ||
    (!installed && (row.direct_reversal_visible !== false || row.search_guard_visible !== false ||
      row.current_links_view_sha256 !== existing.currentLinksView ||
      row.card_search_sha256 !== existing.cardSearchFunction)))
    throw Error('identity_release_live_stage_changed');
  if (installed) {
    const rows = row.ledger_rows;
    if (!Array.isArray(rows) || rows.length !== migrations.length ||
      rows.some((r, i) => r.version !== migrations[i][0] || r.name !== migrations[i][1] ||
        r.source_sha256 !== migrations[i][2])) throw Error('identity_release_ledger_changed');
  } else if (row.ledger_rows !== null) throw Error('identity_release_ledger_changed');
  return { state: installed ? 'schema_installed_apply_disabled' : 'ready_exact_schema_release',
    project, sourceSha256: migrations.map(x => x[2]), providerRequests: 0 };
}

export function releaseSql(before) {
  const sources = exactSources();
  const counts = ['people_count', 'company_count', 'site_count', 'job_count', 'link_count'];
  if (counts.some(key => !/^\d+$/.test(String(before[key])))) throw Error('identity_release_baseline_invalid');
  const gate = `if exists(select 1 from supabase_migrations.schema_migrations where version::text in (${versions}))
   or to_regclass('public.new_dawn_m2_identity_batches') is not null
   or to_regprocedure('public.new_dawn_m2_identity_batch_register(uuid,uuid,uuid,jsonb,jsonb,text,text)') is not null
   or encode(sha256(convert_to(pg_get_viewdef('public.learn_business_input_current_links'::regclass,true),'UTF8')),'hex') <> '${existing.currentLinksView}'
   or encode(sha256(convert_to(pg_get_functiondef('public.learn_card_search(uuid,text,text,integer,uuid)'::regprocedure),'UTF8')),'hex') <> '${existing.cardSearchFunction}'
   or exists(select 1 from public.feature_flags where tenant_id='${tenant}'::uuid
     and flag='new_dawn.m2_staged_batch_apply' and value='true'::jsonb)
   then raise exception 'identity_release_state_changed'; end if;`;
  const countGate = counts.map(key => {
    const table = {people_count:'people',company_count:'companies',site_count:'sites',job_count:'jobs',link_count:'learn_business_input_links'}[key];
    return `(select count(*) from public.${table} where tenant_id='${tenant}'::uuid) <> ${before[key]}`;
  }).join(' or ');
  return `begin;\nset local lock_timeout='3s';\nset local statement_timeout='90s';\nlock table supabase_migrations.schema_migrations in share row exclusive mode;\ndo $gate$ begin\n ${gate}\n if ${countGate} then raise exception 'identity_release_data_changed'; end if;\nend $gate$;\n${sources.map(({version,name,source,body}) => `${body}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${sqlLiteral(source)}]);`).join('\n')}\nselect 'identity_schema_installed' state;\ncommit;`;
}

export async function installLive(token = savedCliToken(), fetcher = fetch) {
  exactSources();
  const before = await readStage(token, fetcher);
  assess(before, false);
  let acknowledged = false;
  try {
    const rows = await management('/database/query', releaseSql(before), false, token, fetcher);
    acknowledged = Array.isArray(rows) && rows.some(row => row?.state === 'identity_schema_installed');
  } catch { /* Lost acknowledgement is read back, never replayed. */ }
  const after = await readStage(token, fetcher);
  assess(after, true);
  for (const key of ['people_count','company_count','site_count','job_count','link_count'])
    if (after[key] !== before[key]) throw Error('identity_release_data_changed_after_install');
  return { state: 'schema_installed_apply_disabled', project, acknowledged,
    versions: migrations.map(x => x[0]), providerRequests: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--live-read-only')
      console.log(JSON.stringify(await readStage()));
    else if (args.length === 1 && args[0] === '--live-install-exact' &&
      process.env.NEW_DAWN_M2_PROJECT === project)
      console.log(JSON.stringify(await installLive()));
    else throw Error('identity_release_exact_scope_required');
  } catch (error) {
    console.error(JSON.stringify({ state: 'identity_release_stopped',
      reason: error instanceof Error ? error.message : 'unknown' }));
    process.exitCode = 1;
  }
}
