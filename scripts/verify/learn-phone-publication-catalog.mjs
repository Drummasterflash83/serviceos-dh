/** Phone publication metadata and aggregate source fingerprints; no source values. */
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { AUTO_CATALOG, AUTO_PRESERVED } from "./learn-slack-auto-threads-catalog.mjs";
import {
  OPERATOR_HEALTH_CATALOG,
  OPERATOR_HEALTH_TABLES,
  OPERATOR_HEALTH_FUNCTIONS,
} from "./learn-operator-health-catalog.mjs";
import { RUNTIME_CATALOG_EXPRESSION } from "./learn-email-runtime-catalog.mjs";
const list = (xs) => xs.map((x) => "'" + x + "'").join(",");
export const PHONE_TABLES = [
  "phone_calls",
  "phone_recordings",
  "phone_sync_runs",
  "tenants",
  "tenant_connectors",
  "connector_accounts",
  "feature_flags",
  "learn_phone_capture_pages",
];
export const PHONE_FUNCTIONS = [
  "learn_capture_allowed",
  "learn_operator_capture_control_request",
  "learn_operator_input_immutable",
  "learn_phone_capture_flag_lock",
  "learn_phone_publish_page",
];
const selected = OPERATOR_HEALTH_CATALOG.replace(`'runtime',${RUNTIME_CATALOG_EXPRESSION},`, "")
  .replace(list(OPERATOR_HEALTH_TABLES), list(PHONE_TABLES))
  .replace(list(OPERATOR_HEALTH_FUNCTIONS), list(PHONE_FUNCTIONS));
export const PHONE_CATALOG = `jsonb_build_object('base',${AUTO_CATALOG},'phone',${selected})`;
export const PHONE_PRESERVED = [
  ...new Set([
    ...AUTO_PRESERVED,
    "public.slack_recurring_thread_windows",
    "public.slack_recurring_thread_members",
    "public.audit_logs",
    "storage.objects",
  ]),
];
export const PHONE_SNAPSHOT = PHONE_PRESERVED.map(
  (n) =>
    `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`,
).join(" union all ");
export async function readPhonePublicationCatalog(token, options) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;select ${PHONE_CATALOG} as catalog,md5((${PHONE_CATALOG})::text) as fingerprint`,
    options,
  );
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(rows[0].fingerprint) ||
    !Array.isArray(rows[0].catalog?.phone?.functions)
  )
    throw Error("Phone publication catalog incomplete");
  return rows[0];
}
