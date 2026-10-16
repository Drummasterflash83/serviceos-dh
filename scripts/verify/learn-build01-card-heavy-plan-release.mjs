/** Exact TEST-first, rollback-rehearsed planner setting for card inputs. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
const LIVE_PROJECT = "tgbnakbxwcqjeimygroz";
const project = mode === "--test" ? TEST_PROJECT : mode === "--live" ? LIVE_PROJECT : null;
if (!project || (project === TEST_PROJECT ? process.env.LEARN_TEST_ALLOW_PROJECT_REF
  : process.env.LEARN_LIVE_ALLOW_PROJECT_REF) !== project)
  throw Error("Exact TEST or LIVE project allowlist required");
const label = project === TEST_PROJECT ? "test" : "live";
const prefix = `.verification-results/build01-card-heavy-plan-${label}`;
if (existsSync(`${prefix}-journal.json`) || existsSync(`${prefix}-result.json`))
  throw Error("Prior card heavy-plan release requires inspection");
const sha = (v) => createHash("sha256").update(v).digest("hex");
const migration = readFileSync(
  "supabase/migrations/20261104214000_learn_card_heavy_scan_plan.sql", "utf8");
const migrationSha256 = sha(migration);
const token = savedCliToken();
async function query(sql, readOnly) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, ...readOnly ? {} : { read_only: false } }),
    });
  if (!response.ok) throw Error(`Card plan query HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("Card plan query response changed");
  return rows;
}
const catalog = `select pg_get_functiondef(p.oid) definition,r.rolname owner,
 p.prosecdef security_definer,p.proconfig settings,
 has_function_privilege('service_role',p.oid,'EXECUTE') service_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 join pg_roles r on r.oid=p.proowner
 where n.nspname='public' and p.proname='learn_card_projection_inputs'
 and pg_get_function_identity_arguments(p.oid)='p_tenant uuid, p_card uuid'`;
async function state() {
  const rows = await query(catalog, true);
  if (rows.length !== 1 || typeof rows[0]?.definition !== "string")
    throw Error("Card function catalog changed");
  return rows[0];
}
const before = await state();
const expectedSource = "756f137b80b5fa9a89c2d47d451a7453b47e238ef588a47ac9dddd269f0aeb5f";
if (sha(before.definition) !== expectedSource || before.owner !== "postgres" ||
  before.security_definer !== true || before.service_execute !== true ||
  before.authenticated_execute !== false ||
  JSON.stringify(before.settings) !== JSON.stringify(["search_path=pg_catalog"]))
  throw Error("Exact card function baseline changed");
if (label === "live") {
  const tested = JSON.parse(readFileSync(
    ".verification-results/build01-card-heavy-plan-test-result.json", "utf8"));
  if (tested.state !== "card_heavy_plan_released" ||
    tested.migrationSha256 !== migrationSha256)
    throw Error("Exact TEST heavy-plan release not accepted");
}
writeFileSync(`${prefix}-journal.json`, JSON.stringify({ state: "prepared", project,
  baselineSha256: expectedSource, migrationSha256,
  rollbackSql: "alter function public.learn_card_projection_inputs(uuid,uuid) reset enable_bitmapscan" }, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
await query(`begin; ${migration} rollback;`, false);
const rehearsed = await state();
if (sha(rehearsed.definition) !== expectedSource ||
  JSON.stringify(rehearsed.settings) !== JSON.stringify(before.settings))
  throw Error("Card heavy-plan rollback rehearsal failed");
await query(migration, false);
const after = await state();
const expectedSettings = ["search_path=pg_catalog", "enable_bitmapscan=off"];
const passed = after.owner === before.owner &&
  after.security_definer === before.security_definer &&
  after.service_execute === before.service_execute &&
  after.authenticated_execute === before.authenticated_execute &&
  JSON.stringify(after.settings) === JSON.stringify(expectedSettings) &&
  after.definition.replace(" SET enable_bitmapscan TO 'off'\n", "") === before.definition;
const result = { state: passed ? "card_heavy_plan_released" : "requires_inspection",
  project, baselineSha256: expectedSource, afterSha256: sha(after.definition),
  migrationSha256, rollbackRehearsed: true,
  settings: after.settings, ownerAndGrantsPreserved: passed,
  sourceRowsChanged: false };
writeFileSync(`${prefix}-result.json`, JSON.stringify(result, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(result));
if (!passed) process.exitCode = 1;
