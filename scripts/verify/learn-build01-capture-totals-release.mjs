/** TEST-first operator totals RPC. Exact bounded-reader prerequisite and ACL readback. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const mode = process.argv[2];
if (!["--rehearse-test", "--apply-test", "--rehearse-live", "--apply-live"].includes(mode)
  || process.argv.length !== 3) throw Error("Exact separate-totals release mode required");
const live = "tgbnakbxwcqjeimygroz";
const project = mode.endsWith("test") ? TEST_PROJECT : live;
const prior = "7c52320c0d9f19a36af3909f51de0ff8";
const source = await readFile("supabase/migrations/20261103180000_learn_capture_totals_separate.sql", "utf8");
const sha256 = createHash("sha256").update(source).digest("hex");
const directory = ".verification-results/learn-build01-capture-totals";
await mkdir(directory, { recursive: true, mode: 0o700 });
const token = savedCliToken();
async function query(sql, readOnly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }), redirect: "error", signal: AbortSignal.timeout(60000),
  });
  const rows = await response.json().catch(() => null);
  if (response.status !== 201 || !Array.isArray(rows))
    throw Error(`Separate-totals query unconfirmed (HTTP ${response.status})`);
  return rows;
}
const meta = `select md5(pg_get_functiondef(oid)) digest,pg_get_userbyid(proowner) owner,
  prosecdef security_definer,proacl::text acl from pg_proc
  where oid='public.learn_operator_capture_totals(uuid)'::regprocedure`;
const bounded = (await query("select md5(pg_get_functiondef('public.learn_operator_capture_health(uuid,text)'::regprocedure)) digest"))[0];
const absent = (await query("select to_regprocedure('public.learn_operator_capture_totals(uuid)') is null absent"))[0];
if (bounded?.digest !== prior || absent?.absent !== true)
  throw Error("Exact bounded reader or absent totals function prerequisite changed");
async function receipt(name) {
  for (const file of await readdir(directory)) {
    if (!file.startsWith(`${name}-`) || !file.endsWith(".json")) continue;
    const r = JSON.parse(await readFile(`${directory}/${file}`, "utf8"));
    if (r.sha256 === sha256 && r.state === (name.startsWith("rehearse")
      ? "rehearsed_rolled_back" : "installed_verified") &&
      Date.now() - Date.parse(r.observedAt) < 3600000) return true;
  }
  return false;
}
if (mode === "--apply-test" && !(await receipt("rehearse-test")))
  throw Error("Fresh TEST rehearsal required");
if (mode === "--rehearse-live" && !(await receipt("apply-test")))
  throw Error("Verified TEST installation required");
if (mode === "--apply-live" &&
  (!(await receipt("apply-test")) || !(await receipt("rehearse-live"))))
  throw Error("Verified TEST and fresh LIVE rehearsal required");
const path = `${directory}/${mode.slice(2)}-${Date.now()}.json`;
await writeFile(path, JSON.stringify({ state: "prepared_not_submitted", mode, project, sha256 }) + "\n",
  { flag: "wx", mode: 0o600 });
let submitted = false;
try {
  await query(mode.startsWith("--rehearse")
    ? source.replace(/\ncommit;\s*$/i, "\nrollback;\n") : source, false);
  submitted = true;
} catch {
  // Uncertain submissions require readback, not automatic replay.
}
const after = (await query("select to_regprocedure('public.learn_operator_capture_totals(uuid)') is null absent"))[0];
const rehearsal = mode.startsWith("--rehearse");
const installed = !after.absent ? (await query(meta))[0] : null;
const ok = submitted && (rehearsal ? after.absent :
  installed?.owner === "postgres" && installed.security_definer &&
  installed.acl === "{postgres=X/postgres,authenticated=X/postgres}" &&
  /^[a-f0-9]{32}$/.test(installed.digest));
const result = { state: ok ? rehearsal ? "rehearsed_rolled_back" : "installed_verified" : "requires_inspection",
  mode, project, sha256, boundedDigest: bounded.digest, installedDigest: installed?.digest ?? null,
  observedAt: new Date().toISOString() };
await writeFile(path, JSON.stringify(result, null, 2) + "\n", { flag: "w", mode: 0o600 });
console.log(JSON.stringify(result));
if (!ok) process.exitCode = 1;
