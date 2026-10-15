/** Exact, fail-closed recurring Slack catch-up scheduler release. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const project = process.argv[2] === "--test" ? TEST_PROJECT
  : process.argv[2] === "--live" ? "tgbnakbxwcqjeimygroz" : null;
const mode = process.argv[3];
if (!project || !["--rehearse", "--apply"].includes(mode) || process.argv.length !== 4)
  throw Error("Exact target and release action required");
const schema = project === TEST_PROJECT ? "of_test_deploy" : "of_learn_deploy";
const name = "learn_slack_recurring_catchup_v1";
const sourcePath = "supabase/migrations/20261104020000_learn_slack_recurring_catchup.sql";
const source = readFileSync(sourcePath, "utf8");
const sourceSha256 = createHash("sha256").update(source).digest("hex");
if (!/^begin;\s/m.test(source) || !/^commit;\s*$/m.test(source))
  throw Error("Migration transaction shape changed");
const body = source.replace(/^begin;\s*$/m, "").replace(/^commit;\s*$/m, "");
const token = savedCliToken();
const endpoint = `https://api.supabase.com/v1/projects/${project}/database/query`;
async function query(sql, readOnly = true) {
  const response = await fetch(endpoint + (readOnly ? "/read-only" : ""), {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }),
    redirect: "error", signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const issue = await response.json().catch(() => ({}));
    throw Error(`Scoped SQL request failed (HTTP ${response.status}, ${String(issue?.code ?? issue?.error_code ?? "unknown")}, ${String(issue?.message ?? "unknown").slice(0, 200)})`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("Scoped SQL response changed");
  return rows;
}
const oldWindow = "ending:=least(boundary+interval '15 minutes',clock_timestamp()-interval '2 minutes');";
const newWindow = "ending:=least(boundary+case when boundary<clock_timestamp()-interval '1 day' then interval '72 hours' else interval '15 minutes' end,clock_timestamp()-interval '2 minutes');";
const stateSql = `with f as (select pg_get_functiondef('public.learn_slack_schedule_recurring(integer)'::regprocedure) body)
select md5(body) scheduler_md5,
 length(body)-length(replace(body,'${oldWindow.replaceAll("'", "''")}',''))=length('${oldWindow.replaceAll("'", "''")}') old_window,
 length(body)-length(replace(body,'${newWindow.replaceAll("'", "''")}',''))=length('${newWindow.replaceAll("'", "''")}') new_window,
 position('learn_slack_queue_recurring_threads' in body)>0 reply_gate,
 position('learn_slack_credential_field' in body)>0 credential_gate,
 (select count(*)::int from public.slack_recurring_channels where enabled) enabled_channels,
 (select count(*)::int from ${schema}.migrations where migration_name='${name}' and project_ref='${project}' and source_sha256='${sourceSha256}') exact_receipts,
 (select count(*)::int from ${schema}.migrations where migration_name='${name}' and project_ref='${project}') name_receipts
from f`;
async function state() {
  const rows = await query(stateSql), value = rows?.[0];
  if (rows.length !== 1 || !value || !/^[a-f0-9]{32}$/.test(value.scheduler_md5)
    || !["old_window", "new_window", "reply_gate", "credential_gate"].every(k => typeof value[k] === "boolean")
    || !["enabled_channels", "exact_receipts", "name_receipts"].every(k => Number.isInteger(value[k]) && value[k] >= 0))
    throw Error("Scheduler state readback changed");
  return value;
}
const before = await state();
const receiptPath = `.verification-results/learn-build01-slack-catchup-${project}-rehearsal.json`;
if (!before.reply_gate || !before.credential_gate) throw Error("Existing scheduler guard changed");
if (mode === "--rehearse" && (!before.old_window || before.new_window || before.name_receipts !== 0))
  throw Error("Unexpected scheduler or release ledger state");
let rehearsal = null;
if (mode === "--apply") {
  rehearsal = JSON.parse(readFileSync(receiptPath, "utf8"));
  if (rehearsal.state !== "rehearsed_rolled_back" || rehearsal.project !== project
    || rehearsal.sourceSha256 !== sourceSha256 || rehearsal.before?.scheduler_md5 !== before.scheduler_md5
    || !before.old_window || before.new_window || before.name_receipts !== 0
    || !Number.isFinite(Date.parse(rehearsal.observedAt))
    || Date.now() - Date.parse(rehearsal.observedAt) > 3600000)
    throw Error("Fresh exact rehearsal and matching prior state required");
}
const sql = `begin;
set local search_path=public,pg_catalog;
set local lock_timeout='5s';set local statement_timeout='50s';
do $$begin
 if (select md5(pg_get_functiondef('public.learn_slack_schedule_recurring(integer)'::regprocedure)))<>'${before.scheduler_md5}'
 or exists(select 1 from ${schema}.migrations where migration_name='${name}' and project_ref='${project}')
 then raise exception 'slack_catchup_precondition_changed';end if;
end$$;
${body}
do $$declare d text;begin
 d:=pg_get_functiondef('public.learn_slack_schedule_recurring(integer)'::regprocedure);
 if position('72 hours' in d)=0 or position('learn_slack_queue_recurring_threads' in d)=0
   or position('learn_slack_credential_field' in d)=0
   or has_function_privilege('anon','public.learn_slack_schedule_recurring(integer)','execute')
   or has_function_privilege('authenticated','public.learn_slack_schedule_recurring(integer)','execute')
   or not has_function_privilege('service_role','public.learn_slack_schedule_recurring(integer)','execute')
 then raise exception 'slack_catchup_postcondition_failed';end if;
end$$;
insert into ${schema}.migrations(source_sha256,migration_name,project_ref,applied_at)
 values('${sourceSha256}','${name}','${project}',clock_timestamp());
${mode === "--apply" ? "notify pgrst,'reload schema';" : ""}
select 'slack_catchup_patched' marker,md5(pg_get_functiondef('public.learn_slack_schedule_recurring(integer)'::regprocedure)) scheduler_md5;
${mode === "--apply" ? "commit;" : "rollback;"}`;
let mutationResponse = null, mutationFailure = null;
try { mutationResponse = await query(sql, false); }
catch (error) { mutationFailure = error instanceof Error ? error.message : "Scoped SQL failure"; }
const after = await state();
const installed = mutationResponse?.find(r => r.marker === "slack_catchup_patched");
const ok = !mutationFailure && /^[a-f0-9]{32}$/.test(installed?.scheduler_md5 ?? "")
  && before.enabled_channels === after.enabled_channels
  && (mode === "--rehearse"
    ? after.scheduler_md5 === before.scheduler_md5 && after.old_window && !after.new_window
      && after.name_receipts === 0
    : after.scheduler_md5 === installed.scheduler_md5 && !after.old_window && after.new_window
      && after.exact_receipts === 1 && after.name_receipts === 1);
const result = { state: ok ? mode === "--rehearse" ? "rehearsed_rolled_back" : "installed_verified"
  : "requires_inspection", observedAt: new Date().toISOString(), project,
  sourceSha256, before, installed: installed ?? null, after,
  ...(mutationFailure ? { mutationFailure } : {}),
  credentialsRead: 0, providerRequests: 0, subscriptionChanges: 0 };
if (mode === "--rehearse" && ok)
  writeFileSync(receiptPath, JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(result));
if (!ok) process.exitCode = 1;
