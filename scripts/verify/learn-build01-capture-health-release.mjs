/** TEST-first bounded operator-health repair. Exact function/ACL guard, no source changes. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const mode = process.argv[2];
if (!["--rehearse-test", "--apply-test", "--rehearse-live", "--apply-live"].includes(mode)
  || process.argv.length !== 3) throw Error("Exact bounded release mode required");
const live = "tgbnakbxwcqjeimygroz";
const project = mode.endsWith("test") ? TEST_PROJECT : live;
const previous = "6617948c7d252d9faa273fc562f14089";
const path = "supabase/migrations/20261103170000_learn_capture_health_bounded.sql";
const sql = await readFile(path, "utf8");
const packageSha256 = createHash("sha256").update(sql).digest("hex");
const directory = ".verification-results/learn-build01-capture-health-bounded";
await mkdir(directory, { recursive: true, mode: 0o700 });
const token = savedCliToken();
async function query(statement, readOnly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: statement }), redirect: "error", signal: AbortSignal.timeout(60000),
  });
  const rows = await response.json().catch(() => null);
  if (response.status !== 201 || !Array.isArray(rows)) throw Error(`Management query unconfirmed (HTTP ${response.status})`);
  return rows;
}
const meta = `select md5(pg_get_functiondef(oid)) digest,pg_get_userbyid(proowner) owner,
  prosecdef security_definer,proacl::text acl from pg_proc
  where oid='public.learn_operator_capture_health(uuid,text)'::regprocedure`;
const before = (await query(meta))[0];
if (before?.digest !== previous || before.owner !== "postgres" ||
  !before.security_definer || before.acl !== "{postgres=X/postgres,authenticated=X/postgres}")
  throw Error("Expected existing function and authority changed; inspect before release");
const freshReceipt = async (name) => {
  for (const file of await readdir(directory)) {
    if (!file.startsWith(`${name}-`) || !file.endsWith(".json")) continue;
    const receipt = JSON.parse(await readFile(`${directory}/${file}`, "utf8"));
    if (receipt.packageSha256 === packageSha256 && receipt.state ===
      (name.startsWith("rehearse") ? "rehearsed_rolled_back" : "installed_verified") &&
      Date.now() - Date.parse(receipt.observedAt) < 3600000) return true;
  }
  return false;
};
if (mode === "--apply-test" && !(await freshReceipt("rehearse-test")))
  throw Error("Fresh TEST rollback rehearsal required");
if (mode === "--rehearse-live" && !(await freshReceipt("apply-test")))
  throw Error("Verified TEST installation required");
if (mode === "--apply-live" &&
  (!(await freshReceipt("apply-test")) || !(await freshReceipt("rehearse-live"))))
  throw Error("Verified TEST and fresh LIVE rollback rehearsal required");
const suffix = `${mode.slice(2)}-${Date.now()}.json`;
const journal = `${directory}/${suffix}`;
await writeFile(journal, JSON.stringify({ state: "prepared_not_submitted", mode, project,
  packageSha256, before, startedAt: new Date().toISOString() }, null, 2) + "\n",
{ flag: "wx", mode: 0o600 });
let submitted = false;
try {
  const statement = mode.startsWith("--rehearse")
    ? sql.replace(/\ncommit;\s*$/i, "\nrollback;\n") : sql;
  await query(statement, false);
  submitted = true;
} catch {
  // A lost response is not permission to submit the same transaction again.
}
const after = (await query(meta))[0];
const preserved = before.owner === after.owner && before.acl === after.acl &&
  before.security_definer === after.security_definer;
const rehearsal = mode.startsWith("--rehearse");
const state = preserved && submitted &&
  (rehearsal ? after.digest === previous : after.digest !== previous)
    ? rehearsal ? "rehearsed_rolled_back" : "installed_verified"
    : "requires_inspection";
const result = { state, mode, project, packageSha256, beforeDigest: before.digest,
  afterDigest: after.digest, authorityPreserved: preserved, observedAt: new Date().toISOString() };
await writeFile(journal, JSON.stringify(result, null, 2) + "\n", { flag: "w", mode: 0o600 });
console.log(JSON.stringify(result));
if (state === "requires_inspection") process.exitCode = 1;
