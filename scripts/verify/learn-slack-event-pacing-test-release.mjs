/** Guarded TEST-only rollback rehearsal and inactive pacing release. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
if (!["--test-rollback", "--apply-test"].includes(mode) ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
  throw Error("Explicit TEST pacing release mode required");
const filename = "supabase/migrations/20261104120000_learn_slack_event_pacing_profile.sql";
const source = readFileSync(filename, "utf8");
const sha256 = createHash("sha256").update(source).digest("hex");
const body = source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
const rehearsalPath = ".verification-results/learn-slack-event-pacing-test-rehearsal.json";
const stateQuery = `select
 md5(pg_get_functiondef('public.learn_slack_finish_event_job(uuid,uuid,text,integer,jsonb)'::regprocedure)) settle_md5,
 (select count(*)::int from public.learn_slack_event_hints) hints,
 (select count(*)::int from public.platform_jobs where job_type='slack.event_sync') event_jobs,
 has_function_privilege('service_role',
  'public.learn_slack_finish_event_job(uuid,uuid,text,integer,jsonb)'::regprocedure,'EXECUTE') service_execute,
 has_function_privilege('authenticated',
  'public.learn_slack_finish_event_job(uuid,uuid,text,integer,jsonb)'::regprocedure,'EXECUTE') authenticated_execute`;
async function query(sql, readOnly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly ? "/read-only" : ""}`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }),
  });
  if (!response.ok) throw Error(`TEST pacing query HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("TEST pacing result invalid");
  return rows;
}
function valid(row) {
  return row && /^[a-f0-9]{32}$/.test(row.settle_md5) &&
    Number.isSafeInteger(row.hints) && Number.isSafeInteger(row.event_jobs) &&
    typeof row.service_execute === "boolean" &&
    typeof row.authenticated_execute === "boolean";
}
try {
  const before = (await query(stateQuery))[0];
  if (!valid(before) || before.settle_md5 !== "e66e8f5651d7465c3d12e8bac2d569ba" ||
      before.hints !== 0 || before.event_jobs !== 0 ||
      before.service_execute !== true || before.authenticated_execute !== false)
    throw Error("TEST event pacing baseline changed");
  if (mode === "--apply-test") {
    const prior = JSON.parse(readFileSync(rehearsalPath, "utf8"));
    if (prior.state !== "test_rollback_verified" || prior.sourceSha256 !== sha256 ||
        prior.beforeDigest !== before.settle_md5 ||
        Date.now() - Date.parse(prior.completedAt) > 3600000)
      throw Error("Fresh exact TEST rollback rehearsal required");
  }
  const rows = await query(`begin;\n${body}\n${stateQuery};\n${mode === "--test-rollback" ? "rollback" : "commit"};`, false);
  const staged = rows.find(row => valid(row) && row.settle_md5 !== before.settle_md5);
  const after = (await query(stateQuery))[0];
  if (!staged || staged.hints !== 0 || staged.event_jobs !== 0 ||
      staged.service_execute !== true || staged.authenticated_execute !== false ||
      !valid(after) || JSON.stringify(after) !== JSON.stringify(
        mode === "--test-rollback" ? before : staged))
    throw Error("TEST event pacing readback mismatch");
  const receipt = { state: mode === "--test-rollback" ? "test_rollback_verified"
    : "test_installed_inactive", project: TEST_PROJECT, sourceSha256: sha256,
    beforeDigest: before.settle_md5, stagedDigest: staged.settle_md5,
    completedAt: new Date().toISOString(), hints: after.hints,
    eventJobs: after.event_jobs, receiverActive: false, slackAppChanged: false,
    productionWrites: false };
  if (mode === "--test-rollback") writeFileSync(rehearsalPath,
    JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(receipt));
} catch (error) {
  console.error(JSON.stringify({ state: "test_event_pacing_requires_inspection",
    code: error instanceof Error ? error.message : "unknown",
    secretPrinted: false }));
  process.exitCode = 1;
}
