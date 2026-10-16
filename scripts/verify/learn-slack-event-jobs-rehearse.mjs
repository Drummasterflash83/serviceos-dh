/** Transactional TEST-only rehearsal for the inactive Slack hint job extension. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const files = ["supabase/migrations/20261104100000_learn_slack_event_jobs.sql",
  "supabase/migrations/20261104110000_learn_slack_event_worker.sql"];
const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
const sha256 = createHash("sha256").update(source).digest("hex");
const body = source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
const state = `select
 (select count(*) from public.learn_slack_event_hints) as hints,
 (select count(*) from information_schema.columns where table_schema='public'
   and table_name='learn_slack_event_hints' and column_name='job_id') as job_column,
 md5(pg_get_functiondef('public.learn_slack_event_record(uuid,text,text,text,text,text,text,text,text)'::regprocedure)) as recorder_md5,
 md5(pg_get_functiondef('public.learn_slack_claim_jobs(uuid,integer)'::regprocedure)) as claim_md5,
 to_regprocedure('public.learn_slack_event_context(uuid,uuid,text,integer)') is not null as context_present,
 to_regprocedure('public.learn_slack_event_commit(uuid,uuid,text,integer,jsonb,boolean,boolean)') is not null as commit_present`;

async function query(sql, readOnly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly ? "/read-only" : ""}`,
    { method: "POST", headers: { Authorization: `Bearer ${savedCliToken()}`,
      "content-type": "application/json" },
      body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }),
      redirect: "error", signal: AbortSignal.timeout(45000) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw Error(String(payload.message ?? "slack_event_rehearsal_failed").split("\n")[0].slice(0, 240));
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("slack_event_rehearsal_response_invalid");
  return rows;
}

async function main() {
  const mode = process.argv[2];
  if (!["--test-rollback", "--apply-test"].includes(mode) ||
      process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
    throw Error("explicit_test_release_mode_required");
  const rehearsalFile = ".verification-results/learn-slack-event-jobs-test-rehearsal.json";
  const before = (await query(state))[0];
  if (before?.hints !== 0 || before.job_column !== 0 ||
      before.context_present !== false || before.commit_present !== false ||
      typeof before.recorder_md5 !== "string" || typeof before.claim_md5 !== "string")
    throw Error("slack_event_test_prerequisite_changed");
  if (mode === "--apply-test") {
    const prior = JSON.parse(readFileSync(rehearsalFile, "utf8"));
    if (prior.state !== "test_rollback_verified" || prior.sha256 !== sha256 ||
        prior.beforeDigest !== before.recorder_md5 ||
        prior.claimBeforeDigest !== before.claim_md5 ||
        Date.now() - Date.parse(prior.completedAt) > 3600000)
      throw Error("fresh_exact_test_rehearsal_required");
  }
  const rows = await query(`begin;\n${body}\n${state};\n${mode === "--test-rollback" ? "rollback" : "commit"};`, false);
  const staged = rows.find((row) => row.job_column === 1);
  const after = (await query(state))[0];
  if (!staged || staged.hints !== 0 || staged.context_present !== true ||
      staged.commit_present !== true || staged.claim_md5 === before.claim_md5 ||
      staged.recorder_md5 === before.recorder_md5 ||
      (mode === "--test-rollback"
        ? JSON.stringify(after) !== JSON.stringify(before)
        : JSON.stringify(after) !== JSON.stringify(staged)))
    throw Error("slack_event_rehearsal_readback_mismatch");
  const receipt = { state: mode === "--test-rollback" ? "test_rollback_verified" : "test_installed_inactive", sha256,
    beforeDigest: before.recorder_md5, stagedDigest: staged.recorder_md5,
    claimBeforeDigest: before.claim_md5, claimStagedDigest: staged.claim_md5,
    completedAt: new Date().toISOString(),
    hintsPersisted: after.hints, receiverActive: false,
    slackAppChanged: false, productionWrites: false };
  if (mode === "--test-rollback") writeFileSync(rehearsalFile,
    JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(receipt));
}
main().catch((error) => {
  console.error(JSON.stringify({ state: "slack_event_rehearsal_unconfirmed",
    code: error instanceof Error ? error.message : "unknown" }));
  process.exitCode = 1;
});
