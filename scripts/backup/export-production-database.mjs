/** Native, consistent production recovery export. No production data writes.
 * Private files contain real data; never add them to Git or publish raw output.
 * Exactly one existing CLI credential refresh; no automatic mutation retry.
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { mkdirSync, readFileSync, openSync, writeFileSync, closeSync,
  appendFileSync, createWriteStream, renameSync, statfsSync } from 'node:fs';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { savedCliToken } from '../verify/learn-test-readiness.mjs';

const project = 'tgbnakbxwcqjeimygroz';
const image = 'sha256:28f0e16a019e648089fc1a6d333549a55548f6019c15ae4bd7cd58b989027518';
const root = '.verification-results/production-database-export-2026-10-12';
const docker = '/usr/local/bin/docker';
const report = { version: 'production-database-export/1', project,
  startedAt: new Date().toISOString(), state: 'preflight', customerDataDestination: 'private_local_only',
  productionDataWrites: false, restoreVerified: false };
const names = [];
let keeper, login, markerFile;
const check = (ok, message) => { if (!ok) throw Error(message); };
const ident = s => '"' + String(s).replaceAll('"', '""') + '"';
const literal = s => "'" + String(s).replaceAll("'", "''") + "'";
function privateJson(name, value) {
  const temp = `${root}/${name}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'w' });
  renameSync(temp, `${root}/${name}`);
}
function save() { privateJson('report.json', report); }
function clientArgs(name, app, command) {
  names.push(name);
  return ['run', '--rm', '-i', '--pull=never', '--name', name,
    '--log-driver', 'none', '--security-opt', 'no-new-privileges',
    '--memory', '512m', '--cpus', '1', '--pids-limit', '64',
    '-e', 'PGHOST=aws-1-eu-west-2.pooler.supabase.com', '-e', 'PGPORT=5432',
    '-e', `PGUSER=cli_login_postgres.${project}`, '-e', 'PGDATABASE=postgres',
    '-e', 'PGSSLMODE=verify-full', '-e', 'PGSSLROOTCERT=/tmp/supabase-root.crt',
    '-e', 'PGCONNECT_TIMEOUT=20', '-e', `PGAPPNAME=${app}`,
    '--entrypoint', 'bash', image, '-c',
    'set -e; IFS= read -r ca; printf %s "$ca" | base64 -d > /tmp/supabase-root.crt; ' +
    'IFS= read -r PGPASSWORD; export PGPASSWORD; exec ' + command];
}

try {
  check(process.argv.slice(2).join(' ') === '--export-production-for-isolated-restore',
    'Explicit production export mode required');
  execFileSync('git', ['check-ignore', '-q', root + '/database.dump']);
  // Do not reuse a directory/marker after an uncertain previous run.
  mkdirSync(root, { mode: 0o700 });
  markerFile = openSync(root + '/started', 'wx', 0o600); closeSync(markerFile);
  save();
  const disk = statfsSync(root);
  check(disk.bavail * disk.bsize >= 5 * 1024 * 1024 * 1024, 'Insufficient private export disk space');
  const certificate = readFileSync(new URL('../../infrastructure/database-recovery/supabase-root-2021.crt', import.meta.url));
  check(createHash('sha256').update(certificate).digest('hex') ===
    '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7', 'Official CA mismatch');
  execFileSync(docker, ['image', 'inspect', image], { stdio: 'ignore' });
  const token = savedCliToken();
  async function api(path, body) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${project}${path}`, {
      method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    check(r.ok, `Recovery API request failed (HTTP ${r.status})`); return r.json();
  }
  const before = await api('/database/query/read-only', { query: `select jsonb_build_object(
    'expired',rolvaliduntil<clock_timestamp(),'name',rolname,'memberships',
    (select jsonb_agg(p.rolname order by p.rolname) from pg_auth_members m
    join pg_roles p on p.oid=m.roleid where m.member=r.oid)) role
    from pg_roles r where rolname='cli_login_postgres'` });
  check(before.length === 1 && before[0].role.expired === true
    && JSON.stringify(before[0].role.memberships) === '["postgres"]', 'Expected expired existing CLI role not found');
  const pools = await api('/config/database/pooler');
  const selected = pools.filter(p => p.database_type === 'PRIMARY');
  check(selected.length === 1, 'Primary pooler ambiguous');
  const u = new URL(selected[0].connection_string.replace('[YOUR-PASSWORD]', ''));
  check(u.hostname === 'aws-1-eu-west-2.pooler.supabase.com' && u.username === `postgres.${project}`
    && u.pathname === '/postgres' && !u.password, 'Unexpected source database identity');
  report.state = 'credential_refresh_requested'; save();
  login = await api('/cli/login-role', { read_only: false });
  check(login.role === 'cli_login_postgres' && typeof login.password === 'string'
    && login.password.length >= 16 && !/[\r\n\0]/.test(login.password)
    && login.ttl_seconds > 0 && login.ttl_seconds <= 600, 'Unexpected temporary credential');
  report.credentialTtlSeconds = login.ttl_seconds;
  report.state = 'opening_snapshot'; save();
  const prefix = certificate.toString('base64') + '\n' + login.password + '\n';
  const nonce = randomUUID().replaceAll('-', '');
  keeper = spawn(docker, clientArgs('serviceos-export-snapshot-' + nonce,
    'serviceos-recovery-snapshot', 'psql -X -w -Atq -v ON_ERROR_STOP=1'), { stdio: ['pipe', 'pipe', 'pipe'] });
  let pending = null, keeperFailed = false;
  keeper.stderr.on('data', chunk => appendFileSync(root + '/snapshot-stderr.log', chunk, { mode: 0o600 }));
  keeper.on('error', () => { keeperFailed = true; pending?.reject(Error('Snapshot client unavailable')); });
  keeper.on('exit', code => { keeperFailed = true; if (code !== 0) pending?.reject(Error('Snapshot client failed; raw error withheld')); });
  createInterface({ input: keeper.stdout }).on('line', line => {
    if (!pending) return;
    if (line === pending.marker) { const task = pending; pending = null; clearTimeout(task.timer); task.resolve(task.lines); }
    else { pending.bytes += line.length; if (pending.bytes > 8 * 1024 * 1024) pending.reject(Error('Snapshot output exceeds metadata bound')); else pending.lines.push(line); }
  });
  async function sql(query) {
    check(!pending && !keeperFailed, 'Snapshot session unavailable');
    const marker = 'end_' + randomUUID().replaceAll('-', '');
    return new Promise((resolve, reject) => {
      pending = { marker, resolve, reject, lines: [], bytes: 0,
        timer: setTimeout(() => reject(Error('Snapshot query timed out')), 180000).unref() };
      keeper.stdin.write(query + '\n\\echo ' + marker + '\n');
    });
  }
  keeper.stdin.write(prefix);
  const opened = await sql(`begin isolation level repeatable read read only;
    set local role postgres; set local timezone='UTC'; set local datestyle='ISO, MDY';
    set local extra_float_digits=3; set local bytea_output='hex';
    set local statement_timeout='150s'; set local lock_timeout='5s';
    select json_build_object('snapshot',pg_export_snapshot(),'readOnly',current_setting('transaction_read_only'),
      'currentUser',current_user,'sessionUser',session_user,'observedAt',clock_timestamp());`);
  check(opened.length === 1, 'Snapshot metadata missing');
  const snapshot = JSON.parse(opened[0]);
  check(snapshot.readOnly === 'on' && snapshot.currentUser === 'postgres'
    && snapshot.sessionUser === 'cli_login_postgres' && /^[0-9A-F]+-[0-9A-F]+-\d+$/.test(snapshot.snapshot),
    'Read-only snapshot boundary mismatch');
  report.snapshot = snapshot; report.clientTlsVerified = true;
  const inventoryLines = await sql(`select json_build_object(
    'tables',(select json_agg(json_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,
      'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner)) order by n.nspname,c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind in ('r','p') and n.nspname not like 'pg_%' and n.nspname<>'information_schema'),
    'extensions',(select json_agg(json_build_object('name',e.extname,'version',e.extversion,
      'schema',n.nspname,'config',e.extconfig,'condition',e.extcondition) order by e.extname)
      from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
    'roles',(select json_agg(row_to_json(r) order by r.rolname) from pg_roles r where r.rolname not like 'pg_%'),
    'memberships',(select json_agg(json_build_object('role',r.rolname,'member',m.rolname,'grantor',g.rolname,
      'admin',a.admin_option,'inherit',a.inherit_option,'set',a.set_option) order by r.rolname,m.rolname)
      from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member
      join pg_roles g on g.oid=a.grantor));`);
  check(inventoryLines.length === 1, 'Source inventory missing');
  const inventory = JSON.parse(inventoryLines[0]);
  check(Array.isArray(inventory.tables) && inventory.tables.length >= 250 && inventory.tables.length <= 1000,
    'Unexpected source table inventory');
  privateJson('source-inventory.json', inventory);
  // pg_net owns these tables but does not mark them as extension configuration
  // data. pg_dump omits their rows even with --table. Capture typed native COPY
  // output inside the existing snapshot before the slower archive/fingerprint
  // work. These operational rows may contain credentials and stay private.
  const netTables = inventory.tables.filter(t => t.schema === 'net').map(t => t.name).sort();
  check(JSON.stringify(netTables) === '["_http_response","http_request_queue"]',
    'Unreviewed network extension table inventory');
  let supplement = '';
  for (const table of netTables) {
    const qualified = ident('net') + '.' + ident(table);
    const rows = await sql(`copy ${qualified} to stdout;`);
    supplement += `COPY ${qualified} FROM STDIN;\n` + rows.map(row => row + '\n').join('') + '\\.\n';
  }
  const sequenceState = await sql("select json_build_object('lastValue',last_value,'isCalled',is_called) from net.http_request_queue_id_seq;");
  const sequence = JSON.parse(sequenceState[0]);
  check(Number.isSafeInteger(sequence.lastValue) && typeof sequence.isCalled === 'boolean', 'Network sequence metadata invalid');
  supplement += `SELECT pg_catalog.setval('net.http_request_queue_id_seq',${sequence.lastValue},${sequence.isCalled});\n`;
  writeFileSync(root + '/net-tables.sql', supplement, { flag: 'wx', mode: 0o600 });
  report.netSupplement = { format: 'native-postgresql-copy', tables: netTables,
    bytes: Buffer.byteLength(supplement), sha256: createHash('sha256').update(supplement).digest('hex'),
    rowsUseExportedSnapshot: true, sequenceIsNonTransactional: true };
  report.state = 'exporting_native_archive'; save();
  console.log(JSON.stringify({ stage: report.state, tables: inventory.tables.length }));
  // pg_dump starts its own read-only transaction and imports this exact snapshot.
  // No schema/table exclusions: auth, storage, migrations and extension config
  // remain in the native archive when pg_dump has permission to include them.
  const output = createWriteStream(root + '/database.dump.partial', { flags: 'wx', mode: 0o600 });
  const dump = spawn(docker, clientArgs('serviceos-export-dump-' + nonce,
    'serviceos-recovery-pg-dump', `pg_dump -w --format=custom --compress=6 --role=postgres --snapshot=${snapshot.snapshot} --lock-wait-timeout=5s`),
    { stdio: ['pipe', 'pipe', 'pipe'] });
  let archiveBytes = 0; const archiveHash = createHash('sha256');
  dump.stdout.on('data', chunk => { archiveBytes += chunk.length; archiveHash.update(chunk);
    if (archiveBytes > 3 * 1024 * 1024 * 1024) dump.kill('SIGTERM'); });
  dump.stderr.on('data', chunk => appendFileSync(root + '/dump-stderr.log', chunk, { mode: 0o600 }));
  const exit = once(dump, 'close');
  dump.stdin.end(prefix); login.password = '';
  const deadline = setTimeout(() => dump.kill('SIGTERM'), 900000);
  try {
    await pipeline(dump.stdout, output);
    const [code] = await exit; check(code === 0, 'Native database export failed; raw output withheld');
  } finally { clearTimeout(deadline); }
  check(archiveBytes > 0 && archiveBytes <= 3 * 1024 * 1024 * 1024, 'Native archive size outside bound');
  renameSync(root + '/database.dump.partial', root + '/database.dump');
  report.archive = { bytes: archiveBytes, sha256: archiveHash.digest('hex') };
  report.state = 'fingerprinting_source_snapshot'; save();
  const fingerprints = [];
  for (const table of inventory.tables) {
    // ONLY avoids counting child rows twice; partitioned parents are retained
    // in the schema but have no physical rows of their own.
    const qualified = ident(table.schema) + '.' + ident(table.name);
    report.currentComparisonTable = table.schema + '.' + table.name; save();
    const lines = await sql(`select json_build_object('schema',${literal(table.schema)},'table',${literal(table.name)},
      'rows',count(*),'fingerprint',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')))
      from only ${qualified} t;`);
    check(lines.length === 1, 'Source fingerprint missing');
    fingerprints.push(JSON.parse(lines[0]));
    // A timeout must not discard already completed comparisons. This partial
    // file is deliberately distinct from the complete acceptance baseline.
    privateJson('source-fingerprints.partial.json', fingerprints);
    if (fingerprints.length % 25 === 0) console.log(JSON.stringify({ stage: report.state, tablesComplete: fingerprints.length }));
  }
  privateJson('source-fingerprints.json', fingerprints);
  await sql('rollback;'); keeper.stdin.end('\\q\n');
  report.state = 'export_complete_restore_unverified';
  report.tablesFingerprinted = fingerprints.length; report.completedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ stage: report.state, tables: fingerprints.length, archiveBytes }));
} catch (error) {
  report.failure = 'Native recovery export stopped; inspect stage and private evidence before retry';
  // Keep diagnostic text private; never print the original exception or SQL.
  report.privateFailureDetail = String(error?.message || 'Unknown failure');
  if (markerFile !== undefined) save();
  console.error(report.failure); process.exitCode = 1;
} finally {
  if (login) login.password = '';
  keeper?.stdin.destroy();
  for (const name of names) spawnSync(docker, ['rm', '-f', name], { stdio: 'ignore', timeout: 20000 });
}
