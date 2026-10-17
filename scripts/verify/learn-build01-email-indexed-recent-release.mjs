/** Exact-baseline TEST-first release for the indexed recent Email selector. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
if (!["--rehearse-test", "--apply-test", "--rehearse-live", "--apply-live"].includes(mode))
  throw Error("Exact indexed-recent Email release mode required");
const liveProject = "tgbnakbxwcqjeimygroz";
const project = mode.endsWith("test") ? TEST_PROJECT : liveProject;
if ((project === TEST_PROJECT ? process.env.LEARN_TEST_ALLOW_PROJECT_REF
  : process.env.LEARN_LIVE_ALLOW_PROJECT_REF) !== project)
  throw Error("Exact project allowlist required");

const migration = await readFile(
  "supabase/migrations/20261104214200_learn_email_indexed_recent_unlinked.sql", "utf8");
const packageSha256 = createHash("sha256").update(migration).digest("hex");
const directory = ".verification-results/learn-build01-email-indexed-recent";
await mkdir(directory, { recursive: true, mode: 0o700 });
const baseline = { [TEST_PROJECT]: "dc02928d4700ac5c15f92e81767f4e9f",
  [liveProject]: "2a0534eb8d0394bbec8b86714f4e7d1e" };
const token = savedCliToken();

async function query(sql, target = project, readOnly = true) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${target}/database/query${readOnly ? "/read-only" : ""}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(90000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, ...(!readOnly ? { read_only: false } : {}) }),
    });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw Error(`Indexed Email query HTTP ${response.status} (${detail?.code ?? "unknown"})`);
  }
  return response.json();
}

async function catalog(target = project) {
  const rows = await query(`select md5(pg_get_functiondef(p.oid)) digest,
    pg_get_userbyid(p.proowner) owner,p.proacl::text acl,p.proconfig::text settings,
    position('learn_projection_pending_email_updates' in pg_get_functiondef(p.oid)) update_pos,
    position('learn_projection_pending_email_recent' in pg_get_functiondef(p.oid)) helper_pos,
    to_regprocedure('public.learn_projection_pending_email_recent(uuid,integer)') is not null helper_present,
    (select pg_get_userbyid(h.proowner) from pg_proc h
      where h.oid=to_regprocedure('public.learn_projection_pending_email_recent(uuid,integer)')) helper_owner,
    (select h.proacl::text from pg_proc h
      where h.oid=to_regprocedure('public.learn_projection_pending_email_recent(uuid,integer)')) helper_acl,
    (select h.proconfig::text from pg_proc h
      where h.oid=to_regprocedure('public.learn_projection_pending_email_recent(uuid,integer)')) helper_settings,
    (select i.indisvalid and i.indisready from pg_index i join pg_class c on c.oid=i.indexrelid
      where c.relname='learn_email_projection_recent_import_idx'
        and i.indrelid='public.email_messages'::regclass) recent_index_valid
    from pg_proc p where p.oid='public.learn_projection_pending(uuid,text,integer)'::regprocedure`, target);
  if (rows.length !== 1 || !/^[a-f0-9]{32}$/.test(rows[0]?.digest) ||
      !Number.isInteger(rows[0]?.update_pos) || !Number.isInteger(rows[0]?.helper_pos))
    throw Error("Indexed Email catalog unavailable");
  return rows[0];
}
function safeCatalog(value) {
  return value.owner === "postgres" &&
    value.acl === "{postgres=X/postgres,service_role=X/postgres}" &&
    value.settings === "{search_path=pg_catalog,TimeZone=UTC,statement_timeout=45s}" &&
    value.update_pos > 0 && value.recent_index_valid === true;
}
function installed(value) {
  return safeCatalog(value) && value.helper_present === true &&
    value.helper_pos > 0 && value.helper_pos < value.update_pos &&
    value.helper_owner === "postgres" &&
    value.helper_acl === "{postgres=X/postgres,service_role=X/postgres}" &&
    value.helper_settings === "{search_path=pg_catalog,TimeZone=UTC,statement_timeout=10s}";
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
if (before.digest !== baseline[project] || !safeCatalog(before) ||
    before.helper_present || before.helper_pos !== 0)
  throw Error("Exact indexed Email baseline changed");
if (mode === "--apply-test" &&
    !(await recent("--rehearse-test", "rehearsed_rolled_back")))
  throw Error("Fresh TEST rollback rehearsal required");
if (mode === "--rehearse-live" || mode === "--apply-live") {
  if (!(await recent("--apply-test", "installed_verified")))
    throw Error("Verified TEST installation required");
  const test = await catalog(TEST_PROJECT);
  if (!installed(test)) throw Error("TEST indexed Email installation not verified");
  const fixture = JSON.parse(await readFile(`${directory}/test-fixture.json`, "utf8"));
  if (fixture.state !== "email_indexed_recent_fixture_verified" ||
      fixture.packageSha256 !== packageSha256 ||
      Date.now() - Date.parse(fixture.observedAt) >= 3600000)
    throw Error("Fresh TEST indexed Email fixture required");
}
if (mode === "--apply-live" &&
    !(await recent("--rehearse-live", "rehearsed_rolled_back")))
  throw Error("Fresh LIVE rollback rehearsal required");

const path = `${directory}/${mode.slice(2)}-${Date.now()}.json`;
await writeFile(path, JSON.stringify({ state: "prepared_not_submitted", mode,
  project, packageSha256, observedAt: new Date().toISOString() }, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
let submitted = false;
try {
  await query(mode.startsWith("--rehearse")
    ? migration.replace(/\ncommit;\s*$/i, "\nrollback;\n") : migration,
    project, false);
  submitted = true;
} catch { /* Reconcile uncertain acknowledgement against the catalog. */ }
const after = await catalog();
const rehearsed = mode.startsWith("--rehearse");
const preserved = before.owner === after.owner && before.acl === after.acl &&
  before.settings === after.settings;
const state = submitted && preserved && (rehearsed
  ? after.digest === before.digest && !after.helper_present && after.helper_pos === 0
  : after.digest !== before.digest && installed(after))
  ? rehearsed ? "rehearsed_rolled_back" : "installed_verified"
  : "requires_inspection";
const receipt = { state, mode, project, packageSha256,
  beforeDigest: before.digest, afterDigest: after.digest,
  beforeUpdatePosition: before.update_pos, beforeHelperPosition: before.helper_pos,
  afterUpdatePosition: after.update_pos, afterHelperPosition: after.helper_pos,
  helperPresent: after.helper_present, recentIndexValid: after.recent_index_valid,
  ownerAndGrantsPreserved: preserved, sourceRowsChanged: false,
  providerRequests: 0, observedAt: new Date().toISOString() };
await writeFile(path, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(receipt));
if (state === "requires_inspection") process.exitCode = 1;
