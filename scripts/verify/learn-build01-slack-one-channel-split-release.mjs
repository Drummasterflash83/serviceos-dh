/** Exact guarded schema-only release for a completed campaign channel split. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const LIVE_PROJECT = "tgbnakbxwcqjeimygroz";
const mode = process.argv.slice(2).join(" ");
if (!["--rehearse-test", "--apply-test", "--rehearse-live", "--apply-live"].includes(mode))
  throw Error("Explicit Slack one-channel split release mode required");
const live = mode.endsWith("-live");
const project = live ? LIVE_PROJECT : TEST_PROJECT;
if ((live ? process.env.LEARN_LIVE_ALLOW_PROJECT_REF : process.env.LEARN_TEST_ALLOW_PROJECT_REF) !== project)
  throw Error("Explicit project allowlist required");
const rehearsal = mode.startsWith("--rehearse-");
const source = readFileSync("supabase/migrations/20261104170000_learn_slack_campaign_single_channel_split.sql", "utf8");
const sourceSha256 = createHash("sha256").update(source).digest("hex");
const body = source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
const journal = `.verification-results/learn-build01-slack-one-channel-split-${live ? "live" : "test"}-rehearsal.json`;
const expectedBefore = "84a55d7e950749ed723320ed0bd5f052";
const stateSql = `select
 md5(pg_get_functiondef('public.learn_slack_start_import(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,text)'::regprocedure)) function_md5,
 to_regclass('public.slack_recurring_one_enabled_channel') is not null unique_index,
 (select i.indisvalid and i.indisready from pg_index i where i.indexrelid=to_regclass('public.slack_recurring_one_enabled_channel')) index_ready,
 to_regprocedure('public.learn_slack_campaign_channel_progress(uuid,uuid)') is not null progress_exists,
 (select count(*) from (select tenant_id,team_id,channel_id from public.slack_recurring_channels where enabled group by 1,2,3 having count(*)>1) d) duplicate_enabled,
 (select position('slackSplitFrom' in pg_get_functiondef('public.learn_slack_start_import(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,text)'::regprocedure))>0) split_guard`;
async function query(sql, readOnly = true) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`,
    { method: "POST", redirect: "error", signal: AbortSignal.timeout(120000),
      headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }) },
  );
  if (!response.ok) throw Error(`Slack split schema HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("Slack split schema response changed");
  return rows;
}
const installed = r => /^[a-f0-9]{32}$/.test(r?.function_md5 ?? "") &&
  r.function_md5 !== expectedBefore && r.unique_index === true &&
  r.index_ready === true && r.progress_exists === true &&
  Number(r.duplicate_enabled) === 0 && r.split_guard === true;
try {
  const before = (await query(stateSql))[0];
  if (!before || before.function_md5 !== expectedBefore || before.unique_index !== false ||
      before.progress_exists !== true || before.split_guard !== false || Number(before.duplicate_enabled) !== 0)
    throw Error("Slack one-channel split baseline changed");
  if (!rehearsal) {
    const prior = JSON.parse(readFileSync(journal, "utf8"));
    if (prior.state !== "rehearsed_rolled_back" || prior.sourceSha256 !== sourceSha256 ||
        Date.now() - Date.parse(prior.completedAt) > 3600000)
      throw Error("Fresh exact rollback rehearsal required");
  }
  let rows;
  try {
    rows = await query(`begin;\n${body}\n${stateSql};\n${rehearsal ? "rollback" : "commit"};`, false);
  } catch (error) {
    const afterUnknown = (await query(stateSql))[0];
    if (afterUnknown?.function_md5 !== expectedBefore || afterUnknown.unique_index !== false)
      throw Error("Slack split schema outcome uncertain; inspect before retry");
    throw error;
  }
  const staged = rows.find(installed);
  const after = (await query(stateSql))[0];
  if (!staged || !after || (rehearsal ? JSON.stringify(after) !== JSON.stringify(before) :
    !installed(after) || after.function_md5 !== staged.function_md5))
    throw Error("Slack split schema readback mismatch");
  const receipt = { state: rehearsal ? "rehearsed_rolled_back" : "installed", project,
    sourceSha256, functionMd5: staged.function_md5,
    completedAt: new Date().toISOString(), sourceRowsChanged: false,
    subscriptionsChanged: false, providerRequests: 0 };
  if (rehearsal) writeFileSync(journal, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(receipt));
} catch (error) {
  console.error(JSON.stringify({ state: "slack_split_requires_inspection",
    code: error instanceof Error ? error.message : "unknown", secretPrinted: false }));
  process.exitCode = 1;
}
