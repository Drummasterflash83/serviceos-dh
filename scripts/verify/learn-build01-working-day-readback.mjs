/** Sanitised, read-only LIVE observations for Build 01 acceptance.
 * A snapshot is evidence at one instant, never proof of unattended continuity.
 */
import { pathToFileURL } from "node:url";
import { savedCliToken } from "./learn-test-readiness.mjs";

const PROJECT = "tgbnakbxwcqjeimygroz";
const TENANT = "00000000-0000-0000-0000-000000000001";
const ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT}/database/query/read-only`;

export async function readBuild01WorkingDay({ token = savedCliToken(), fetcher = fetch } = {}) {
  if (typeof token !== "string" || token.length < 20)
    throw Error("Existing management login required");
  async function query(name, sql) {
    let response;
    try {
      response = await fetcher(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql }),
        redirect: "error",
        signal: AbortSignal.timeout(45000),
      });
    } catch {
      throw Error(`${name} read-only observation unavailable`);
    }
    if (!response.ok) throw Error(`${name} read-only observation failed (HTTP ${response.status})`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== "object")
      throw Error(`${name} observation shape differs`);
    return rows[0];
  }
  // Keep every original denominator, but read each large source once. The
  // previous scalar-subquery statement repeatedly scanned Email and Graph in
  // one 45-second management call and could time out despite healthy lanes.
  const emailSource = await query(
    "email_source",
    `with flags as materialized (
      select coalesce(m.provider='gmail' and
        m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false) draft,
        exists(select 1 from public.interactions i where i.tenant_id=m.tenant_id
          and i.source_table='email_messages' and i.source_id=m.id) has_interaction
      from public.email_messages m where m.tenant_id='${TENANT}'::uuid
    ) select count(*)::int email_messages,
      count(*) filter(where not has_interaction)::int email_without_interaction,
      count(*) filter(where draft)::int email_drafts,
      count(*) filter(where not draft and not has_interaction)::int eligible_email_without_interaction
    from flags`,
  );
  const communicationSource = await query(
    "communication_source",
    `select
    (select count(*)::int from public.phone_calls where tenant_id='${TENANT}'::uuid) phone_calls,
    (select count(*)::int from public.interactions where tenant_id='${TENANT}'::uuid and source_table='phone_calls') phone_interactions,
    (select count(*)::int from public.slack_messages where tenant_id='${TENANT}'::uuid) slack_messages,
    (select count(*)::int from public.interactions where tenant_id='${TENANT}'::uuid and source_table='slack_messages') slack_interactions,
    (select count(*)::int from public.interactions where tenant_id='${TENANT}'::uuid
      and source_table='email_messages' and processing_status='ready') email_identity_ready,
    (select count(*)::int from public.interactions where tenant_id='${TENANT}'::uuid
      and source_table='email_messages' and processing_status='identity_review') email_identity_review,
    (select count(*)::int from public.interactions where tenant_id='${TENANT}'::uuid
      and source_table='slack_messages' and processing_status='identity_review') slack_identity_review,
    (select count(*)::int from public.interactions where tenant_id='${TENANT}'::uuid and processing_status in('ready','enriched')) eligible_interactions`,
  );
  const graphSource = await query(
    "graph_source",
    `with existing as materialized (
      select distinct source_id from public.graph_nodes where tenant_id='${TENANT}'::uuid
        and node_type='interaction' and source_table='interactions'
    ) select count(*)::int eligible_missing_graph
      from public.interactions i left join existing n on n.source_id=i.id
      where i.tenant_id='${TENANT}'::uuid
        and i.processing_status in('ready','enriched') and n.source_id is null`,
  );
  const source = { ...emailSource, ...communicationSource, ...graphSource };
  const cards = await query(
    "cards",
    `select count(*)::int active_cards,
    count(*) filter(where context?'projection')::int projected_cards,
    count(*) filter(where not context?'projection'
      and updated_at<now()-interval '1 hour')::int unprojected_over_one_hour,
    min(updated_at) filter(where not context?'projection') oldest_unprojected_update,
    count(*) filter(where (context#>>'{projection,generated_at}')::timestamptz>now()-interval '1 day')::int refreshed_last_day,
    count(*) filter(where context#>>'{projection,evidence,version}'='learn-card-inputs/1')::int evidence_v1
    from public.customer_cards where tenant_id='${TENANT}'::uuid and status<>'archived'`,
  );
  const jobsLatest = await query(
    "jobs_latest",
    `with types(job_type) as (values
      ('email.workspace_sync'),('commusoft.source_sync'),('interactions.sync'),
      ('identity.resolve'),('graph.sync'),('customer_card.sync'),
      ('slack.history_sync'),('slack.thread_sync'))
    select jsonb_object_agg(t.job_type,jsonb_build_object(
      'status',j.status,'errorCode',j.error_code,'updatedAt',j.updated_at,
      'completedAt',j.completed_at,'attempts',j.attempt_count,
      'recordsProcessed',j.records_processed)) latest
    from types t join lateral (
      select status,error_code,updated_at,completed_at,attempt_count,records_processed
      from public.platform_jobs where tenant_id='${TENANT}'::uuid
        and job_type=t.job_type order by created_at desc limit 1
    ) j on true`,
  );
  const jobsHistory = await query(
    "jobs_history",
    `with history as (
    select job_type,max(completed_at) filter(where status='succeeded') last_success_at,
      max(updated_at) filter(where status in('failed','dead_letter')) last_failure_at,
      count(*) filter(where status='succeeded' and completed_at>=now()-interval '1 hour')::int successes_last_hour,
      count(*) filter(where status in('failed','dead_letter') and updated_at>=now()-interval '1 hour')::int failures_last_hour,
      count(*) filter(where status='dead_letter' and error_code in
        ('identity_review_required','projection_review_required')
        and updated_at>=now()-interval '1 hour')::int review_holds_last_hour,
      count(*) filter(where status in('failed','dead_letter') and error_code is distinct from
        'identity_review_required' and error_code is distinct from 'projection_review_required'
        and updated_at>=now()-interval '1 hour')::int operational_failures_last_hour
    from public.platform_jobs where tenant_id='${TENANT}'::uuid
      and job_type in ('email.workspace_sync','commusoft.source_sync','interactions.sync',
       'identity.resolve','graph.sync','customer_card.sync','slack.history_sync','slack.thread_sync')
    group by job_type
  ) select jsonb_object_agg(h.job_type,jsonb_build_object('lastSuccessAt',h.last_success_at,
    'lastFailureAt',h.last_failure_at,'successesLastHour',h.successes_last_hour,
    'failuresLastHour',h.failures_last_hour,'reviewHoldsLastHour',h.review_holds_last_hour,
    'operationalFailuresLastHour',h.operational_failures_last_hour)) history
    from history h`,
  );
  const latest = jobsLatest.latest ?? {}, history = jobsHistory.history ?? {};
  if (!latest || typeof latest !== "object" || Array.isArray(latest) ||
      !history || typeof history !== "object" || Array.isArray(history))
    throw Error("jobs read-only observation shape differs");
  const latestJobs = Object.fromEntries(Object.entries(latest).map(([jobType, row]) => [
    jobType, { ...row, ...(history[jobType] ?? {}) },
  ]));
  const aliases = await query(
    "gmail_aliases",
    `select count(*)::int active_aliases,
    count(*) filter(where m.status='active' and c.block_code is null)::int ready_aliases,
    max(c.updated_at) newest_checkpoint_at,
    min(c.updated_at) oldest_checkpoint_at
    from public.email_accounts a join public.google_workspace_mailboxes m
      on m.tenant_id=a.tenant_id and lower(m.email_address)=lower(a.email_address)
    join public.email_ingestion_checkpoints c on c.tenant_id=a.tenant_id
      and c.email_account_id=a.id and c.stream='recent'
    where a.tenant_id='${TENANT}'::uuid and a.provider='gmail'
      and a.status='active_dwd' and m.mailbox_type='alias'`,
  );
  const slackOngoing = await query(
    "slack_ongoing",
    `select count(*)::int campaign_channels,
      count(*) filter(where s.enabled and s.include_threads)::int channel_and_reply_enabled,
      count(*) filter(where s.current_import is not null)::int recurring_windows_started,
      count(*) filter(where s.next_start>h.ends_at)::int advanced_past_cutoff,
      count(*) filter(where s.next_start<h.ends_at)::int cutoff_regressions,
      max(s.updated_at) latest_subscription_update
    from public.slack_history_campaigns h
    join public.slack_history_campaign_channels m on m.campaign_id=h.id
      and m.tenant_id=h.tenant_id
    left join public.slack_recurring_channels s on s.account_id=m.account_id
      and s.tenant_id=m.tenant_id
    where h.id='b54d246b-2818-44d1-ba05-ccbe2c6bd6c9'::uuid
      and h.tenant_id='${TENANT}'::uuid`,
  );
  return {
    version: "learn-build01-working-day-readback/1",
    observedAt: new Date().toISOString(),
    projectRef: PROJECT,
    tenantId: TENANT,
    source,
    cards,
    latestJobs,
    gmailAliases: aliases,
    slackOngoing,
    scope:
      "One read-only instant; unattended continuity, backup and business acceptance require separate evidence.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).join(" ") !== "--live-read-only")
    throw Error("Exact read-only mode required");
  console.log(JSON.stringify(await readBuild01WorkingDay()));
}
