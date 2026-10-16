/** Aggregate-only LIVE observation for the exact Drummonds public Slack Events handoff. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const cutoff = "1791883800.000000";
const query = `select jsonb_build_object(
  'observedAt',clock_timestamp(),
  'hintCount',(select count(*)::int from public.learn_slack_event_hints h
    where h.tenant_id='${tenant}'::uuid),
  'hintStates',(select coalesce(jsonb_object_agg(state,total),'{}'::jsonb) from (
    select state,count(*)::int total from public.learn_slack_event_hints
    where tenant_id='${tenant}'::uuid group by state) x),
  'hintKinds',(select coalesce(jsonb_object_agg(hint_kind,total),'{}'::jsonb) from (
    select hint_kind,count(*)::int total from public.learn_slack_event_hints
    where tenant_id='${tenant}'::uuid group by hint_kind) x),
  'latestHintAt',(select max(received_at) from public.learn_slack_event_hints
    where tenant_id='${tenant}'::uuid),
  'oldestUnsettledAt',(select min(received_at) from public.learn_slack_event_hints
    where tenant_id='${tenant}'::uuid and state in ('pending','reconciling')),
  'eventJobStates',(select coalesce(jsonb_object_agg(status,total),'{}'::jsonb) from (
    select status,count(*)::int total from public.platform_jobs
    where tenant_id='${tenant}'::uuid and job_type='slack.event_sync'
    group by status) x),
  'postCutoffMessages',(select count(*)::int from public.slack_messages
    where tenant_id='${tenant}'::uuid and provider_timestamp::numeric >= ${cutoff}::numeric),
  'postCutoffReplies',(select count(*)::int from public.slack_messages
    where tenant_id='${tenant}'::uuid and provider_timestamp::numeric >= ${cutoff}::numeric
      and thread_timestamp is not null and thread_timestamp<>provider_timestamp),
  'eventHintsWithSavedSource',(select count(*)::int from public.learn_slack_event_hints h
    where h.tenant_id='${tenant}'::uuid and exists(
      select 1 from public.slack_messages m where m.tenant_id=h.tenant_id
        and m.source_external_id=h.team_id||':'||h.channel_id||':'||h.source_ts)),
  'latestSavedSourceTs',(select max(provider_timestamp::numeric) from public.slack_messages
    where tenant_id='${tenant}'::uuid)
) as observation`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ query }),
    redirect: "error", signal: AbortSignal.timeout(45000),
  });
if (!response.ok) throw Error(`LIVE Slack Events observation HTTP ${response.status}`);
const rows = await response.json();
const observation = rows?.[0]?.observation;
if (!Array.isArray(rows) || rows.length !== 1 || !observation ||
    !Number.isInteger(observation.hintCount) ||
    !Number.isInteger(observation.postCutoffMessages) ||
    !Number.isInteger(observation.postCutoffReplies))
  throw Error("LIVE Slack Events observation shape changed");
console.log(JSON.stringify({ project, tenant, ...observation,
  productionDataWrites: false, messageBodiesReturned: false }));
