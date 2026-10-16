/** Rollback-rehearse then install only the inactive public Slack event schema. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { savedCliToken } from "./learn-test-readiness.mjs";

const project = "tgbnakbxwcqjeimygroz";
const mode = process.argv.slice(2).join(" ");
if (!["--live-rollback", "--apply-live"].includes(mode) ||
    process.env.LEARN_LIVE_ALLOW_PROJECT_REF !== project)
  throw Error("Exact LIVE inactive schema mode required");
const files = [
  "supabase/migrations/20261104070000_learn_slack_event_hints.sql",
  "supabase/migrations/20261104100000_learn_slack_event_jobs.sql",
  "supabase/migrations/20261104110000_learn_slack_event_worker.sql",
  "supabase/migrations/20261104120000_learn_slack_event_pacing_profile.sql",
];
const sha256 = text => createHash("sha256").update(text).digest("hex");
const sources = files.map(file => readFileSync(file, "utf8"));
const sourceSha256 = sha256(sources.join("\n"));
const body = sources.map(source => source.replace(/^begin;\s*\n/, "")
  .replace(/\ncommit;\s*$/, "")).join("\n");
const token = savedCliToken();
const receiptPath = ".verification-results/learn-slack-event-live-schema-rehearsal.json";
const stateSql = `select
 to_regclass('public.learn_slack_event_hints') is not null hints_table,
 to_regprocedure('public.learn_slack_event_record(uuid,text,text,text,text,text,text,text,text)') is not null recorder,
 to_regprocedure('public.learn_slack_event_context(uuid,uuid,text,integer)') is not null context,
 to_regprocedure('public.learn_slack_finish_event_job(uuid,uuid,text,integer,jsonb)') is not null finish,
 md5(pg_get_functiondef('public.learn_capture_job_allowed(uuid,text,jsonb)'::regprocedure)) capture_gate_md5,
 md5(pg_get_functiondef('public.learn_slack_claim_jobs(uuid,integer)'::regprocedure)) claim_md5,
 md5(pg_get_functiondef('public.learn_capture_defer_job(uuid,uuid,text,integer,text)'::regprocedure)) defer_md5,
 (select count(*)::int from public.slack_recurring_channels where enabled) enabled_subscriptions`;
async function query(sql, readOnly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw Error(String(payload.message ?? `LIVE schema HTTP ${response.status}`).split("\n")[0].slice(0, 240));
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("LIVE schema response changed");
  return rows;
}
const prior = {
  hints_table: false, recorder: false, context: false, finish: false,
  capture_gate_md5: "a775d5552608ae0e222cee9ac3d3e51b",
  claim_md5: "2199de4d63581feac856cb1b29b3df80",
  defer_md5: "16fe7c5185fafd4a4f6cd4a0af40a6c9",
  enabled_subscriptions: 160,
};
const before = (await query(stateSql))[0];
if (JSON.stringify(before) !== JSON.stringify(prior))
  throw Error("LIVE Slack event schema baseline changed");
if (mode === "--apply-live") {
  const rehearsal = JSON.parse(readFileSync(receiptPath, "utf8"));
  if (rehearsal.state !== "rollback_verified" || rehearsal.sourceSha256 !== sourceSha256 ||
      JSON.stringify(rehearsal.before) !== JSON.stringify(before) ||
      Date.now() - Date.parse(rehearsal.completedAtUtc) > 3600000)
    throw Error("Fresh exact LIVE rollback proof required");
}
const rows = await query(`begin; set local lock_timeout='5s'; set local statement_timeout='45s';\n${body}\n${stateSql};\n${mode === "--live-rollback" ? "rollback" : "commit"};`, false);
const staged = rows.find(row => row?.hints_table === true && row.recorder === true &&
  row.context === true && row.finish === true && row.enabled_subscriptions === 160 &&
  row.capture_gate_md5 !== before.capture_gate_md5 &&
  row.claim_md5 !== before.claim_md5 && row.defer_md5 !== before.defer_md5);
const after = (await query(stateSql))[0];
if (!staged || JSON.stringify(after) !== JSON.stringify(
  mode === "--live-rollback" ? before : staged))
  throw Error("LIVE Slack event schema readback changed");
const receipt = { state: mode === "--live-rollback" ? "rollback_verified" : "installed_inactive",
  project, sourceSha256, before, staged, completedAtUtc: new Date().toISOString(),
  receiverActive: false, slackAppChanged: false,
  sourceProviderRequests: 0, sourceProviderWrites: 0 };
if (mode === "--live-rollback") writeFileSync(receiptPath,
  JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(receipt));
