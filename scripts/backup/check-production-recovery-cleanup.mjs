/** Read-only health/credential/session check after the reviewed recovery capture. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { savedCliToken } from '../verify/learn-test-readiness.mjs';

const mode = process.argv.slice(2).join(' ');
const root = mode === '--check-complete-capture-small-full'
  ? '.verification-results/production-database-complete-capture-small-full-2026-10-12'
  : mode === '--check-complete-capture-small'
  ? '.verification-results/production-database-complete-capture-small-2026-10-12'
  : '.verification-results/production-database-complete-capture-v2-2026-10-12';
if (!['--check-complete-capture-v2', '--check-complete-capture-small', '--check-complete-capture-small-full'].includes(mode)) {
  throw Error('Explicit completed-capture check required');
}
try {
  const result = await fetch('https://api.supabase.com/v1/projects/tgbnakbxwcqjeimygroz/database/query/read-only', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${savedCliToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `select jsonb_build_object(
      'healthy',true,'checkedAt',clock_timestamp(),
      'cliExpired',rolvaliduntil<clock_timestamp(),'cliExpiresAt',rolvaliduntil,
      'remainingCliSessions',(select count(*) from pg_stat_activity where usename='cli_login_postgres'),
      'memberships',(select jsonb_agg(p.rolname order by p.rolname) from pg_auth_members m
        join pg_roles p on p.oid=m.roleid where m.member=r.oid)) result
      from pg_roles r where rolname='cli_login_postgres'` }),
  });
  if (!result.ok) throw Error('Read-only recovery health check failed');
  const rows = await result.json();
  if (rows.length !== 1 || rows[0].result.healthy !== true) throw Error('Recovery health metadata missing');
  const report = rows[0].result;
  report.remainingLocalExportContainers = execFileSync('/usr/local/bin/docker',
    ['ps', '-a', '--filter', 'name=serviceos-export-', '--format', '{{.Names}}'],
    { encoding: 'utf8', timeout: 20000 }).trim().split('\n').filter(Boolean).length;
  report.unchangedRoleMembership = JSON.stringify(report.memberships) === '["postgres"]';
  delete report.memberships;
  report.productionDataWrites = false;
  writeFileSync(`${root}/production-cleanup-${Date.now()}.json`, JSON.stringify(report, null, 2) + '\n',
    { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify(report));
  if (report.remainingCliSessions || report.remainingLocalExportContainers || !report.unchangedRoleMembership) process.exitCode = 1;
} catch {
  console.error('Recovery health check incomplete; no credentials or raw responses disclosed');
  process.exitCode = 1;
}
