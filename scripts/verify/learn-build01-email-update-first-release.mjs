/** Guarded TEST-first rollback rehearsal and Email update-first selector release. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
const mode = process.argv.slice(2).join(" ");
if (!["--rehearse-test", "--apply-test", "--rehearse-live", "--apply-live"].includes(mode))
  throw Error("Exact Email update-first release mode required");
const project = mode.endsWith("test") ? TEST_PROJECT : "tgbnakbxwcqjeimygroz";
if ((project === TEST_PROJECT ? process.env.LEARN_TEST_ALLOW_PROJECT_REF
  : process.env.LEARN_LIVE_ALLOW_PROJECT_REF) !== project)
  throw Error("Exact project allowlist required");
const migration = await readFile("supabase/migrations/20261104213000_learn_email_update_first_wrapper.sql", "utf8");
const packageSha256 = createHash("sha256").update(migration).digest("hex");
const directory = ".verification-results/learn-build01-email-update-first";
await mkdir(directory, { recursive: true, mode: 0o700 });
const baseline = project === TEST_PROJECT ? "678c4167f2240d2c50f4b4610deceebb"
  : "fc08674aa8b078a028902d1e51906620";
const token = savedCliToken();
async function query(sql, target = project, readOnly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${target}/database/query${readOnly ? "/read-only" : ""}`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, ...(!readOnly ? { read_only: false } : {}) }),
  });
  const rows = await response.json().catch(() => null);
  if (!response.ok) throw Error(`Email update-first query HTTP ${response.status} (${rows?.code ?? rows?.[0]?.code ?? "unknown"}; ${String(rows?.message ?? rows?.[0]?.message ?? "").slice(0, 120)})`);
  return rows;
}
async function catalog(target = project) {
  const rows = await query(`select md5(pg_get_functiondef(p.oid)) digest,
   pg_get_userbyid(p.proowner) owner,p.proacl::text acl,p.proconfig::text settings,
   position('if p_source=''email'' then' in pg_get_functiondef(p.oid))>0 update_first,
   position('enable_nestloop' in pg_get_functiondef(p.oid))>0 hash_audit,
   to_regprocedure('public.learn_projection_pending_email_updates(uuid,integer)') is not null helper_present
   from pg_proc p where p.oid='public.learn_projection_pending(uuid,text,integer)'::regprocedure`, target);
  if (rows.length !== 1 || !rows[0].digest) throw Error("Email wrapper catalog unavailable");
  return rows[0];
}
async function recent(expectedMode, expectedState) {
  for (const name of await readdir(directory)) {
    if (!name.startsWith(expectedMode.slice(2) + "-") || !name.endsWith(".json")) continue;
    const receipt = JSON.parse(await readFile(`${directory}/${name}`, "utf8"));
    if (receipt.mode === expectedMode && receipt.state === expectedState &&
        receipt.packageSha256 === packageSha256 &&
        Date.now() - Date.parse(receipt.observedAt) < 3600000) return true;
  }
  return false;
}
const before = await catalog();
if (before.digest !== baseline || before.owner !== "postgres" ||
    before.acl !== "{postgres=X/postgres,service_role=X/postgres}" ||
    before.settings !== "{search_path=pg_catalog,TimeZone=UTC,statement_timeout=25s}" ||
    before.update_first || before.hash_audit || !before.helper_present)
  throw Error("Exact Email wrapper baseline changed");
if (mode === "--apply-test" && !(await recent("--rehearse-test", "rehearsed_rolled_back")))
  throw Error("Fresh TEST rehearsal required");
if (mode === "--rehearse-live" && !(await recent("--apply-test", "installed_verified")))
  throw Error("Verified TEST installation required");
if (mode === "--apply-live" && (!(await recent("--apply-test", "installed_verified")) ||
    !(await recent("--rehearse-live", "rehearsed_rolled_back"))))
  throw Error("Verified TEST and fresh LIVE rehearsal required");
if (mode === "--rehearse-live") {
  const test = await catalog(TEST_PROJECT);
  if (!test.update_first || !test.hash_audit ||
      test.settings !== "{search_path=pg_catalog,TimeZone=UTC,statement_timeout=45s}")
    throw Error("TEST update-first installation not verified");
}
const path = `${directory}/${mode.slice(2)}-${Date.now()}.json`;
await writeFile(path, JSON.stringify({ state: "prepared_not_submitted", mode, project,
  packageSha256, observedAt: new Date().toISOString() }, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
let submitted = false;
try {
  await query(mode.startsWith("--rehearse")
    ? migration.replace(/\ncommit;\s*$/i, "\nrollback;\n") : migration, project, false);
  submitted = true;
} catch { /* Reconcile uncertain acknowledgement against the catalog. */ }
const after = await catalog();
const preserved = after.owner === before.owner && after.acl === before.acl &&
  after.helper_present === before.helper_present;
const rehearsed = mode.startsWith("--rehearse");
const installed = after.digest !== baseline && after.update_first && after.hash_audit &&
  after.settings === "{search_path=pg_catalog,TimeZone=UTC,statement_timeout=45s}";
const state = submitted && preserved && (rehearsed
  ? after.digest === baseline && !after.update_first && !after.hash_audit &&
    after.settings === before.settings : installed)
  ? rehearsed ? "rehearsed_rolled_back" : "installed_verified" : "requires_inspection";
const receipt = { state, mode, project, packageSha256, beforeDigest: before.digest,
  afterDigest: after.digest, ownerAndGrantsPreserved: preserved,
  statementTimeout: after.settings, updateFirst: after.update_first,
  hashAudit: after.hash_audit, sourceRowsChanged: false,
  providerRequests: 0, observedAt: new Date().toISOString() };
await writeFile(path, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(receipt));
if (state === "requires_inspection") process.exitCode = 1;
