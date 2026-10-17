/** Exact additive operator task route. Rehearsal rolls back all database changes. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const [mode, environment] = process.argv.slice(2);
if (process.argv.length !== 4 || !["rehearse", "apply", "readback"].includes(mode) ||
    !["test", "live"].includes(environment)) throw Error("Exact mode and environment required");
const project = environment === "test" ? TEST_PROJECT : "tgbnakbxwcqjeimygroz";
const migration = "20261105140000_learn_operator_job_review_action";
const source = readFileSync(new URL(`../../supabase/migrations/${migration}.sql`, import.meta.url), "utf8");
const sha = value => createHash("sha256").update(value).digest("hex");
const sourceSha256 = sha(source);
const root = ".verification-results/learn-build01-operator-job-review";
mkdirSync(root, { recursive: true, mode: 0o700 });
const path = name => `${root}/${environment}-${name}.json`;
const save = (name, value) => writeFileSync(path(name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
const read = name => JSON.parse(readFileSync(path(name), "utf8"));
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const marker = "learn_commusoft_create_job_review_action";
const catalog = `select md5(pg_get_functiondef('public.openfolk_business_review(uuid,text,text,jsonb)'::regprocedure)) fingerprint,
  position(${quote(`when '${marker}'`)} in pg_get_functiondef('public.openfolk_business_review(uuid,text,text,jsonb)'::regprocedure))>0 route_present,
  has_function_privilege('authenticated','public.openfolk_business_review(uuid,text,text,jsonb)','execute') authenticated,
  not has_function_privilege('anon','public.openfolk_business_review(uuid,text,text,jsonb)','execute') anon_denied,
  not has_function_privilege('service_role','public.openfolk_business_review(uuid,text,text,jsonb)','execute') service_denied,
  to_regprocedure('public.learn_commusoft_create_job_review_action(uuid,uuid,text,uuid,text)') is not null task_writer_present`;
const ledger = environment === "test"
  ? `select source_sha256 digest from of_test_deploy.migrations where migration_name='${migration}'`
  : `select encode(sha256(convert_to(array_to_string(statements,''),'UTF8')),'hex') digest
      from supabase_migrations.schema_migrations where version='20261105140000'`;
async function query(sql, readOnly = true) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`,
    { method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }) },
  );
  const raw = await response.text();
  if (!response.ok) {
    let code = "unknown";
    try { code = JSON.parse(raw).code ?? code; } catch {}
    throw Error(`Operator task ${mode} HTTP ${response.status}, SQLSTATE ${code}`);
  }
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) throw Error("Database response shape changed");
  return value;
}
const current = (await query(catalog))[0];
if (!current || !current.authenticated || !current.anon_denied || !current.service_denied ||
    !current.task_writer_present) throw Error("Operator task prerequisites differ");
if (mode === "readback") {
  const applied = read("apply");
  const rows = await query(ledger);
  if (!current.route_present || current.fingerprint !== applied.afterFingerprint ||
      applied.sourceSha256 !== sourceSha256 || rows.length !== 1 || rows[0].digest !== sourceSha256)
    throw Error("Operator task installed contract differs");
  console.log(JSON.stringify({ state: "installed_verified", environment, sourceSha256,
    fingerprint: current.fingerprint, observedAt: new Date().toISOString() }));
  process.exit(0);
}
if (current.route_present) throw Error("Operator task route already exists; use readback");
if (mode === "apply") {
  const rehearsal = read("rehearse");
  if (rehearsal.sourceSha256 !== sourceSha256 || rehearsal.beforeFingerprint !== current.fingerprint ||
      rehearsal.state !== "rehearsed_rolled_back" ||
      Date.now() - Date.parse(rehearsal.observedAt) > 3600000)
    throw Error("Fresh exact rollback rehearsal required");
  if (environment === "live") {
    const test = JSON.parse(readFileSync(`${root}/test-apply.json`, "utf8"));
    if (test.sourceSha256 !== sourceSha256 || test.state !== "installed_verified")
      throw Error("Exact TEST installation required");
  }
}
const body = source.replace(/^begin;\s*$/m, "").replace(/^commit;\s*$/m, "");
const receipt = environment === "test"
  ? `insert into of_test_deploy.migrations(migration_name,source_sha256,project_ref)
      values('${migration}','${sourceSha256}','${project}');`
  : `insert into supabase_migrations.schema_migrations(version,name,statements)
      values('20261105140000','learn_operator_job_review_action',array[${quote(source)}]);`;
const sql = `begin; set local lock_timeout='5s'; set local statement_timeout='50s';
do $$begin if md5(pg_get_functiondef('public.openfolk_business_review(uuid,text,text,jsonb)'::regprocedure))
  is distinct from '${current.fingerprint}' then raise exception 'operator_task_baseline_changed';end if;end$$;
${body}
do $$begin if (select position(${quote(`when '${marker}'`)} in
  pg_get_functiondef('public.openfolk_business_review(uuid,text,text,jsonb)'::regprocedure)))=0
  then raise exception 'operator_task_route_missing';end if;end$$;
${mode === "apply" ? receipt : ""}
select md5(pg_get_functiondef('public.openfolk_business_review(uuid,text,text,jsonb)'::regprocedure)) after_fingerprint;
${mode === "apply" ? "commit" : "rollback"};`;
const rows = await query(sql, false);
const afterFingerprint = rows[0]?.after_fingerprint;
const after = (await query(catalog))[0];
if (!afterFingerprint || (mode === "rehearse" && (after.fingerprint !== current.fingerprint || after.route_present)) ||
    (mode === "apply" && (after.fingerprint !== afterFingerprint || !after.route_present)))
  throw Error("Operator task transaction requires inspection");
const result = { state: mode === "rehearse" ? "rehearsed_rolled_back" : "installed_verified",
  environment, sourceSha256, observedAt: new Date().toISOString(),
  beforeFingerprint: current.fingerprint, afterFingerprint };
save(mode, result);
console.log(JSON.stringify(result));
