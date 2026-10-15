/** Sanitised, read-only LIVE observations for Build 01's elapsed-day gate.
 * A snapshot is evidence at one instant, never proof of a full unattended day.
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
    const response = await fetcher(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
      redirect: "error",
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw Error(`${name} read-only observation failed (HTTP ${response.status})`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== "object")
      throw Error(`${name} observation shape differs`);
    return rows[0];
  }
  const source = await query(
    "source",
    `select
    (select count(*)::int from public.email_messages where tenant_id='${TENANT}'::uuid) email_messages,
    (select count(*)::int from public.email_messages m where m.tenant_id='${TENANT}'::uuid
      and not exists(select 1 from public.interactions i where i.tenant_id=m.tenant_id
       and i.source_table='email_messages' and i.source_id=m.id)) email_without_interaction,
    (select count(*)::int from public.email_messages m where m.tenant_id='${TENANT}'::uuid
      and m.provider='gmail' and m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb) email_drafts,
    (select count(*)::int from public.email_messages m where m.tenant_id='${TENANT}'::uuid
      and not coalesce(m.provider='gmail' and m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
      and not exists(select 1 from public.interactions i where i.tenant_id=m.tenant_id
       and i.source_table='email_messages' and i.source_id=m.id)) eligible_email_without_interaction,
    (select count(*)::int from public.phone_calls where tenant_id='${TENANT}'::uuid) phone_calls,
    (select count(*)::int from public.interactions where tenant_id='${TENANT}'::uuid and source_table='phone_calls') phone_interactions,
    (select count(*)::int from public.slack_messages where tenant_id='${TENANT}'::uuid) slack_messages,
    (select count(*)::int from public.interactions where tenant_id='${TENANT}'::uuid and source_table='slack_messages') slack_interactions,
    (select count(*)::int from public.interactions where tenant_id='${TENANT}'::uuid and processing_status in('ready','enriched')) eligible_interactions,
    (select count(*)::int from public.interactions i where i.tenant_id='${TENANT}'::uuid
      and i.processing_status in('ready','enriched') and not exists(select 1 from public.graph_nodes n
       where n.tenant_id=i.tenant_id and n.node_type='interaction' and n.source_table='interactions' and n.source_id=i.id)) eligible_missing_graph`,
  );
  const cards = await query(
    "cards",
    `select count(*)::int active_cards,
    count(*) filter(where context?'projection')::int projected_cards,
    count(*) filter(where (context#>>'{projection,generated_at}')::timestamptz>now()-interval '1 day')::int refreshed_last_day,
    count(*) filter(where context#>>'{projection,evidence,version}'='learn-card-inputs/1')::int evidence_v1
    from public.customer_cards where tenant_id='${TENANT}'::uuid and status<>'archived'`,
  );
  const jobs = await query(
    "jobs",
    `with selected as (
    select job_type,status,error_code,completed_at,updated_at,attempt_count,records_processed,
      row_number() over(partition by job_type order by created_at desc) n
    from public.platform_jobs where tenant_id='${TENANT}'::uuid
      and job_type in ('email.workspace_sync','commusoft.source_sync','interactions.sync',
       'identity.resolve','graph.sync','customer_card.sync','slack.history_sync')
  ), history as (
    select job_type,max(completed_at) filter(where status='succeeded') last_success_at,
      max(updated_at) filter(where status in('failed','dead_letter')) last_failure_at,
      count(*) filter(where status='succeeded' and completed_at>=now()-interval '1 hour')::int successes_last_hour,
      count(*) filter(where status in('failed','dead_letter') and updated_at>=now()-interval '1 hour')::int failures_last_hour
    from public.platform_jobs where tenant_id='${TENANT}'::uuid
      and job_type in ('email.workspace_sync','commusoft.source_sync','interactions.sync',
       'identity.resolve','graph.sync','customer_card.sync','slack.history_sync')
    group by job_type
  ) select jsonb_object_agg(s.job_type,jsonb_build_object('status',s.status,'errorCode',s.error_code,
    'updatedAt',s.updated_at,'completedAt',s.completed_at,'attempts',s.attempt_count,
    'recordsProcessed',s.records_processed,'lastSuccessAt',h.last_success_at,
    'lastFailureAt',h.last_failure_at,'successesLastHour',h.successes_last_hour,
    'failuresLastHour',h.failures_last_hour)) latest
    from selected s join history h on h.job_type=s.job_type where s.n=1`,
  );
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
  return {
    version: "learn-build01-working-day-readback/1",
    observedAt: new Date().toISOString(),
    projectRef: PROJECT,
    tenantId: TENANT,
    source,
    cards,
    latestJobs: jobs.latest ?? {},
    gmailAliases: aliases,
    scope:
      "One read-only instant; full-day continuity, manual intervention, backup and business acceptance require separate evidence.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).join(" ") !== "--live-read-only")
    throw Error("Exact read-only mode required");
  console.log(JSON.stringify(await readBuild01WorkingDay()));
}
