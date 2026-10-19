/** Read-only LIVE aggregate for the merged M1 source-home selection. No function,
 * flag, audit write, provider request, or row content is returned or logged.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { savedCliToken } from './learn-test-readiness.mjs';

const PROJECT = 'tgbnakbxwcqjeimygroz';
const TENANT = '00000000-0000-0000-0000-000000000001';
const SOURCE_SHA256 = '55fcb1eaa4bff4a4334e37fd80f6ec0a3ce2786d582597e05a9e931c6af4eba1';
const source = readFileSync(new URL('../../supabase/migrations/20261106210000_new_dawn_source_job_home.sql', import.meta.url), 'utf8');
if (createHash('sha256').update(source).digest('hex') !== SOURCE_SHA256)
  throw Error('Merged M1 migration changed; review query before measuring LIVE');

export function selectionSql() {
  const start = source.indexOf('\n with linked as materialized (');
  const end = source.indexOf('\n select (select count(*)::integer from valid),', start);
  if (start < 0 || end < 0 || end <= start) throw Error('M1 selection contract changed');
  const cte = source.slice(start + 2, end).replace(/\bp_tenant\b/g, `'${TENANT}'::uuid`);
  if (!cte.startsWith('with linked as materialized (') || !cte.endsWith('\n )') ||
      /\b(insert|update|delete|create|alter|drop|truncate|grant|revoke|commit|rollback)\b/i.test(cte))
    throw Error('M1 read-only selection contract changed');
  return `${cte}\nselect (select count(*)::integer from valid) reviewed_count,
 count(*)::integer page_count,
 count(*) filter (where source_state='source_changed')::integer changed_count,
 count(*) filter (where source_state='source_ambiguous')::integer ambiguous_count,
 coalesce(sum(octet_length(fields::text)),0)::bigint field_bytes
from rows`;
}

const preflightSql = `select to_regprocedure('public.new_dawn_source_job_home(uuid,text)') is null as function_absent,
 count(*)::integer as flag_rows,
 count(*) filter(where value='true'::jsonb)::integer as enabled_flags
 from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='new_dawn.source_job_home'`;

async function readOnly(token, sql, timeoutMs = 25000, stage = 'preflight') {
  if (!sql.startsWith('select ') && !sql.startsWith('EXPLAIN ' ) && !sql.startsWith('with '))
    throw Error('Read-only query boundary changed');
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query/read-only`, {
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql}),redirect:'error',signal:AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const reported = typeof problem?.code === 'string' ? problem.code : '';
    const embedded = typeof problem?.message === 'string' ? problem.message.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] : null;
    const code = /^[A-Z0-9]{5}$/.test(reported) ? reported : embedded ?? 'unknown';
    throw Error(`LIVE read-only M1 ${stage} failed (HTTP ${response.status}, SQLSTATE ${code})`);
  }
  return response.json();
}

export function rollbackReadSql(selection) {
  if (!selection.startsWith('with linked as materialized (') || selection.includes(';') ||
      /\b(insert|update|delete|create|alter|drop|truncate|grant|revoke|commit|rollback)\b/i.test(selection))
    throw Error('LIVE read-only transaction selection changed');
  const sql = `begin transaction read only;\nset local statement_timeout='15s';\n${selection};\nrollback;`;
  if (!sql.endsWith('rollback;')) throw Error('LIVE rollback fence missing');
  return sql;
}

async function rollbackRead(token, selection) {
  const sql = rollbackReadSql(selection);
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql,read_only:false}),redirect:'error',signal:AbortSignal.timeout(25000),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const reported = typeof problem?.code === 'string' ? problem.code : '';
    const embedded = typeof problem?.message === 'string' ? problem.message.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] : null;
    const code = /^[A-Z0-9]{5}$/.test(reported) ? reported : embedded ?? 'unknown';
    throw Error(`LIVE rollback-only M1 aggregate failed (HTTP ${response.status}, SQLSTATE ${code})`);
  }
  return response.json();
}

export async function measure() {
  const token = savedCliToken();
  const pre = (await readOnly(token,preflightSql))[0];
  if (!pre?.function_absent || pre.enabled_flags !== 0)
    throw Error('LIVE M1 source home is already installed or enabled; this probe expects absent/OFF');
  const query = selectionSql();
  const started = performance.now();
  const result = (await rollbackRead(token,query))[0];
  const roundTripMs = Math.round(performance.now()-started);
  if (!result || !Number.isInteger(result.reviewed_count) || !Number.isInteger(result.page_count) ||
      result.page_count < 0 || result.page_count > 24 || result.reviewed_count < result.page_count ||
      !Number.isInteger(result.changed_count) || !Number.isInteger(result.ambiguous_count) ||
      !Number.isInteger(Number(result.field_bytes)))
    throw Error('LIVE M1 aggregate result invalid');
  const post = (await readOnly(token,preflightSql))[0];
  if (JSON.stringify(pre) !== JSON.stringify(post))
    throw Error('LIVE M1 function or flag state changed during readback');
  return {
    state:'read_only_selection_measured',project:PROJECT,providerRequests:0,
    migrationSha256:SOURCE_SHA256,reviewedCount:result.reviewed_count,
    pageCount:result.page_count,changedCount:result.changed_count,
    ambiguousCount:result.ambiguous_count,
    roundTripMs,functionAbsent:post.function_absent,flagEnabled:false,
    limitation:'Selection only; authenticated RPC and client path not exercised.',
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (process.argv.slice(2).join(' ') !== '--live-read-only')
    throw Error('Exact LIVE read-only mode required');
  try { console.log(JSON.stringify(await measure())); }
  catch (error) { console.error(error.message);process.exitCode=1; }
}
