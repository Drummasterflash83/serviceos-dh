/** Aggregate-only LIVE readback for the exact saved 160-channel Slack handoff. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const campaign = "b54d246b-2818-44d1-ba05-ccbe2c6bd6c9";
const query = `select
  h.enabled historical_enabled, h.revision historical_revision,
  h.ends_at historical_end,
  x.outcome closure_outcome,
  x.created_at closure_at,
  x.snapshot->>'complete' historical_complete,
  x.snapshot->>'threadsComplete' historical_threads_complete,
  (select count(*)::int from public.slack_history_campaign_requests r
    cross join lateral jsonb_array_elements(r.receipt->'subscriptions') entry
    where r.id=x.request_id and r.tenant_id=h.tenant_id)
    recorded_handoff_subscriptions,
  (select count(*)::int from public.slack_history_campaign_requests r
    cross join lateral jsonb_array_elements(r.receipt->'subscriptions') entry
    where r.id=x.request_id and r.tenant_id=h.tenant_id
      and (entry->>'start')::timestamptz=h.ends_at
      and entry->>'includeThreads'='true') recorded_cutoff_and_reply_matches,
  (select count(*)::int from public.slack_history_campaign_channels m
    where m.campaign_id=h.id and m.tenant_id=h.tenant_id) campaign_channels,
  (select count(*)::int from public.slack_history_campaign_channels m
    join public.slack_recurring_channels s on s.account_id=m.account_id
      and s.tenant_id=m.tenant_id
    where m.campaign_id=h.id and m.tenant_id=h.tenant_id
      and s.enabled and s.include_threads) enabled_channel_and_reply_subscriptions,
  (select count(*)::int from public.slack_history_campaign_channels m
    join public.slack_recurring_channels s on s.account_id=m.account_id
      and s.tenant_id=m.tenant_id
    where m.campaign_id=h.id and m.tenant_id=h.tenant_id
      and s.next_start>=h.ends_at) subscriptions_at_or_past_cutoff,
  (select count(*)::int from public.slack_history_campaign_channels m
    join public.slack_recurring_channels s on s.account_id=m.account_id
      and s.tenant_id=m.tenant_id
    where m.campaign_id=h.id and m.tenant_id=h.tenant_id
      and s.current_import is not null) channels_with_recurring_window,
  (select count(*)::int from public.slack_history_campaign_channels m
    join public.slack_recurring_channels s on s.account_id=m.account_id
      and s.tenant_id=m.tenant_id
    where m.campaign_id=h.id and m.tenant_id=h.tenant_id
      and s.next_start>h.ends_at) channels_advanced_past_cutoff,
  (select min(s.next_start) from public.slack_history_campaign_channels m
    join public.slack_recurring_channels s on s.account_id=m.account_id
      and s.tenant_id=m.tenant_id
    where m.campaign_id=h.id and m.tenant_id=h.tenant_id) oldest_next_start,
  (select max(s.next_start) from public.slack_history_campaign_channels m
    join public.slack_recurring_channels s on s.account_id=m.account_id
      and s.tenant_id=m.tenant_id
    where m.campaign_id=h.id and m.tenant_id=h.tenant_id) newest_next_start,
  (select count(*)::int from public.slack_history_campaign_channels m
    join public.slack_recurring_channels s on s.account_id=m.account_id
      and s.tenant_id=m.tenant_id
    where m.campaign_id=h.id and m.tenant_id=h.tenant_id
      and s.next_start<clock_timestamp()-interval '1 day') channels_over_day_behind,
  (select count(*)::int from public.slack_history_imports i
    join public.slack_history_campaign_channels m on m.account_id=i.account_id
      and m.tenant_id=i.tenant_id
    where m.campaign_id=h.id and m.tenant_id=h.tenant_id
      and i.definition->>'recurringAccountId'=i.account_id::text
      and (i.definition->>'end')::timestamptz-(i.definition->>'start')::timestamptz>interval '15 minutes') long_catchup_windows_started,
  (select count(*)::int from public.slack_history_campaign_channels m
    join public.slack_recurring_channels s on s.account_id=m.account_id
      and s.tenant_id=m.tenant_id
    join public.slack_history_imports i on i.id=s.current_import
    join public.platform_jobs j on j.id=i.job_id and j.tenant_id=i.tenant_id
    where m.campaign_id=h.id and m.tenant_id=h.tenant_id
      and j.result->>'stopReason'='page_budget_exhausted') current_windows_page_exhausted,
  (select coalesce(jsonb_object_agg(last_state,total),'{}'::jsonb) from (
    select s.last_state,count(*)::int total
    from public.slack_history_campaign_channels m
    join public.slack_recurring_channels s on s.account_id=m.account_id
      and s.tenant_id=m.tenant_id
    where m.campaign_id=h.id and m.tenant_id=h.tenant_id
    group by s.last_state
  ) states) subscription_states,
  (select coalesce(jsonb_object_agg(status, total),'{}'::jsonb) from (
    select j.status, count(*)::int total
    from public.slack_history_campaign_channels m
    join public.slack_recurring_channels s on s.account_id=m.account_id
      and s.tenant_id=m.tenant_id
    join public.slack_history_imports i on i.id=s.current_import
      and i.tenant_id=s.tenant_id
    join public.platform_jobs j on j.id=i.job_id and j.tenant_id=i.tenant_id
    where m.campaign_id=h.id and m.tenant_id=h.tenant_id
    group by j.status
  ) states) current_channel_job_states,
  (select count(*)::int from public.slack_history_campaign_channels m
    join public.slack_recurring_channels s on s.account_id=m.account_id
      and s.tenant_id=m.tenant_id
    where m.campaign_id=h.id and m.tenant_id=h.tenant_id
      and s.next_start<h.ends_at) cutoff_regressions,
  (select count(*)::int from public.slack_history_campaign_channels m
    join public.connector_accounts a on a.id=m.account_id and a.tenant_id=m.tenant_id
    where m.campaign_id=h.id and m.tenant_id=h.tenant_id
      and a.settings->'slack_history' ? 'campaignId') retained_campaign_bindings
from public.slack_history_campaigns h
left join public.slack_history_campaign_closures x
  on x.campaign_id=h.id and x.tenant_id=h.tenant_id
where h.id='${campaign}'::uuid and h.tenant_id='${tenant}'::uuid`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(45000),
  },
);
if (!response.ok) throw Error(`Slack handoff readback failed (HTTP ${response.status})`);
const rows = await response.json();
const row = rows?.[0];
if (!Array.isArray(rows) || rows.length !== 1 || !row ||
    !["campaign_channels", "recorded_handoff_subscriptions",
      "recorded_cutoff_and_reply_matches", "enabled_channel_and_reply_subscriptions",
      "subscriptions_at_or_past_cutoff", "channels_with_recurring_window",
      "channels_advanced_past_cutoff", "long_catchup_windows_started",
      "current_windows_page_exhausted", "cutoff_regressions",
      "retained_campaign_bindings"]
      .every(key => Number.isInteger(row[key]) && row[key] >= 0))
  throw Error("Slack handoff readback shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  tenant, campaign, ...row, productionDataWrites: false,
  scope: "Aggregate handoff state only; scheduler and provider success require later observation." }));
