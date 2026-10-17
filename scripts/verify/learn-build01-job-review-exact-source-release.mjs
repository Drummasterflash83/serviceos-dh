/** Exact one-job source lookup patch; rehearsals are rollback-only. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
const [mode, environment] = process.argv.slice(2);
if (process.argv.length !== 4 || !["rehearse", "apply", "readback"].includes(mode) ||
    !["test", "live"].includes(environment)) throw Error("Exact mode and environment required");
const project = environment === "test" ? TEST_PROJECT : "tgbnakbxwcqjeimygroz";
const migration = "20261105150000_learn_job_review_exact_source";
const source = readFileSync(new URL(`../../supabase/migrations/${migration}.sql`, import.meta.url), "utf8");
const sha = value => createHash("sha256").update(value).digest("hex");
const sourceSha256 = sha(source);
const baselineMd5 = "7ee47cd1df485df74388d207dbe86f5e";
const root = ".verification-results/learn-build01-job-review-exact-source";
mkdirSync(root, { recursive: true, mode: 0o700 });
const path = name => `${root}/${environment}-${name}.json`;
const save = (name, value) => writeFileSync(path(name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
const read = name => JSON.parse(readFileSync(path(name), "utf8"));
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const signature = "public.learn_commusoft_create_job_review_action(uuid,uuid,text,uuid,text)";
const catalog = `select md5(pg_get_functiondef('${signature}'::regprocedure)) fingerprint,
  position('with observed as materialized (' in pg_get_functiondef('${signature}'::regprocedure))>0 exact_source,
  has_function_privilege('authenticated','${signature}','execute') authenticated,
  not has_function_privilege('anon','${signature}','execute') anon_denied,
  not has_function_privilege('service_role','${signature}','execute') service_denied,
  (select proconfig=ARRAY['search_path=pg_catalog']::text[] from pg_proc
   where oid='${signature}'::regprocedure) config_preserved`;
const ledger = environment === "test"
  ? `select source_sha256 digest from of_test_deploy.migrations where migration_name='${migration}'`
  : `select encode(sha256(convert_to(array_to_string(statements,''),'UTF8')),'hex') digest
      from supabase_migrations.schema_migrations where version='20261105150000'`;
async function query(sql, readOnly = true) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
    headers: { Authorization: "Bearer " + savedCliToken(), "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const raw = await r.text();
  if (!r.ok) {
    let code = "unknown"; try { code = JSON.parse(raw).code ?? code; } catch {}
    throw Error(`Exact source ${mode} HTTP ${r.status}, SQLSTATE ${code}`);
  }
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) throw Error("Database response shape changed");
  return value;
}
const before = (await query(catalog))[0];
if (!before || !before.authenticated || !before.anon_denied || !before.service_denied ||
    !before.config_preserved) throw Error("Job review privileges or planner config changed");
if (mode === "readback") {
  const applied = read("apply");
  const rows = await query(ledger);
  if (!before.exact_source || before.fingerprint !== applied.afterFingerprint ||
      applied.sourceSha256 !== sourceSha256 || rows.length !== 1 || rows[0].digest !== sourceSha256)
    throw Error("Installed exact-source contract differs");
  console.log(JSON.stringify({ state: "installed_verified", environment, sourceSha256,
    fingerprint: before.fingerprint, observedAt: new Date().toISOString() }));
  process.exit(0);
}
if (before.exact_source || before.fingerprint !== baselineMd5)
  throw Error("Exact baseline changed");
if (mode === "apply") {
  const rehearsal = read("rehearse");
  if (rehearsal.sourceSha256 !== sourceSha256 ||
      rehearsal.beforeFingerprint !== before.fingerprint ||
      rehearsal.state !== "rehearsed_rolled_back" ||
      Date.now() - Date.parse(rehearsal.observedAt) > 3600000)
    throw Error("Fresh exact rollback rehearsal required");
  if (environment === "live") {
    const test = JSON.parse(readFileSync(`${root}/test-apply.json`, "utf8"));
    if (test.state !== "installed_verified" || test.sourceSha256 !== sourceSha256)
      throw Error("Exact TEST installation required");
  }
}
const body = source.replace(/^begin;\s*$/m, "").replace(/^commit;\s*$/m, "");
const receipt = environment === "test"
  ? `insert into of_test_deploy.migrations(migration_name,source_sha256,project_ref)
      values('${migration}','${sourceSha256}','${project}');`
  : `insert into supabase_migrations.schema_migrations(version,name,statements)
      values('20261105150000','learn_job_review_exact_source',array[${quote(source)}]);`;
const sql = `begin; set local lock_timeout='5s'; set local statement_timeout='50s';
do $$begin if md5(pg_get_functiondef('${signature}'::regprocedure)) is distinct from '${before.fingerprint}'
  then raise exception 'job_review_baseline_changed';end if;end$$;
${body}
do $$begin if position('with observed as materialized (' in
  pg_get_functiondef('${signature}'::regprocedure))=0
  then raise exception 'exact_job_source_lookup_missing';end if;end$$;
${mode === "apply" ? receipt : ""}
select md5(pg_get_functiondef('${signature}'::regprocedure)) after_fingerprint;
${mode === "apply" ? "commit" : "rollback"};`;
const rows = await query(sql, false);
const afterFingerprint = rows[0]?.after_fingerprint;
const after = (await query(catalog))[0];
if (!afterFingerprint || mode === "rehearse" &&
    (after.fingerprint !== before.fingerprint || after.exact_source) ||
    mode === "apply" && (after.fingerprint !== afterFingerprint || !after.exact_source))
  throw Error("Exact-source transaction requires inspection");
const result = { state: mode === "rehearse" ? "rehearsed_rolled_back" : "installed_verified",
  environment, sourceSha256, observedAt: new Date().toISOString(),
  beforeFingerprint: before.fingerprint, afterFingerprint };
save(mode, result);
console.log(JSON.stringify(result));
