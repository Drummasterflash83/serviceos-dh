/** TEST-only schema metadata and aggregate preservation; no source row values. */
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  OPERATOR_HEALTH_CATALOG,
  OPERATOR_HEALTH_TABLES,
  OPERATOR_HEALTH_FUNCTIONS,
  OPERATOR_HEALTH_PRESERVED,
} from "./learn-operator-health-catalog.mjs";
import { RUNTIME_CATALOG_EXPRESSION } from "./learn-email-runtime-catalog.mjs";
export const RECURRING_TABLES = [
  "connector_accounts",
  "tenant_connectors",
  "provider_connections",
  "slack_history_imports",
  "slack_messages",
  "slack_message_versions",
  "platform_authority_grants",
  "view_as_context",
  "slack_recurring_channels",
  "slack_recurring_requests",
];
export const RECURRING_FUNCTIONS = [
  "current_tenant_id",
  "current_user_role",
  "slack_version_immutable",
  "learn_slack_recurring_access",
  "learn_slack_recurring_control",
  "learn_slack_recurring_read",
  "learn_slack_schedule_recurring",
];
export const RECURRING_PRESERVED = [
  ...new Set([
    ...OPERATOR_HEALTH_PRESERVED,
    ...OPERATOR_HEALTH_TABLES.map((n) => "public." + n),
    "public.view_as_context",
    "public.slack_history_imports",
  ]),
];
const list = (xs) => xs.map((s) => "'" + s + "'").join(",");
const slack = OPERATOR_HEALTH_CATALOG.replace(`'runtime',${RUNTIME_CATALOG_EXPRESSION},`, "")
  .replace(list(OPERATOR_HEALTH_TABLES), list(RECURRING_TABLES))
  .replace(list(OPERATOR_HEALTH_FUNCTIONS), list(RECURRING_FUNCTIONS));
export const RECURRING_CATALOG = `jsonb_build_object('health',${OPERATOR_HEALTH_CATALOG},'slack',${slack},
 'indexes',(select coalesce(jsonb_agg(indexdef order by tablename,indexname),'[]') from pg_indexes where schemaname='public' and tablename in (${list(RECURRING_TABLES)})))`;
export const RECURRING_SNAPSHOT = RECURRING_PRESERVED.map(
  (n) =>
    `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`,
).join(" union all ");
export async function readRecurringCatalog(token) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;select ${RECURRING_CATALOG} as catalog,md5((${RECURRING_CATALOG})::text) as fingerprint`,
  );
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(rows[0].fingerprint) ||
    !Array.isArray(rows[0].catalog?.slack?.tables)
  )
    throw Error("Recurring catalog incomplete");
  return rows[0];
}
