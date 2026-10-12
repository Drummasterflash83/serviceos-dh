/** Real Gmail TEST preflight. Read-only: no mailbox activation or provider calls. */
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT, TEST_ORGANIZATION } from './learn-test-readiness.mjs';
import { readSupervisorMetadata, preservationQuery, SCOPE } from './learn-commusoft-operator-run.mjs';

const file = '.verification-results/email-real-test-20261012.json';
const production = 'tgbnakbxwcqjeimygroz';
const productionTenant = '00000000-0000-0000-0000-000000000001';
const productionAccount = '4d3c9f72-fe76-445a-a922-87e596205898';
const mailbox = 'heidi@drummondheating.co.uk';
const check = (v, m) => { if (!v) throw Error(m); };
const sha = v => createHash('sha256').update(v).digest('hex');
check(process.argv[2] === 'prepare' && process.argv.length === 3 &&
  process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT, 'Explicit read-only TEST preparation required');
const token = savedCliToken();
async function metadata(project, path, query) {
  check([production, TEST_PROJECT].includes(project), 'Unexpected project');
  const r = await fetch(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(query ? { 'Content-Type': 'application/json' } : {}) },
    ...(query ? { body: JSON.stringify({ query }) } : {}),
    redirect: 'error', signal: AbortSignal.timeout(45000),
  });
  check(r.ok, `Scoped metadata read failed HTTP ${r.status}`);
  return r.json();
}
const project = await metadata(TEST_PROJECT, '');
check(project.id === TEST_PROJECT && project.organization_id === TEST_ORGANIZATION &&
  project.status === 'ACTIVE_HEALTHY', 'Wrong or unavailable TEST environment');
const sourceQuery = `select a.id,a.email_address,a.status account_status,a.auth_state,
 m.status mailbox_status,m.sync_enabled,m.mailbox_type,
 (to_jsonb(m)->>'directory_identity_conflict')::boolean directory_identity_conflict,
 c.domain,c.status connection_status,c.service_account_email,c.service_account_client_id,
 c.last_verified_at,c.delegated_scopes
 from public.email_accounts a join public.google_workspace_mailboxes m
 on m.tenant_id=a.tenant_id and lower(m.email_address)=lower(a.email_address)
 join public.google_workspace_connections c on c.tenant_id=m.tenant_id and c.id=m.connection_id
 where a.tenant_id='${productionTenant}' and a.id='${productionAccount}' and a.provider='gmail'`;
const sourceRows = await metadata(production, '/database/query/read-only', sourceQuery);
check(sourceRows.length === 1, 'Unique existing production mailbox binding required');
const source = sourceRows[0];
check(source.email_address === mailbox && source.account_status === 'active_dwd' &&
  source.connection_status === 'active' && source.sync_enabled === true &&
  ['active', 'pending'].includes(source.mailbox_status) &&
  !['alias', 'suspended'].includes(source.mailbox_type) &&
  source.directory_identity_conflict !== true &&
  source.domain === 'drummondheating.co.uk' && Number.isFinite(Date.parse(source.last_verified_at)),
  'Existing primary-mailbox authority is not verified');
const key = JSON.parse(readFileSync('/Users/chrisdrummond/Downloads/ServiceOS Workspace Connector.json', 'utf8'));
check(source.service_account_email === key.client_email &&
  source.service_account_client_id === key.client_id, 'Existing credential identity differs');
const secrets = await metadata(TEST_PROJECT, '/secrets');
const credentialDigests = Object.fromEntries([
  ['GOOGLE_WORKSPACE_CLIENT_EMAIL', key.client_email],
  ['GOOGLE_WORKSPACE_CLIENT_ID', key.client_id],
  ['GOOGLE_WORKSPACE_PRIVATE_KEY', key.private_key],
].map(([name, value]) => {
  check(typeof value === 'string' && value.length > 0, 'Incomplete existing credential');
  const digest = sha(value), matching = secrets.filter(s => s.name === name && (s.digest ?? s.value) === digest);
  check(matching.length === 1, 'Approved TEST credential digest differs');
  return [name, digest];
}));
const functions = await metadata(TEST_PROJECT, '/functions');
const pins = functions.filter(f => ['platform-worker', 'gmail-workspace-sync-messages'].includes(f.slug))
  .map(f => ({ name: f.slug, id: f.id, version: f.version, hash: f.ezbr_sha256, jwt: f.verify_jwt, status: f.status }))
  .sort((a, b) => a.name.localeCompare(b.name));
check(pins.length === 2 && pins.every(f => f.jwt === (f.name !== 'platform-worker') &&
  f.status === 'ACTIVE' && /^[a-f0-9]{64}$/.test(f.hash)),
  'Email runtime unavailable');
const q = s => readSupervisorMetadata(token, s);
const tables = ['google_workspace_connections', 'google_workspace_mailboxes', 'email_accounts',
  'email_messages', 'email_threads', 'email_sync_runs', 'email_ingestion_checkpoints',
  'email_ingestion_transitions', 'learn_email_transition_requests', 'learn_email_transition_settlements',
  'learn_email_job_attempts'];
const inventory = await q(tables.map(t => t === 'learn_email_transition_settlements'
  ? `select '${t}' name,count(*)::int n from public.${t} s join public.learn_email_transition_requests r on r.id=s.request_id where r.tenant_id='${SCOPE.tenant}'`
  : `select '${t}' name,count(*)::int n from public.${t} where tenant_id='${SCOPE.tenant}'`).join(' union all '));
check(inventory.length === tables.length && inventory.every(t => t.n === 0), 'Target email state is not empty');
const flags = await q(`select flag,value from public.feature_flags where tenant_id='${SCOPE.tenant}' and flag in ('learn.enabled','learn.inputs.email.enabled') order by flag`);
check(flags.length === 2 && flags.every(f => f.value === (f.flag === 'learn.enabled')), 'TEST email must be paused');
const active = await q("select job_type,status,count(*)::int n from public.platform_jobs where status in ('queued','running','retrying') group by job_type,status");
check(active.every(x => x.job_type === 'commusoft.source_sync'), 'Unrelated queue work exists; worker scope must be reviewed');
const cron = await q("select to_regclass('cron.job') is not null present");
if (cron[0].present) check((await q('select count(*)::int n from cron.job where active'))[0].n === 0, 'Unexpected active TEST schedule');
const c = JSON.parse(readFileSync('.verification-results/commusoft-operator-2026-10-12.json'));
const baseQuery = preservationQuery(c), before = await q(baseQuery);
check(before.length === 194, 'Incomplete preservation inventory');
const afterSource = await metadata(production, '/database/query/read-only', sourceQuery);
check(JSON.stringify(afterSource) === JSON.stringify(sourceRows), 'Production mailbox authority changed during inspection');
const plan = {
  version: 1, run: randomUUID(), preparedAt: new Date().toISOString(), state: 'prepared',
  project: TEST_PROJECT, tenant: SCOPE.tenant, mailbox, source, sourceQuery,
  connection: randomUUID(), mailboxId: randomUUID(), account: randomUUID(),
  credentialDigests, pins, inventory, activeJobsAtPreparation: active,
  limits: { pages: 1, messages: 20, tokenRequests: 1, gmailRequests: 22,
    messageResponseBytes: 33554432, attachmentDownloads: 0, aiRequests: 0 },
  baseQuery, before, scope: 'One mailbox page through the installed durable capture worker; pause afterwards; no provider writes or production changes.',
  pending: null, history: [],
};
writeFileSync(file, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ run: plan.run, state: plan.state, project: TEST_PROJECT,
  sourceBindingVerified: true, approvedCredentialDigestsMatch: true, targetEmailRecords: 0,
  preservedDatasets: before.length, limits: plan.limits, pins, providerRequests: 0,
  productionWrites: 0, targetWrites: 0, note: 'Execution remains unprepared; no mailbox has been activated.' }, null, 2));
