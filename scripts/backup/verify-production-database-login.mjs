/** Narrow recovery preflight. Refreshes only the existing CLI login;
 * no password reset, role creation, customer export or network-ban changes.
 * A refreshed CLI credential still carries postgres privileges. The child
 * session is read-only; that setting does not reduce the credential's grants.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, writeSync, ftruncateSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { savedCliToken } from '../verify/learn-test-readiness.mjs';

const project = 'tgbnakbxwcqjeimygroz';
const image = 'sha256:28f0e16a019e648089fc1a6d333549a55548f6019c15ae4bd7cd58b989027518';
const docker = '/usr/local/bin/docker';
const folder = '.verification-results/database-login-preflight';
const report = { version: 'database-login-preflight/1', project,
  startedAt: new Date().toISOString(), state: 'preflight', productionDataWrites: false,
  customerDataExported: false, passwordReset: false, networkBanChanges: false };
let journal;
function save() {
  if (journal !== undefined) {
    const data = Buffer.from(JSON.stringify(report, null, 2));
    writeSync(journal, data, 0, data.length, 0); ftruncateSync(journal, data.length);
  }
}
function check(ok, message) { if (!ok) throw Error(message); }

try {
  check(process.argv.slice(2).join(' ') === '--refresh-existing-production-cli-login',
    'Explicit production CLI refresh mode required');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  // Exclusive journal prevents blind resubmission after an uncertain response.
  journal = openSync(folder + '/attempt-v5.json', 'wx', 0o600);
  save();
  const certificate = readFileSync(new URL('../../infrastructure/database-recovery/supabase-root-2021.crt', import.meta.url));
  report.caSha256 = createHash('sha256').update(certificate).digest('hex');
  check(report.caSha256 === '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7',
    'Supabase root certificate differs from reviewed official download');
  execFileSync(docker, ['image', 'inspect', image], { stdio: 'ignore' });
  const token = savedCliToken();
  async function api(path, body) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${project}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    check(response.ok, `Supabase recovery request failed (HTTP ${response.status})`);
    return response.json();
  }
  const roleQuery = `select rolname,rolcanlogin,rolvaliduntil,
    (select jsonb_agg(p.rolname order by p.rolname) from pg_auth_members m
     join pg_roles p on p.oid=m.roleid where m.member=r.oid) memberships
    from pg_roles r where rolname='cli_login_postgres'`;
  const roles = await api('/database/query/read-only', { query: roleQuery });
  check(roles.length === 1 && roles[0].rolcanlogin === true
    && JSON.stringify(roles[0].memberships) === '["postgres"]'
    && Number.isFinite(Date.parse(roles[0].rolvaliduntil)),
    'Expected existing CLI role not found; no refresh attempted');
  if (Date.parse(roles[0].rolvaliduntil) >= Date.now()) {
    // A prior completed attempt may refresh its own short-lived credential.
    // Ambiguous mutation/network outcomes never enter this branch.
    const prior = JSON.parse(readFileSync(folder + '/attempt-v4.json', 'utf8'));
    check(prior.state === 'refreshed' && prior.failure === 'Connection boundary mismatch'
      && prior.ttlSeconds === 300 && Date.parse(prior.startedAt) + 305000 > Date.now()
      && Date.parse(roles[0].rolvaliduntil) <= Date.parse(prior.startedAt) + 305000,
      'Active CLI credential is not the completed prior preflight; no refresh attempted');
  }
  report.beforeRole = roles[0];
  const pools = await api('/config/database/pooler');
  const primary = pools.filter(p => p.database_type === 'PRIMARY');
  check(primary.length === 1, 'Expected one primary pooler');
  const url = new URL(primary[0].connection_string.replace('[YOUR-PASSWORD]', ''));
  check(['postgresql:', 'postgres:'].includes(url.protocol) && url.username === `postgres.${project}`
    && url.hostname === 'aws-1-eu-west-2.pooler.supabase.com'
    && url.pathname === '/postgres' && !url.password, 'Unexpected pooler identity');
  report.endpoint = { host: url.hostname, port: 5432, mode: 'session' };
  report.state = 'refresh_requested'; save();
  // Same endpoint and read_only:false body as installed official CLI v2.40.7.
  // Exactly one request. Never retry an uncertain mutation automatically.
  const login = await api('/cli/login-role', { read_only: false });
  check(login.role === 'cli_login_postgres' && typeof login.password === 'string'
    && login.password.length >= 16 && !/[\r\n\0]/.test(login.password)
    && Number.isInteger(login.ttl_seconds) && login.ttl_seconds > 0
    && login.ttl_seconds <= 600, 'Unexpected refreshed credential metadata');
  report.state = 'refreshed'; report.ttlSeconds = login.ttl_seconds; save();
  const name = 'serviceos-recovery-login-' + Date.now();
  // Secret arrives only through stdin, never arguments, Docker Config.Env or logs.
  // TLS validates the known pooler hostname against the official Supabase root.
  const sql = `begin read only; set local role postgres;
    set local statement_timeout='20s';
    select json_build_object('currentUser',current_user,
    'sessionUser',session_user,'readOnly',current_setting('transaction_read_only'),
    'version',current_setting('server_version'),'tls',
    (select ssl from pg_stat_ssl where pid=pg_backend_pid())); commit;`;
  const args = ['run', '--rm', '-i', '--pull=never', '--name', name,
    '--log-driver', 'none', '--security-opt', 'no-new-privileges',
    '--memory', '256m', '--cpus', '1', '--pids-limit', '64',
    '-e', `PGHOST=${url.hostname}`, '-e', 'PGPORT=5432',
    '-e', `PGUSER=${login.role}.${project}`, '-e', 'PGDATABASE=postgres',
    '-e', 'PGSSLMODE=verify-full', '-e', 'PGSSLROOTCERT=/tmp/supabase-root.crt',
    '-e', 'PGCONNECT_TIMEOUT=15', '-e', 'PGAPPNAME=serviceos-recovery-preflight',
    '--entrypoint', 'bash', image, '-c',
    'IFS= read -r ca; printf %s "$ca" | base64 -d > /tmp/supabase-root.crt; IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -X -w -Atq -v ON_ERROR_STOP=1 -c "$1"',
    '--', sql];
  let result;
  try {
    result = spawnSync(docker, args, { input: certificate.toString('base64') + '\n' + login.password + '\n',
      encoding: 'utf8', timeout: 45000, maxBuffer: 128 * 1024 });
  } finally {
    login.password = '';
    spawnSync(docker, ['rm', '-f', name], { stdio: 'ignore', timeout: 15000 });
  }
  if (result.status !== 0) {
    const raw = String(result.stderr || '');
    report.connectionFailure = /certificate|root certificate|SSL/i.test(raw) ? 'tls_verification_failed'
      : /password authentication failed/i.test(raw) ? 'authentication_failed'
      : /timeout|timed out/i.test(raw) ? 'connection_timeout' : 'connection_failed';
    throw Error('Database connection check failed; raw output withheld');
  }
  const observed = JSON.parse(result.stdout.trim());
  report.connection = observed; save();
  check(observed.currentUser === 'postgres' && observed.sessionUser === 'cli_login_postgres'
    && observed.readOnly === 'on', 'Connection boundary mismatch');
  // pg_stat_ssl describes pooler -> PostgreSQL, not this libpq TLS session.
  // A successful libpq connection with verify-full proves the client boundary.
  report.clientTlsVerified = true;
  report.poolerUpstreamTlsObserved = observed.tls;
  report.afterRole = await api('/database/query/read-only', { query: roleQuery });
  report.state = 'read_only_connection_verified';
  report.completedAt = new Date().toISOString(); save();
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = error instanceof Error && !/fetch|JSON|Unexpected token/i.test(error.message)
    ? error.message : 'Recovery preflight failed; raw error withheld';
  save(); console.error(report.failure); process.exitCode = 1;
} finally { if (journal !== undefined) closeSync(journal); }
