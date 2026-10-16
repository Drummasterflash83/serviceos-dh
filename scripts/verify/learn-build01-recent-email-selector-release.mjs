/** Guarded TEST/LIVE rollback rehearsal and schema-only Email selector release. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const LIVE_PROJECT = "tgbnakbxwcqjeimygroz";
const mode = process.argv.slice(2).join(" ");
if (!["--rehearse-test","--apply-test","--rehearse-live","--apply-live"].includes(mode))
  throw Error("Explicit recent-Email selector release mode required");
const live = mode.endsWith("-live");
const project = live ? LIVE_PROJECT : TEST_PROJECT;
if ((live ? process.env.LEARN_LIVE_ALLOW_PROJECT_REF :
  process.env.LEARN_TEST_ALLOW_PROJECT_REF) !== project)
  throw Error("Explicit project allowlist required");
const rehearsal = mode.startsWith("--rehearse-");
const source = readFileSync(
  "supabase/migrations/20261104160000_learn_email_recent_import_first.sql", "utf8");
const sourceSha256 = createHash("sha256").update(source).digest("hex");
const body = source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
const journal = `.verification-results/learn-build01-recent-email-selector-${live ? "live" : "test"}-rehearsal.json`;
const expectedBefore = live ? "eccd3929d3be927513b7237e503f2d7c" :
  "c5cf30c0855e27ce6ca70acf5b41cab3";
const stateSql = `select
  md5(pg_get_functiondef('public.learn_projection_pending(uuid,text,integer)'::regprocedure)) selector_md5,
  to_regclass('public.learn_email_projection_recent_import_idx') is not null recent_index,
  (select position('m.created_at>=clock_timestamp()-interval ''30 days''' in
    pg_get_functiondef('public.learn_projection_pending(uuid,text,integer)'::regprocedure))>0) recent_filter,
  (select position('order by m.created_at desc,m.id desc' in
    pg_get_functiondef('public.learn_projection_pending(uuid,text,integer)'::regprocedure))>0) recent_order,
  (select position('return query select * from public.learn_projection_pending_full' in
    pg_get_functiondef('public.learn_projection_pending(uuid,text,integer)'::regprocedure))>0) full_fallback,
  (select i.indisvalid and i.indisready from pg_index i where i.indexrelid=
    to_regclass('public.learn_email_projection_recent_import_idx')) index_ready`;
async function query(sql, readOnly = true) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`,
    { method: "POST", redirect: "error", signal: AbortSignal.timeout(120000),
      headers: { Authorization: `Bearer ${savedCliToken()}`,
        "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }) },
  );
  if (!response.ok) throw Error(`Recent Email schema HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("Recent Email schema response changed");
  return rows;
}
function installed(r) {
  return /^[a-f0-9]{32}$/.test(r?.selector_md5 ?? "") &&
    r.selector_md5 !== expectedBefore && r.recent_index === true &&
    r.recent_filter === true && r.recent_order === true &&
    r.full_fallback === true && r.index_ready === true;
}
try {
  const before = (await query(stateSql))[0];
  if (!before || before.selector_md5 !== expectedBefore ||
    before.recent_index !== false || before.recent_filter !== false ||
    before.recent_order !== false || before.full_fallback !== true)
    throw Error("Recent Email selector baseline changed");
  if (!rehearsal) {
    const prior = JSON.parse(readFileSync(journal, "utf8"));
    if (prior.state !== "rehearsed_rolled_back" ||
      prior.sourceSha256 !== sourceSha256 ||
      Date.now() - Date.parse(prior.completedAt) > 3600000)
      throw Error("Fresh exact rollback rehearsal required");
  }
  let rows;
  try {
    rows = await query(`begin;\n${body}\n${stateSql};\n${rehearsal ? "rollback" : "commit"};`, false);
  } catch (error) {
    const afterUnknown = (await query(stateSql))[0];
    if (afterUnknown?.selector_md5 !== expectedBefore || afterUnknown.recent_index !== false)
      throw Error("Recent Email schema outcome uncertain; inspect before retry");
    throw error;
  }
  const staged = rows.find(installed);
  const after = (await query(stateSql))[0];
  if (!staged || !after ||
    (rehearsal ? JSON.stringify(after) !== JSON.stringify(before)
      : !installed(after) || after.selector_md5 !== staged.selector_md5))
    throw Error("Recent Email schema readback mismatch");
  const receipt = { state: rehearsal ? "rehearsed_rolled_back" : "installed",
    project, sourceSha256, selectorMd5: staged.selector_md5,
    completedAt: new Date().toISOString(), sourceRowsChanged: false,
    schedulerChanged: false, workerChanged: false, providerRequests: 0 };
  if (rehearsal) writeFileSync(journal, JSON.stringify(receipt, null, 2) + "\n",
    { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(receipt));
} catch (error) {
  console.error(JSON.stringify({ state: "recent_email_selector_requires_inspection",
    code: error instanceof Error ? error.message : "unknown", secretPrinted: false }));
  process.exitCode = 1;
}
