/** Read-only release check for the audited open-job identity review reader. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { savedCliToken } from './learn-test-readiness.mjs';

const project = 'tgbnakbxwcqjeimygroz';
const version = '20261113040000';
const name = 'new_dawn_open_identity_triage';
const baseline = '39787455642e88b3ec7f0b21884869da438b917a06bee3a9f6992f74240ec217';
const candidate = '81a8316c6800eca74a89e2095f59b52ab910d19f8e2203122f18e1adcf6fe3d2';
const routine = 'public.new_dawn_open_identity_review_page(uuid,uuid,text,text,integer)';
const source = readFileSync(new URL('../../supabase/migrations/20261113040000_new_dawn_open_identity_triage.sql', import.meta.url));
const sourceHash = createHash('sha256').update(source).digest('hex');

const query = `select
 (select count(*)::int from supabase_migrations.schema_migrations where version::text='${version}') ledger_count,
 (select name from supabase_migrations.schema_migrations where version::text='${version}') ledger_name,
 (select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version::text='${version}') ledger_source_sha256,
 encode(sha256(convert_to(pg_get_functiondef('${routine}'::regprocedure),'UTF8')),'hex') function_sha256,
 has_function_privilege('authenticated','${routine}','EXECUTE') authenticated_execute,
 has_function_privilege('anon','${routine}','EXECUTE') anon_execute,
 has_function_privilege('service_role','${routine}','EXECUTE') service_execute,
 to_regclass('public.new_dawn_commusoft_current_job_source') is not null source_projection_present,
 (select count(*)::int from public.feature_flags where tenant_id='00000000-0000-0000-0000-000000000001'::uuid and flag='new_dawn.m2_link_review_queue' and value='true'::jsonb) review_flag_on`;

async function readOnly() {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${savedCliToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw Error(`readback_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 100_000) throw Error('readback_response_too_large');
  const rows = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(rows) || rows.length !== 1) throw Error('readback_shape_changed');
  return rows[0];
}

try {
  if (process.argv.length !== 3 || process.argv[2] !== '--live-read-only')
    throw Error('readback_scope_required');
  const row = await readOnly();
  const installed = row.ledger_count === 1;
  if (row.ledger_count !== (installed ? 1 : 0) ||
    row.function_sha256 !== (installed ? candidate : baseline) ||
    (installed && (row.ledger_name !== name || row.ledger_source_sha256 !== sourceHash)) ||
    (!installed && (row.ledger_name !== null || row.ledger_source_sha256 !== null)) ||
    row.authenticated_execute !== true || row.anon_execute !== false ||
    row.service_execute !== false || row.source_projection_present !== true ||
    row.review_flag_on !== 1) throw Error('live_identity_reader_state_changed');
  console.log(JSON.stringify({ state: installed ? 'triage_reader_installed' : 'triage_reader_ready',
    project, version, sourceSha256: sourceHash, functionSha256: row.function_sha256,
    providerRequests: 0, identityWrites: 0 }));
} catch (error) {
  console.error(JSON.stringify({ state: 'triage_readback_stopped',
    reason: error instanceof Error ? error.message : 'unknown' }));
  process.exitCode = 1;
}
