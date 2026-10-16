/** Advance only the known LIVE card retry after the TEST-accepted smaller batch. */
import { savedCliToken } from './learn-test-readiness.mjs';

if (process.argv.slice(2).join(' ') !== '--live-guarded' ||
    process.env.LEARN_LIVE_ALLOW_PROJECT_REF !== 'tgbnakbxwcqjeimygroz')
  throw Error('Exact LIVE guarded mode required');
const project = 'tgbnakbxwcqjeimygroz';
const tenant = '00000000-0000-0000-0000-000000000001';
const token = savedCliToken();
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
async function query(sql, readOnly) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? '/read-only' : ''}`, {
    method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(45000),
    body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }),
  });
  if (!response.ok) throw Error(`LIVE job query HTTP ${response.status}`);
  return response.json();
}
const inventory = await fetch(`https://api.supabase.com/v1/projects/${project}/functions`, {
  headers: { Authorization: `Bearer ${token}` }, redirect: 'error',
  signal: AbortSignal.timeout(30000),
});
if (!inventory.ok) throw Error('LIVE worker inventory unavailable');
const worker = (await inventory.json()).find((row) => row.slug === 'platform-worker');
if (worker?.version !== 104 || worker?.ezbr_sha256 !==
    'd80c5656fefad63ddca67bc625beeabb004bc505bfdfc781c10072d949028994' ||
    worker?.status !== 'ACTIVE') throw Error('TEST-accepted LIVE worker changed');
const read = `select id,status,error_code,attempt_count,available_at,updated_at,payload
  from public.platform_jobs where tenant_id='${tenant}'::uuid
  and job_type='customer_card.sync' and status='retrying'`;
const rows = await query(read, true);
if (!Array.isArray(rows) || rows.length !== 1) throw Error('Unique retry changed');
const job = rows[0];
if (!/^[0-9a-f-]{36}$/i.test(job.id) || job.error_code !== 'card_partial_failure' ||
    job.attempt_count !== 4 || Object.keys(job.payload ?? {}).length !== 0 ||
    Date.parse(job.available_at) < Date.now() + 30 * 60_000 ||
    !Number.isFinite(Date.parse(job.updated_at))) throw Error('Retry baseline changed');
const where = `id='${job.id}'::uuid and tenant_id='${tenant}'::uuid
  and job_type='customer_card.sync' and status='retrying'
  and error_code='card_partial_failure' and attempt_count=4
  and available_at='${job.available_at}'::timestamptz
  and updated_at='${job.updated_at}'::timestamptz`;
const update = `update public.platform_jobs set available_at=clock_timestamp()
  where ${where}; get diagnostics changed = row_count;
  if changed<>1 then raise exception 'card_retry_guard_changed'; end if;`;
await query(`begin; do $$ declare changed integer; begin ${update} end $$; rollback;`, false);
const afterRehearsal = await query(read, true);
if (afterRehearsal.length !== 1 ||
    afterRehearsal[0].available_at !== job.available_at ||
    afterRehearsal[0].updated_at !== job.updated_at)
  throw Error('Rollback rehearsal did not preserve retry');
await query(`do $$ declare changed integer; begin ${update} end $$;`, false);
const after = await query(`select status,attempt_count,available_at from public.platform_jobs
  where id='${job.id}'::uuid and tenant_id='${tenant}'::uuid`, true);
if (after.length !== 1 ||
    !['retrying', 'running', 'succeeded', 'dead_letter'].includes(after[0].status))
  throw Error('Updated retry state unconfirmed');
console.log(JSON.stringify({ state: 'card_retry_guardedly_advanced', project,
  workerVersion: worker.version, priorAvailableAt: job.available_at,
  newStatus: after[0].status, attemptCount: after[0].attempt_count,
  newAvailableAt: after[0].available_at, rollbackRehearsed: true,
  sourceOrCardDataWrites: false }));
