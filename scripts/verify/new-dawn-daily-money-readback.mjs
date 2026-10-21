/** Private, read-only status for the exact Drummonds daily QuickBooks pair. */
import { pathToFileURL } from 'node:url';
import { savedCliToken } from './learn-test-readiness.mjs';

const project = 'tgbnakbxwcqjeimygroz';
const tenant = '00000000-0000-0000-0000-000000000001';
const connection = '04d68333-fc13-42c2-a500-789f386f015c';
const query = `select
 (select count(*)::integer from public.learn_quickbooks_daily_reports
  where tenant_id='${tenant}'::uuid and connection_id='${connection}'::uuid) policy_count,
 (select count(*)::integer from public.learn_quickbooks_daily_reports
  where tenant_id='${tenant}'::uuid and connection_id='${connection}'::uuid and enabled) enabled_count,
 (select max(report_date)::text from public.learn_quickbooks_daily_report_runs
  where tenant_id='${tenant}'::uuid and connection_id='${connection}'::uuid and state='complete') latest_complete_day,
 (select report_date::text from public.learn_quickbooks_daily_report_runs
  where tenant_id='${tenant}'::uuid and connection_id='${connection}'::uuid
  order by report_date desc limit 1) latest_run_day,
 (select state from public.learn_quickbooks_daily_report_runs
  where tenant_id='${tenant}'::uuid and connection_id='${connection}'::uuid
  order by report_date desc limit 1) latest_run_state`;

export function parseDailyMoneyStatus(rows) {
  const day = value => value === null ||
    (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
  if (!Array.isArray(rows) || rows.length !== 1) throw Error('daily_money_status_unconfirmed');
  const row = rows[0];
  if (!row || !Number.isInteger(row.policy_count) || row.policy_count < 0 ||
    row.policy_count > 1 || !Number.isInteger(row.enabled_count) ||
    row.enabled_count < 0 || row.enabled_count > row.policy_count ||
    !day(row.latest_complete_day) || !day(row.latest_run_day) ||
    !(row.latest_run_state === null ||
      ['claimed', 'prepared', 'complete', 'held'].includes(row.latest_run_state)) ||
    (row.latest_run_day === null) !== (row.latest_run_state === null) ||
    (row.latest_complete_day !== null && (row.latest_run_day === null ||
      row.latest_complete_day > row.latest_run_day)) ||
    (row.latest_run_state === 'complete' &&
      row.latest_complete_day !== row.latest_run_day))
    throw Error('daily_money_status_unconfirmed');
  return { policyPresent: row.policy_count === 1, enabled: row.enabled_count === 1,
    latestCompleteDay: row.latest_complete_day, latestRunDay: row.latest_run_day,
    latestRunState: row.latest_run_state };
}

export async function readLiveDailyMoneyStatus(request = fetch) {
  const response = await request(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${savedCliToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, read_only: true }),
  });
  if (!response.ok) throw Error(`daily_money_status_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 10_000) throw Error('daily_money_status_response_too_large');
  return { ...parseDailyMoneyStatus(JSON.parse(bytes.toString('utf8'))),
    checkedAt: new Date().toISOString(), project };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--live-read-only')
      throw Error('daily_money_read_only_scope_required');
    console.log(JSON.stringify(await readLiveDailyMoneyStatus()));
  } catch (error) {
    console.error(JSON.stringify({ state: 'stopped',
      reason: error instanceof Error && /^daily_money_[a-z_0-9]+$/.test(error.message)
        ? error.message : 'daily_money_status_unavailable' }));
    process.exitCode = 1;
  }
}
