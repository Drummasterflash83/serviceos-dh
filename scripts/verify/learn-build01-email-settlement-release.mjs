/** Guarded TEST-first Email-only unchanged-receipt settlement release. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
const mode = process.argv.slice(2).join(" ");
if (!["--rehearse-test", "--apply-test", "--rehearse-live", "--apply-live"].includes(mode))
  throw Error("Exact Email settlement release mode required");
const project = mode.endsWith("test") ? TEST_PROJECT : "tgbnakbxwcqjeimygroz";
if ((project === TEST_PROJECT ? process.env.LEARN_TEST_ALLOW_PROJECT_REF
  : process.env.LEARN_LIVE_ALLOW_PROJECT_REF) !== project)
  throw Error("Exact project allowlist required");
const migration = await readFile("supabase/migrations/20261104212000_learn_email_unchanged_continuation.sql", "utf8");
const packageSha256 = createHash("sha256").update(migration).digest("hex");
const directory = ".verification-results/learn-build01-email-settlement";
await mkdir(directory, { recursive: true, mode: 0o700 });
const baseline = "5ad5d407c2d9445fa8231051a5ada9d1";
const token = savedCliToken();
async function query(sql, target = project, readOnly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${target}/database/query${readOnly ? "/read-only" : ""}`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, ...(!readOnly ? { read_only: false } : {}) }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw Error(`Email settlement query HTTP ${response.status} (${typeof detail.code === "string" ? detail.code : "unknown"})`);
  }
  return response.json();
}
async function catalog(target = project) {
  const rows = await query(`select md5(pg_get_functiondef(p.oid)) digest,
   pg_get_userbyid(p.proowner) owner,p.proacl::text acl,p.proconfig::text settings,
   position('processing_unchanged_receipts_unconfirmed' in pg_get_functiondef(p.oid))>0 unchanged_receipt_guard,
   position('then 50 else limit_n end' in pg_get_functiondef(p.oid))>0 email_batch_50
   from pg_proc p where p.oid='public.learn_processing_settle(uuid,uuid,text,integer,uuid,jsonb,text)'::regprocedure`, target);
  if (rows.length !== 1 || !rows[0].digest) throw Error("Settlement catalog unavailable");
  return rows[0];
}
async function hasReceipt(expectedMode, expectedState) {
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
    before.settings !== "{search_path=pg_catalog,TimeZone=UTC}" ||
    before.unchanged_receipt_guard || before.email_batch_50)
  throw Error("Exact Email settlement baseline changed");
if (mode === "--apply-test" && !(await hasReceipt("--rehearse-test", "rehearsed_rolled_back")))
  throw Error("Fresh TEST rehearsal required");
if (mode === "--rehearse-live" && !(await hasReceipt("--apply-test", "installed_verified")))
  throw Error("Verified TEST installation required");
if (mode === "--apply-live" && (!(await hasReceipt("--apply-test", "installed_verified")) ||
    !(await hasReceipt("--rehearse-live", "rehearsed_rolled_back"))))
  throw Error("Verified TEST and fresh LIVE rehearsal required");
if (mode === "--rehearse-live") {
  const test = await catalog(TEST_PROJECT);
  if (!test.unchanged_receipt_guard || !test.email_batch_50)
    throw Error("TEST Email settlement installation not verified");
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
} catch { /* Reconcile an uncertain acknowledgement against the catalog. */ }
const after = await catalog();
const preserved = before.owner === after.owner && before.acl === after.acl &&
  before.settings === after.settings;
const rehearsed = mode.startsWith("--rehearse");
const state = submitted && preserved && (rehearsed
  ? after.digest === baseline && !after.unchanged_receipt_guard && !after.email_batch_50
  : after.digest !== baseline && after.unchanged_receipt_guard && after.email_batch_50)
  ? rehearsed ? "rehearsed_rolled_back" : "installed_verified" : "requires_inspection";
const receipt = { state, mode, project, packageSha256, beforeDigest: before.digest,
  afterDigest: after.digest, ownerAndGrantsPreserved: preserved,
  unchangedReceiptGuard: after.unchanged_receipt_guard,
  emailBatch50: after.email_batch_50, sourceRowsChanged: false,
  providerRequests: 0, observedAt: new Date().toISOString() };
await writeFile(path, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(receipt));
if (state === "requires_inspection") process.exitCode = 1;
