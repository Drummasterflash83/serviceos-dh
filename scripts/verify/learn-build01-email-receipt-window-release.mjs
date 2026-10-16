/** Guarded TEST-first rollback rehearsal and Email receipt-window release. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
const mode = process.argv.slice(2).join(" ");
if (!["--rehearse-test","--apply-test","--rehearse-live","--apply-live"].includes(mode))
  throw Error("Exact Email receipt-window release mode required");
const project = mode.endsWith("test") ? TEST_PROJECT : "tgbnakbxwcqjeimygroz";
if ((project === TEST_PROJECT ? process.env.LEARN_TEST_ALLOW_PROJECT_REF
  : process.env.LEARN_LIVE_ALLOW_PROJECT_REF) !== project)
  throw Error("Exact project allowlist required");
const migration = await readFile("supabase/migrations/20261104211000_learn_email_receipt_bounded_updates.sql", "utf8");
const packageSha256 = createHash("sha256").update(migration).digest("hex");
const directory = ".verification-results/learn-build01-email-receipt-window";
await mkdir(directory, { recursive: true, mode: 0o700 });
async function recent(expectedMode, expectedState) {
  for (const name of await readdir(directory)) {
    if (!name.startsWith(`${expectedMode.slice(2)}-`) || !name.endsWith(".json")) continue;
    const receipt = JSON.parse(await readFile(`${directory}/${name}`, "utf8"));
    if (receipt.mode === expectedMode && receipt.project ===
        (expectedMode.endsWith("test") ? TEST_PROJECT : "tgbnakbxwcqjeimygroz") &&
        receipt.packageSha256 === packageSha256 && receipt.state === expectedState &&
        Date.now() - Date.parse(receipt.observedAt) < 3600000) return true;
  }
  return false;
}
const headers = { Authorization: `Bearer ${savedCliToken()}`,
  "Content-Type": "application/json" };
async function query(statement, readOnly = true, target = project) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${target}/database/query${readOnly ? "/read-only" : ""}`, {
    method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(90000),
    body: JSON.stringify({ query: statement, ...(readOnly ? {} : { read_only: false }) }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw Error(`Email receipt-window query HTTP ${response.status} (${typeof detail.code === "string" ? detail.code : "unknown"})`);
  }
  return response.json();
}
async function catalog(target = project) {
  const rows = await query(`select
 md5(pg_get_functiondef('public.learn_projection_pending(uuid,text,integer)'::regprocedure)) wrapper_digest,
 pg_get_userbyid(p.proowner) wrapper_owner,p.proacl::text wrapper_acl,p.proconfig::text wrapper_settings,
 position('learn_projection_pending_bounded_fallback' in pg_get_functiondef(p.oid))>0 bounded_fallback,
 to_regprocedure('public.learn_projection_pending_email_updates(uuid,integer)') is not null updates_present,
 to_regprocedure('public.learn_projection_pending_bounded_fallback(uuid,text,integer)') is not null helper_present,
 (select i.indisvalid and i.indisready from pg_index i join pg_class c on c.oid=i.indexrelid
  where c.relname='learn_email_projection_updated_idx' and i.indrelid='public.email_messages'::regclass) updated_index_valid
 from pg_proc p where p.oid='public.learn_projection_pending(uuid,text,integer)'::regprocedure`, true, target);
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.wrapper_digest)
    throw Error("Email receipt-window catalog unavailable");
  return rows[0];
}
const before = await catalog();
const baseline = project === TEST_PROJECT ? "6df5eceae994dec6085656f9a2eb4db9"
  : "7d073a1af6e1fb5c32478af58e7d6221";
if (before.wrapper_digest !== baseline || before.wrapper_owner !== "postgres" ||
    before.wrapper_acl !== "{postgres=X/postgres,service_role=X/postgres}" ||
    before.wrapper_settings !== "{search_path=pg_catalog,TimeZone=UTC,statement_timeout=25s}" ||
    before.bounded_fallback || before.updates_present || before.helper_present ||
    before.updated_index_valid !== true)
  throw Error("Email receipt-window prerequisite changed");
if (mode === "--apply-test" && !(await recent("--rehearse-test", "rehearsed_rolled_back")))
  throw Error("Fresh TEST rollback rehearsal required");
if (mode === "--rehearse-live" && !(await recent("--apply-test", "installed_verified")))
  throw Error("Verified TEST installation required");
if (mode === "--apply-live" &&
    (!(await recent("--apply-test", "installed_verified")) ||
     !(await recent("--rehearse-live", "rehearsed_rolled_back"))))
  throw Error("Verified TEST and fresh LIVE rollback rehearsal required");
if (project !== TEST_PROJECT && mode === "--rehearse-live") {
  const test = await catalog(TEST_PROJECT);
  if (!test.bounded_fallback || !test.updates_present || !test.helper_present ||
      test.updated_index_valid !== true) throw Error("TEST installation not verified");
}
const file = `${directory}/${mode.slice(2)}-${Date.now()}.json`;
await writeFile(file, JSON.stringify({ state: "prepared_not_submitted", mode, project,
  packageSha256, before, observedAt: new Date().toISOString() }, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
let submitted = false;
try {
  await query(mode.startsWith("--rehearse")
    ? migration.replace(/\ncommit;\s*$/i, "\nrollback;\n") : migration, false);
  submitted = true;
} catch { /* Reconcile uncertain acknowledgement against the catalog. */ }
const after = await catalog();
const rehearsed = mode.startsWith("--rehearse");
const preserved = after.wrapper_owner === before.wrapper_owner &&
  after.wrapper_acl === before.wrapper_acl &&
  after.wrapper_settings === before.wrapper_settings;
const installed = after.wrapper_digest !== baseline && after.bounded_fallback &&
  after.updates_present && after.helper_present && after.updated_index_valid === true;
const state = submitted && preserved && (rehearsed
  ? after.wrapper_digest === baseline && !after.updates_present && !after.helper_present
  : installed) ? rehearsed ? "rehearsed_rolled_back" : "installed_verified"
  : "requires_inspection";
const receipt = { state, mode, project, packageSha256,
  beforeDigest: before.wrapper_digest, afterDigest: after.wrapper_digest,
  ownerAndGrantsPreserved: preserved, updatedIndexValid: after.updated_index_valid,
  boundedFallback: after.bounded_fallback, updatesPresent: after.updates_present,
  helperPresent: after.helper_present, observedAt: new Date().toISOString(),
  sourceRowsChanged: false, providerRequests: 0 };
await writeFile(file, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(receipt));
if (state === "requires_inspection") process.exitCode = 1;
