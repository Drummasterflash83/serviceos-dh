/** Fresh TEST prerequisites for recurring threads; metadata and aggregate fingerprints only. */
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { INVESTMENT_CATALOG, INVESTMENT_PRESERVED } from "./learn-build-investment-catalog.mjs";
import {
  OPERATOR_HEALTH_CATALOG,
  OPERATOR_HEALTH_TABLES,
  OPERATOR_HEALTH_FUNCTIONS,
} from "./learn-operator-health-catalog.mjs";
import { RUNTIME_CATALOG_EXPRESSION } from "./learn-email-runtime-catalog.mjs";
import { RECURRING_TABLES, RECURRING_FUNCTIONS } from "./learn-slack-recurring-catalog.mjs";
const list = (xs) => xs.map((x) => "'" + x + "'").join(",");
export const AUTO_TABLES = [
  ...RECURRING_TABLES,
  "slack_thread_imports",
  "platform_jobs",
  "slack_recurring_thread_windows",
  "slack_recurring_thread_members",
];
export const AUTO_NEW_FUNCTIONS = [
  "learn_slack_recurring_threads_control",
  "learn_slack_recurring_thread_allowed",
  "learn_slack_recurring_thread_window_progress",
  "learn_slack_recurring_thread_window_complete",
  "learn_slack_recurring_threads_status",
  "learn_slack_queue_recurring_threads",
];
export const AUTO_FUNCTIONS = [
  ...RECURRING_FUNCTIONS,
  "learn_slack_read_thread_credential",
  "slack_thread_commit_page",
  "learn_slack_resume_thread",
  "learn_slack_thread_recovery_state",
  ...AUTO_NEW_FUNCTIONS,
];
const selected = OPERATOR_HEALTH_CATALOG.replace(`'runtime',${RUNTIME_CATALOG_EXPRESSION},`, "")
  .replace(list(OPERATOR_HEALTH_TABLES), list(AUTO_TABLES))
  .replace(list(OPERATOR_HEALTH_FUNCTIONS), list(AUTO_FUNCTIONS));
export const AUTO_CATALOG = `jsonb_build_object('base',${INVESTMENT_CATALOG},'slack',${selected})`;
export const AUTO_PRESERVED = [
  ...new Set([...INVESTMENT_PRESERVED, "public.slack_thread_imports"]),
];
// New default columns are excluded on both sides; all original subscription fields remain protected.
export const AUTO_SNAPSHOT = AUTO_PRESERVED.map((n) => {
  const row =
    n === "public.slack_recurring_channels"
      ? "(to_jsonb(s)-array['include_threads','thread_revision'])::text"
      : "row_to_json(s)::text";
  return `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(${row}),'' order by md5(${row})),'')) as fingerprint from ${n} s`;
}).join(" union all ");
export async function readAutoCatalog(token) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;select ${AUTO_CATALOG} as catalog,md5((${AUTO_CATALOG})::text) as fingerprint`,
  );
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(rows[0].fingerprint) ||
    !Array.isArray(rows[0].catalog?.slack?.functions)
  )
    throw Error("Recurring-thread catalog incomplete");
  return rows[0];
}
