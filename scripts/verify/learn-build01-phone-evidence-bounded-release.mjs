/** Guarded TEST-first release for the existing Phone operator evidence reader. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const mode = process.argv[2];
if (!['--rehearse-test', '--apply-test', '--rehearse-live', '--apply-live'].includes(mode)
  || process.argv.length !== 3) throw Error('Exact Phone evidence release mode required');
const LIVE_PROJECT = 'tgbnakbxwcqjeimygroz';
const project = mode.endsWith('test') ? TEST_PROJECT : LIVE_PROJECT;
const path = 'supabase/migrations/20261104040000_learn_phone_evidence_bounded.sql';
const sql = await readFile(path, 'utf8');
const packageSha256 = createHash('sha256').update(sql).digest('hex');
const directory = '.verification-results/learn-build01-phone-evidence-bounded';
await mkdir(directory, { recursive: true, mode: 0o700 });
const token = savedCliToken();
const priorDigest = '5f5450fa87b0459188c811807a966133';
const catalogSql = `select jsonb_build_object(
 'digest',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),
 'acl',p.proacl::text,'securityDefiner',p.prosecdef,
 'fixtureTenants',(select count(*) from public.tenants where slug like 'phone-settlement-fixture-%')
 ) as audit from pg_proc p where p.oid='public.learn_phone_account_evidence(uuid,uuid)'::regprocedure`;
async function query(statement, readOnly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? '/read-only' : ''}`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: statement }),
  });
  const rows = await response.json().catch(() => null);
  if (response.status !== 201 || !Array.isArray(rows))
    throw Error(`Phone evidence query unconfirmed (HTTP ${response.status})`);
  return rows;
}
const audit = async () => {
  const rows = await query(catalogSql);
  if (rows.length !== 1 || !rows[0]?.audit) throw Error('Phone evidence catalog unavailable');
  return rows[0].audit;
};
const before = await audit();
const expectedAcl = '{postgres=X/postgres}';
if (before.digest !== priorDigest || before.owner !== 'postgres'
  || before.acl !== expectedAcl || before.securityDefiner !== false)
  throw Error('Exact prior Phone evidence authority required');

async function recentVerified(receiptMode) {
  for (const name of await readdir(directory)) {
    if (!name.startsWith(`${receiptMode}-`) || !name.endsWith('.json')) continue;
    const receipt = JSON.parse(await readFile(`${directory}/${name}`, 'utf8'));
    if (receipt.packageSha256 === packageSha256 && receipt.state ===
      (receiptMode.startsWith('rehearse') ? 'rehearsed_rolled_back' : 'installed_verified')
      && Date.now() - Date.parse(receipt.observedAt) < 3600000) return receipt;
  }
  return null;
}
if (mode === '--apply-test' && !(await recentVerified('rehearse-test')))
  throw Error('Fresh TEST rollback and synthetic fixture rehearsal required');
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
  let statement = sql;
  if (mode === '--rehearse-test') {
    const fixture = await readFile('scripts/verify/learn-phone-health-hosted.assert.sql', 'utf8');
    statement = sql.replace(/\ncommit;\s*$/i, `\n${fixture}\nrollback;\n`);
  } else if (mode === '--rehearse-live') {
    statement = sql.replace(/\ncommit;\s*$/i, '\nrollback;\n');
  }
  await query(statement, false);
  submitted = true;
} catch {
  // Reconcile an uncertain outcome from the catalog; never blindly resubmit.
}
const after = await audit();
const authorityPreserved = before.owner === after.owner && before.acl === after.acl
  && before.securityDefiner === after.securityDefiner
  && before.fixtureTenants === after.fixtureTenants;
const rehearsal = mode.startsWith('--rehearse');
const testReceipt = mode === '--apply-live' ? await recentVerified('apply-test') : null;
const digestExpected = rehearsal ? priorDigest : mode === '--apply-test'
  ? null : testReceipt?.afterDigest;
const state = submitted && authorityPreserved && (rehearsal
  ? after.digest === priorDigest
  : after.digest !== priorDigest && (!digestExpected || after.digest === digestExpected))
  ? rehearsal ? 'rehearsed_rolled_back' : 'installed_verified' : 'requires_inspection';
const receipt = { state, mode, project, packageSha256,
  beforeDigest: before.digest, afterDigest: after.digest, authorityPreserved,
  fixtureTenantsBefore: before.fixtureTenants, fixtureTenantsAfter: after.fixtureTenants,
  syntheticFixtureInTestRehearsal: mode === '--rehearse-test',
  observedAt: new Date().toISOString(), providerRequests: 0, sourceDataWrites: false };
await writeFile(filename, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(receipt));
if (state !== 'installed_verified' && state !== 'rehearsed_rolled_back') process.exitCode = 1;
