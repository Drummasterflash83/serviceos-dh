/** TEST email-runtime metadata only. No credential or customer row values. */
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { EMAIL_HEALTH_PRESERVED_TABLES } from "./learn-test-email-health-release.mjs";
export const RUNTIME_FUNCTIONS = [
  "email_ingestion_account_guard_v2",
  "email_ingestion_checkpoint_json_v2",
  "email_ingestion_count_v2",
  "email_ingestion_evidence_v2",
  "email_ingestion_keys_v2",
  "email_ingestion_payload_v2",
  "email_ingestion_recovery_v2",
  "email_ingestion_run_guard_v2",
  "email_ingestion_transition_result_v2",
  "email_ingestion_transition_v2",
  "learn_operator_input_access",
  "learn_operator_input_immutable",
  "learn_slack_claim_jobs",
  "platform_jobs_claim",
  "platform_jobs_complete_email_v1",
  "phone_retry_state",
  "phone_pending_readiness",
  "phone_select_pending",
  "learn_capture_allowed",
  "learn_capture_control_state",
  "learn_operator_capture_controls",
  "learn_operator_capture_control_request",
  "learn_capture_admission",
  "learn_capture_job_allowed",
  "learn_capture_defer_job",
  "learn_email_transition_immutable",
  "learn_email_transition_prepare",
  "learn_email_transition_pending",
  "learn_email_transition_apply",
  "learn_email_job_attempt",
  "learn_email_attempt_lease",
  "learn_email_store_guard",
  "learn_email_store_existing",
  "learn_email_store_page",
  "learn_email_job_fail",
  "learn_email_enqueue",
];
export const RUNTIME_TABLES = [
  "tenants",
  "profiles",
  "feature_flags",
  "platform_jobs",
  "slack_workspace_pacing",
  "email_accounts",
  "email_sync_runs",
  "email_threads",
  "email_messages",
  "email_ingestion_checkpoints",
  "email_ingestion_transitions",
  "email_oauth_tokens",
  "google_workspace_connections",
  "google_workspace_mailboxes",
  "phone_recordings",
  "phone_transcripts",
  "phone_ai_insights",
  "phone_sync_runs",
  "learn_capture_control_requests",
  "learn_email_transition_requests",
  "learn_email_transition_settlements",
  "learn_email_job_attempts",
];
export const RUNTIME_PRESERVED = [
  ...new Set([
    ...EMAIL_HEALTH_PRESERVED_TABLES,
    "public.email_threads",
    "public.email_ingestion_checkpoints",
    "public.email_ingestion_transitions",
    "public.google_workspace_connections",
    "public.google_workspace_mailboxes",
    "public.phone_sync_runs",
    "public.phone_ai_insights",
    "public.slack_workspace_pacing",
  ]),
];
const list = (xs) => xs.map((x) => "'" + x + "'").join(",");
export const RUNTIME_CATALOG_EXPRESSION = `jsonb_build_object(
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${list(RUNTIME_FUNCTIONS)})),
 'tables',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname),'[]') from pg_constraint where conrelid=c.oid),
 'indexes',(select coalesce(jsonb_agg(indexdef order by indexname),'[]') from pg_indexes where schemaname='public' and tablename=c.relname),
 'policies',(select coalesce(jsonb_agg(to_jsonb(x) order by x.policyname),'[]') from pg_policies x where x.schemaname='public' and x.tablename=c.relname),
 'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(oid) order by tgname),'[]') from pg_trigger where tgrelid=c.oid and not tgisinternal)) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${list(RUNTIME_TABLES)}) and c.relkind='r'),
 'views',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_get_viewdef(c.oid),'options',c.reloptions,'acl',c.relacl::text) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='phone_recording_pipeline_state'),
 'ledger',(select jsonb_agg(jsonb_build_object('migration_name',migration_name,'source_sha256',source_sha256,'project_ref',project_ref) order by migration_name) from of_test_deploy.migrations)
)`;
export const RUNTIME_SNAPSHOT_QUERY = RUNTIME_PRESERVED.map(
  (n) =>
    `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`,
).join(" union all ");
export async function readRuntimeCatalog(token, options) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;select ${RUNTIME_CATALOG_EXPRESSION} as catalog,md5((${RUNTIME_CATALOG_EXPRESSION})::text) as fingerprint`,
    options,
  );
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(rows[0].fingerprint) ||
    !Array.isArray(rows[0].catalog?.functions)
  )
    throw Error("Email runtime catalog incomplete");
  return rows[0];
}
