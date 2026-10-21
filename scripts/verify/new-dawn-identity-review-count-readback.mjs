/** Read-only, exact-source guard for the LIVE identity-review count repair. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { savedCliToken } from './learn-test-readiness.mjs';

const project = 'tgbnakbxwcqjeimygroz';
const oldFunctionMd5 = 'fcf76cac657c2245b432cd1199dd48e6';
const newFunctionMd5 = '424e42ecd066f3e6dd7ac553b11f1156';
const files = [
  ['20261112193000_new_dawn_identity_review_gmail_draft_index.sql',
    '98823b2aca835b6c828f298389ca3d5865caf95059ddc3f0ed9cad42a7c2caaa'],
  ['20261112193100_new_dawn_identity_review_count_indexed.sql',
    'a48b888c2fb1eaaac59f29c2aabdb489f005dce534bcac9aceb378a59a82dcf7'],
];
const indexDef = 'CREATE INDEX learn_email_gmail_draft_review_idx ON public.email_messages USING btree (tenant_id, id) WHERE ((provider = \'gmail\'::text) AND ((raw_payload -> \'label_ids\'::text) @> \'["DRAFT"]\'::jsonb))';
const sha = value => createHash('sha256').update(value).digest('hex');
const literal = value => `'${value.replaceAll("'", "''")}'`;

export function exactSources() {
  return files.map(([name, expectedSha]) => {
    const source = readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url));
    if (sha(source) !== expectedSha) throw Error(`identity_review_source_changed:${name}`);
    return { name, sha256: expectedSha };
  });
}

const catalog = `select
 current_setting('server_version') server_version,
 md5(pg_get_functiondef('public.learn_identity_review_count(uuid)'::regprocedure)) function_md5,
 has_function_privilege('service_role','public.learn_identity_review_count(uuid)','EXECUTE') service_execute,
 has_function_privilege('anon','public.learn_identity_review_count(uuid)','EXECUTE') anon_execute,
 has_function_privilege('authenticated','public.learn_identity_review_count(uuid)','EXECUTE') authenticated_execute,
 (select count(*)::int from supabase_migrations.schema_migrations
  where version::text='20261112193000') index_migration_count,
 (select count(*)::int from supabase_migrations.schema_migrations
  where version::text='20261112193100') function_migration_count,
 (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='learn_email_gmail_draft_review_idx') index_count,
 (select coalesce(bool_and(x.indisvalid and x.indisready and pg_get_indexdef(c.oid)=${literal(indexDef)}),false)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
   join pg_index x on x.indexrelid=c.oid
  where n.nspname='public' and c.relname='learn_email_gmail_draft_review_idx') index_exact,
 (select count(*)::int from public.interactions
  where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
   and processing_status='identity_review') raw_review_count`;

export async function readLive(token = savedCliToken(), fetcher = fetch) {
  exactSources();
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: catalog }),
  });
  if (!response.ok) throw Error(`identity_review_readback_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 20_000) throw Error('identity_review_readback_too_large');
  const rows = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(rows) || rows.length !== 1) throw Error('identity_review_readback_unconfirmed');
  return rows[0];
}

export function assess(row) {
  if (!row || !String(row.server_version).startsWith('17.') ||
    row.service_execute !== true || row.anon_execute !== false ||
    row.authenticated_execute !== false ||
    row.index_count > 1 || row.index_migration_count > 1 ||
    row.function_migration_count > 1 || !Number.isInteger(row.raw_review_count))
    throw Error('identity_review_live_state_changed');
  const stage = row.function_migration_count === 1 ? 'installed'
    : row.index_count === 1 ? 'index_ready' : 'baseline';
  if (stage === 'baseline' && (row.function_md5 !== oldFunctionMd5 ||
      row.index_count !== 0 || row.index_migration_count !== 0 ||
      row.function_migration_count !== 0))
    throw Error('identity_review_baseline_changed');
  if (stage === 'index_ready' && (row.function_md5 !== oldFunctionMd5 ||
      row.index_exact !== true || row.function_migration_count !== 0))
    throw Error('identity_review_index_stage_changed');
  if (stage === 'installed' && (row.index_exact !== true || row.index_count !== 1 ||
      row.index_migration_count !== 1 || row.function_md5 !== newFunctionMd5))
    throw Error('identity_review_install_unconfirmed');
  return { stage, project, rawReviewCount: row.raw_review_count,
    functionMd5: row.function_md5, indexExact: row.index_exact,
    sourceSha256: exactSources(), providerRequests: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--live-read-only')
      throw Error('identity_review_read_only_scope_required');
    console.log(JSON.stringify(assess(await readLive())));
  } catch (error) {
    console.error(JSON.stringify({ state: 'identity_review_readback_stopped',
      reason: error instanceof Error ? error.message : 'unknown' }));
    process.exitCode = 1;
  }
}
