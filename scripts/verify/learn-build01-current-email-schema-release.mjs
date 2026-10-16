/** Guarded TEST/LIVE release of an inactive, service-only Email selector. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const LIVE_PROJECT = "tgbnakbxwcqjeimygroz";
const mode = process.argv.slice(2).join(" ");
if (!["--rehearse-test", "--apply-test", "--rehearse-live", "--apply-live"].includes(mode))
  throw Error("Explicit current-Email schema release mode required");
const live = mode.endsWith("-live");
const project = live ? LIVE_PROJECT : TEST_PROJECT;
if ((live ? process.env.LEARN_LIVE_ALLOW_PROJECT_REF : process.env.LEARN_TEST_ALLOW_PROJECT_REF)
    !== project) throw Error("Explicit project allowlist required");
const rehearsal = mode.startsWith("--rehearse-");
const source = readFileSync(
  "supabase/migrations/20261104130000_learn_email_current_projection_lane.sql", "utf8");
const sha256 = createHash("sha256").update(source).digest("hex");
const body = source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
const priorPath = `.verification-results/learn-build01-current-email-${live ? "live" : "test"}-schema-rehearsal.json`;
const stateSql = `select
 to_regprocedure('public.learn_projection_pending_current_email(uuid,integer)') is not null installed,
 to_regprocedure('public.learn_projection_pending(uuid,text,integer)') is not null legacy_present,
 to_regprocedure('public.learn_email_source_fields(public.email_messages)') is not null source_fields_present,
 (select i.indisvalid and i.indisready from pg_index i
  join pg_class c on c.oid=i.indexrelid where c.relname='learn_email_projection_order_idx') ordered_index_ready,
 (select p.prosecdef from pg_proc p where p.oid=
  to_regprocedure('public.learn_projection_pending_current_email(uuid,integer)')) security_definer,
 (select p.provolatile from pg_proc p where p.oid=
  to_regprocedure('public.learn_projection_pending_current_email(uuid,integer)')) volatility,
 (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid=
  to_regprocedure('public.learn_projection_pending_current_email(uuid,integer)')) function_md5,
 (select has_function_privilege('service_role',p.oid,'EXECUTE') from pg_proc p where p.oid=
  to_regprocedure('public.learn_projection_pending_current_email(uuid,integer)')) service_execute,
 (select has_function_privilege('authenticated',p.oid,'EXECUTE') from pg_proc p where p.oid=
  to_regprocedure('public.learn_projection_pending_current_email(uuid,integer)')) authenticated_execute`;
async function query(sql, readOnly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }),
  });
  if (!response.ok) throw Error(`Current Email schema HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("Current Email schema response invalid");
  return rows;
}
function ready(row) {
  return row?.installed === true && row.legacy_present === true &&
    row.source_fields_present === true && row.ordered_index_ready === true &&
    row.security_definer === true && row.volatility === "v" &&
    /^[a-f0-9]{32}$/.test(row.function_md5 ?? "") &&
    row.service_execute === true && row.authenticated_execute === false;
}
try {
  const before = (await query(stateSql))[0];
  if (before?.installed !== false || before.legacy_present !== true ||
      before.source_fields_present !== true || before.ordered_index_ready !== true)
    throw Error("Current Email schema baseline changed");
  if (!rehearsal) {
    const prior = JSON.parse(readFileSync(priorPath, "utf8"));
    if (prior.state !== "rehearsed_rolled_back" || prior.sourceSha256 !== sha256 ||
        Date.now() - Date.parse(prior.completedAt) > 3600000)
      throw Error("Fresh exact rollback rehearsal required");
  }
  let rows;
  try {
    rows = await query(`begin;\n${body}\n${stateSql};\n${rehearsal ? "rollback" : "commit"};`, false);
  } catch (error) {
    const afterUnknown = (await query(stateSql))[0];
    if (afterUnknown?.installed !== false)
      throw Error("Current Email schema outcome uncertain; inspect before retry");
    throw error;
  }
  const staged = rows.find(ready);
  const after = (await query(stateSql))[0];
  if (!staged || !after ||
      (rehearsal ? JSON.stringify(after) !== JSON.stringify(before)
        : !ready(after) || after.function_md5 !== staged.function_md5))
    throw Error("Current Email schema readback mismatch");
  const receipt = { state: rehearsal ? "rehearsed_rolled_back" : "installed_inactive",
    project, sourceSha256: sha256, functionMd5: staged.function_md5,
    completedAt: new Date().toISOString(), sourceRowsChanged: false,
    schedulerChanged: false, workerChanged: false, providerRequests: 0 };
  if (rehearsal) writeFileSync(priorPath, JSON.stringify(receipt, null, 2) + "\n",
    { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(receipt));
} catch (error) {
  console.error(JSON.stringify({ state: "current_email_schema_requires_inspection",
    code: error instanceof Error ? error.message : "unknown", secretPrinted: false }));
  process.exitCode = 1;
}
