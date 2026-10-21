/** Bind one dedicated LIVE daily-report key; never print or persist its value. */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { savedCliToken } from './learn-test-readiness.mjs';

const PROJECT = 'tgbnakbxwcqjeimygroz';
const NAME = 'LEARN_QUICKBOOKS_DAILY_REPORT_KEY';
const SCHEMA_VERSION = '20261112170000';
const SCHEMA_SHA = '37d53ae3809d31471c5541b94e2d548837d98f27c01b4a01e61f1a9cdc6be6b1';
const EDGE = 'learn-quickbooks-daily-reports';
const EDGE_SHA = '573ee0fb0133f1e9eae766a8bad10144d7af9941cb3a4ec92c8e94302d5e005a';
const sha = value => createHash('sha256').update(value).digest('hex');
const url = path => `https://api.supabase.com/v1/projects/${PROJECT}${path}`;

async function request(path, { method = 'GET', body, token = savedCliToken() } = {}) {
  const response = await fetch(url(path), { method, redirect: 'error',
    signal: AbortSignal.timeout(25000), headers: { Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw Error(`daily_key_management_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 1024 * 1024) throw Error('daily_key_response_too_large');
  return bytes.length ? JSON.parse(bytes.toString('utf8')) : null;
}

async function query(sql, readOnly = true) {
  const rows = await request(`/database/query${readOnly ? '/read-only' : ''}`,
    { method: 'POST', body: { query: sql, read_only: readOnly } });
  if (!Array.isArray(rows)) throw Error('daily_key_database_reply_unconfirmed');
  return rows;
}

async function stage() {
  const [rows, edge] = await Promise.all([
    query(`select
      (select count(*)::int from vault.secrets where name='${NAME}') vault_count,
      (select count(*)::int from public.learn_quickbooks_daily_reports where enabled) enabled_count,
      (select count(*)::int from public.learn_quickbooks_daily_reports) policy_count,
      (select count(*)::int from cron.job where jobname='openfolk-quickbooks-daily-reports') schedule_count,
      (select encode(sha256(convert_to(statements[1],'UTF8')),'hex')
       from supabase_migrations.schema_migrations where version::text='${SCHEMA_VERSION}') schema_hash`),
    request(`/functions/${EDGE}`),
  ]);
  const row = rows[0];
  if (rows.length !== 1 || row?.schema_hash !== SCHEMA_SHA ||
    row.enabled_count !== 0 || row.policy_count !== 0 || row.schedule_count !== 0 ||
    ![0, 1].includes(row.vault_count) || edge?.slug !== EDGE ||
    edge?.status !== 'ACTIVE' || edge?.verify_jwt !== false ||
    edge?.ezbr_sha256 !== EDGE_SHA) throw Error('daily_key_stage_changed');
  return { vaultCount: row.vault_count };
}

/** An uncertain first write is reconciled by the exact Vault name, never replayed. */
export async function bind() {
  const before = await stage();
  if (before.vaultCount === 0) {
    try {
      await query(`do $key$ begin
        if exists(select 1 from vault.secrets where name='${NAME}') then
          raise exception 'daily_key_exists'; end if;
        perform vault.create_secret(encode(gen_random_bytes(32),'hex'),
          '${NAME}','Dedicated Drummonds daily read-only QuickBooks report trigger');
      end $key$;`, false);
    } catch { /* Exact-name readback below determines the outcome. */ }
  }
  const afterVault = await stage();
  if (afterVault.vaultCount !== 1) throw Error('daily_key_vault_outcome_unconfirmed');
  const exact = await query(`select decrypted_secret secret from vault.decrypted_secrets
    where name='${NAME}'`);
  const secret = exact.length === 1 ? exact[0]?.secret : null;
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret))
    throw Error('daily_key_exact_value_unavailable');
  const probe = async () => {
    try {
      const response = await fetch(`https://${PROJECT}.functions.supabase.co/${EDGE}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'x-serviceos-worker-key': secret, 'Content-Type': 'application/json' },
      });
      const body = await response.json().catch(() => null);
      return response.status === 200 && body?.ok === true &&
        body?.result?.state === 'not_due' && body?.result?.checked === 0;
    } catch { return false; }
  };
  // An already-bound key needs no second write. A failed probe is safe because
  // stage() proves no standing policy exists, so the runner has no due work.
  if (!await probe()) {
    // Write one exact Edge setting. Never list, read or overwrite other secrets.
    try { await request('/secrets', { method: 'POST', body: [{ name: NAME, value: secret }] }); }
    catch { /* A second probe determines whether a lost acknowledgement applied. */ }
  }
  const policy = await stage();
  if (policy.vaultCount !== 1) throw Error('daily_key_scope_changed');
  let bound = false;
  for (let attempt = 0; attempt < 3 && !bound; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 2000));
    bound = await probe();
  }
  if (!bound)
    throw Error('daily_key_edge_binding_unconfirmed');
  return { state: 'dedicated_key_bound_no_due_policy', project: PROJECT,
    keyName: NAME, keySha256: sha(secret), providerRequests: 0, policyEnabled: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).join(' ') !== '--bind-exact' ||
      process.env.NEW_DAWN_QBO_PROJECT !== PROJECT ||
      process.env.NEW_DAWN_QBO_EDGE_SHA !== EDGE_SHA)
      throw Error('daily_key_exact_scope_required');
    console.log(JSON.stringify(await bind()));
  } catch (error) {
    console.error(JSON.stringify({ state: 'stopped',
      reason: error instanceof Error ? error.message : 'unknown' }));
    process.exitCode = 1;
  }
}
