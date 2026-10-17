/** Counts-only provider-completed recurring windows in the exact public roster. */
import assert from 'node:assert/strict';
import { savedCliToken } from './learn-test-readiness.mjs';

if (process.argv.slice(2).join(' ') !== '--live-read-only')
  throw Error('Exact LIVE read-only mode required');
const project = 'tgbnakbxwcqjeimygroz';
const tenant = '00000000-0000-0000-0000-000000000001';
const campaign = 'b54d246b-2818-44d1-ba05-ccbe2c6bd6c9';
const cutoff = '2026-10-13T09:30:00Z';
const query = `with roster as materialized (
 select m.account_id from public.slack_history_campaign_channels m
 where m.campaign_id='${campaign}'::uuid and m.tenant_id='${tenant}'::uuid
), windows as materialized (
 select i.account_id,(i.definition->>'end')::timestamptz window_end,
  j.status,j.records_processed,j.metadata ? 'slack_page_v1' page_receipt,
  j.result->>'stopReason' stop_reason
 from roster r
 join public.slack_history_imports i on i.account_id=r.account_id
  and i.tenant_id='${tenant}'::uuid
 join public.platform_jobs j on j.id=i.job_id and j.tenant_id=i.tenant_id
 where i.definition->>'recurringAccountId'=i.account_id::text
  and (i.definition->>'start')::timestamptz>='${cutoff}'::timestamptz
), complete as materialized (
 select * from windows where status='succeeded'
  and stop_reason='window_pages_complete' and page_receipt
), by_account as (
 select account_id,max(window_end) latest from complete group by account_id
)
select (select count(*)::int from roster) roster_count,
 (select count(*)::int from windows) windows_started,
 (select count(*)::int from complete) provider_completed_windows,
 (select count(*)::int from complete where records_processed=0) completed_empty_windows,
 (select count(*)::int from complete where records_processed>0) completed_nonempty_windows,
 (select count(*)::int from by_account) channels_with_completed_window,
 (select count(*)::int from by_account
  where latest>=clock_timestamp()-interval '12 hours') channels_recent_12h,
 (select max(window_end) from complete) latest_completed_window_end,
 (select count(*)::int from windows where status='dead_letter') dead_letter_windows`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
if (!response.ok) throw Error(`Exact Slack window readback HTTP ${response.status}`);
const rows = await response.json();
const result = rows?.[0];
assert(Array.isArray(rows) && rows.length === 1 && result,
  'Exact Slack window result shape changed');
for (const key of ['roster_count','windows_started','provider_completed_windows',
  'completed_empty_windows','completed_nonempty_windows',
  'channels_with_completed_window','channels_recent_12h','dead_letter_windows'])
  assert(Number.isInteger(result[key]) && result[key] >= 0,
    `Exact Slack window count changed: ${key}`);
assert.equal(result.roster_count, 160, 'Approved public roster changed');
assert(result.channels_with_completed_window <= result.roster_count);
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  campaign, cutoff, ...result, messageBodiesReturned: false,
  productionDataWrites: false,
  scope: 'Provider-completed windows are checked intervals, not proof of real post-cutoff event delivery.' }));
