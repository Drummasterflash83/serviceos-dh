/** Guarded TEST-first indexes for bounded operator health reads. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const mode = process.argv[2];
if (!['--rehearse-test', '--apply-test', '--rehearse-live', '--apply-live'].includes(mode)
  || process.argv.length !== 3) throw Error('Exact operator-health release mode required');
const LIVE_PROJECT = 'tgbnakbxwcqjeimygroz';
const project = mode.endsWith('test') ? TEST_PROJECT : LIVE_PROJECT;
const sqlPath = 'supabase/migrations/20261104030000_learn_operator_health_latest_jobs.sql';
const sql = await readFile(sqlPath, 'utf8');
const packageSha256 = createHash('sha256').update(sql).digest('hex');
const directory = '.verification-results/learn-build01-operator-health-index';
await mkdir(directory, { recursive: true, mode: 0o700 });
const token = savedCliToken();
const catalogSql = `select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,
   'digest',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),
   'acl',p.proacl::text,'securityDefiner',p.prosecdef) order by p.proname)
   from pg_proc p where p.oid in ('public.learn_scheduler_health_read(uuid)'::regprocedure,
    'public.learn_operator_capture_health(uuid,text)'::regprocedure)),
 'indexes',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,
   'definition',pg_get_indexdef(c.oid),'valid',ix.indisvalid,'ready',ix.indisready)
   order by c.relname),'[]'::jsonb)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   join pg_index ix on ix.indexrelid=c.oid where n.nspname='public'
   and c.relname in ('learn_scheduler_latest_jobs_idx','learn_slack_health_account_latest_idx')),
 'authenticatedJobPayloadSelect',has_column_privilege('authenticated','public.platform_jobs','payload','select')
) as audit`;
async function query(statement, readOnly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? '/read-only' : ''}`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: statement }),
  });
  const rows = await response.json().catch(() => null);
  if (response.status !== 201 || !Array.isArray(rows))
    throw Error(`Operator-health query unconfirmed (HTTP ${response.status})`);
  return rows;
}
const audit = async () => {
  const rows = await query(catalogSql);
  if (rows.length !== 1 || !rows[0]?.audit) throw Error('Operator-health catalog unavailable');
  return rows[0].audit;
};
const before = await audit();
const expected = new Map([
  ['learn_operator_capture_health', '7c52320c0d9f19a36af3909f51de0ff8'],
  ['learn_scheduler_health_read', '18fb4f9556f5d5d52fd0e5a97ab40b40'],
]);
if (before.indexes.length !== 0 || before.functions?.length !== 2
  || before.functions.some(f => expected.get(f.name) !== f.digest || f.owner !== 'postgres'
    || f.securityDefiner !== true || !f.acl?.includes('authenticated=X/postgres')))
  throw Error('Exact operator-health prerequisites changed');

async function recentVerified(receiptMode) {
  for (const name of await readdir(directory)) {
    if (!name.startsWith(`${receiptMode}-`) || !name.endsWith('.json')) continue;
    const receipt = JSON.parse(await readFile(`${directory}/${name}`, 'utf8'));
    if (receipt.packageSha256 === packageSha256 && receipt.state ===
      (receiptMode.startsWith('rehearse') ? 'rehearsed_rolled_back' : 'installed_verified')
      && Date.now() - Date.parse(receipt.observedAt) < 3600000) return true;
  }
  return false;
}
if (mode === '--apply-test' && !(await recentVerified('rehearse-test')))
  throw Error('Fresh TEST rollback rehearsal required');
if (mode === '--rehearse-live' && !(await recentVerified('apply-test')))
  throw Error('Verified TEST installation required');
if (mode === '--apply-live' && (!(await recentVerified('apply-test'))
  || !(await recentVerified('rehearse-live'))))
  throw Error('Verified TEST and fresh LIVE rehearsal required');

const filename = `${directory}/${mode.slice(2)}-${Date.now()}.json`;
await writeFile(filename, JSON.stringify({ state: 'prepared_not_submitted', mode, project,
  packageSha256, before, startedAt: new Date().toISOString() }, null, 2) + '\n',
{ flag: 'wx', mode: 0o600 });
let submitted = false;
try {
  await query(mode.startsWith('--rehearse')
    ? sql.replace(/\ncommit;\s*$/i, '\nrollback;\n') : sql, false);
  submitted = true;
} catch {
  // An uncertain outcome is reconciled through the catalog, never resubmitted.
}
const after = await audit();
const authorityPreserved = JSON.stringify(before.functions) === JSON.stringify(after.functions)
  && before.authenticatedJobPayloadSelect === after.authenticatedJobPayloadSelect;
const rehearsal = mode.startsWith('--rehearse');
const expectedIndexes = new Map([
  ['learn_scheduler_latest_jobs_idx', 'ON public.platform_jobs USING btree (tenant_id, job_type, created_at DESC NULLS LAST, id DESC)'],
  ['learn_slack_health_account_latest_idx', "ON public.platform_jobs USING btree (tenant_id, ((payload ->> 'connector_account_id'::text)), created_at DESC NULLS LAST, id DESC) WHERE (job_type = 'slack.history_sync'::text)"],
]);
const installed = after.indexes.length === 2 && after.indexes.every(i =>
  i.valid === true && i.ready === true && i.definition.includes(expectedIndexes.get(i.name) ?? '#missing#'));
const state = submitted && authorityPreserved && (rehearsal ? after.indexes.length === 0 : installed)
  ? rehearsal ? 'rehearsed_rolled_back' : 'installed_verified' : 'requires_inspection';
const receipt = { state, mode, project, packageSha256, authorityPreserved,
  beforeIndexes: before.indexes.map(x => x.name), afterIndexes: after.indexes.map(x => x.name),
  observedAt: new Date().toISOString(), providerRequests: 0, sourceDataWrites: false };
await writeFile(filename, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(receipt));
if (state !== 'installed_verified' && state !== 'rehearsed_rolled_back') process.exitCode = 1;
