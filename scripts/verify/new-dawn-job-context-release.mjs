/** One exact default-OFF job-context reader release. No provider request or client grant. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

export const PROJECT = "tgbnakbxwcqjeimygroz";
export const TENANT = "00000000-0000-0000-0000-000000000001";
export const VERSION = "20261106220000";
export const NAME = "new_dawn_job_context_candidates";
export const SHA256 = "9df44a923db8e3c074056300845cd9c51fa041c017f7505f69e45d41d6835b7c";
const SIGNATURE = "public.new_dawn_job_context_candidates(uuid,uuid,text,integer)";
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const catalog = `select
 to_regprocedure('${SIGNATURE}') is not null as installed,
 coalesce(has_function_privilege('anon',to_regprocedure('${SIGNATURE}'),'EXECUTE'),false) as anon_execute,
 coalesce(has_function_privilege('authenticated',to_regprocedure('${SIGNATURE}'),'EXECUTE'),false) as authenticated_execute,
 coalesce(has_function_privilege('service_role',to_regprocedure('${SIGNATURE}'),'EXECUTE'),false) as service_execute,
 (select count(*)::int from supabase_migrations.schema_migrations where version::text='${VERSION}') as ledger_count,
 (select name from supabase_migrations.schema_migrations where version::text='${VERSION}' limit 1) as ledger_name,
 (select cardinality(statements) from supabase_migrations.schema_migrations where version::text='${VERSION}' limit 1) as statement_count,
 (select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version::text='${VERSION}' limit 1) as ledger_hash,
 (select count(*)::int from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='new_dawn.job_context_candidates') as flag_count`;
const testCatalog = `select
 to_regprocedure('${SIGNATURE}') is not null as installed,
 coalesce(has_function_privilege('anon',to_regprocedure('${SIGNATURE}'),'EXECUTE'),false) as anon_execute,
 coalesce(has_function_privilege('authenticated',to_regprocedure('${SIGNATURE}'),'EXECUTE'),false) as authenticated_execute,
 coalesce(has_function_privilege('service_role',to_regprocedure('${SIGNATURE}'),'EXECUTE'),false) as service_execute`;

export function source() {
  const text = readFileSync(new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`, import.meta.url), "utf8");
  if (hash(text) !== SHA256 || !/\nbegin;\s*\n/i.test(text) || !/\ncommit;\s*$/i.test(text))
    throw Error("job_context_source_changed");
  const start = text.indexOf("\nbegin;");
  const end = text.lastIndexOf("\ncommit;");
  const body = text.slice(start + 8, end);
  if (/^\s*(begin|commit);\s*$/im.test(body)) throw Error("job_context_nested_transaction");
  return { text, body };
}

async function management(project, path, query, readOnly, token = savedCliToken(), fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${token}`, ...(query ? { "Content-Type": "application/json" } : {}) },
    ...(query ? { body: JSON.stringify({ query, read_only: readOnly }) } : {}),
  });
  if (!response.ok) throw Error(`job_context_management_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 1_000_000) throw Error("job_context_management_response_too_large");
  return JSON.parse(bytes.toString("utf8"));
}

export async function readStage(project = PROJECT, token = savedCliToken(), fetcher = fetch) {
  if (project !== PROJECT) throw Error("job_context_exact_live_project_required");
  const [info, rows] = await Promise.all([
    management(project, "", null, true, token, fetcher),
    management(project, "/database/query/read-only", catalog, true, token, fetcher),
  ]);
  if (info?.id !== PROJECT || info.status !== "ACTIVE_HEALTHY" || !Array.isArray(rows) || rows.length !== 1)
    throw Error("job_context_live_catalog_unconfirmed");
  return { project: info.id, status: info.status, row: rows[0] };
}

export function assessStage(snapshot, installed) {
  const c = snapshot?.row;
  if (snapshot?.project !== PROJECT || snapshot.status !== "ACTIVE_HEALTHY" || !c ||
    c.flag_count !== 0 || c.anon_execute !== false || c.service_execute !== false ||
    c.installed !== installed || c.authenticated_execute !== installed ||
    c.ledger_count !== (installed ? 1 : 0) ||
    c.ledger_name !== (installed ? NAME : null) ||
    c.statement_count !== (installed ? 1 : null) ||
    c.ledger_hash !== (installed ? SHA256 : null))
    throw Error("job_context_live_stage_changed");
  return { state: installed ? "installed_default_off" : "exact_source_ready", project: PROJECT,
    version: VERSION, sourceSha256: SHA256, operatorGrant: installed, flagOff: true,
    providerRequests: 0 };
}

export async function testRollback(token = savedCliToken(), fetcher = fetch) {
  const prior = await management(TEST_PROJECT, "/database/query/read-only", testCatalog, true, token, fetcher);
  if (prior?.length !== 1 || prior[0].installed !== false) throw Error("job_context_test_baseline_changed");
  const sql = `begin;\n${source().body}\n${testCatalog};\nrollback;`;
  const inside = await management(TEST_PROJECT, "/database/query", sql, false, token, fetcher);
  if (inside?.length !== 1 || inside[0].installed !== true || inside[0].anon_execute !== false ||
    inside[0].authenticated_execute !== true || inside[0].service_execute !== false)
    throw Error("job_context_test_compilation_changed");
  const after = await management(TEST_PROJECT, "/database/query/read-only", testCatalog, true, token, fetcher);
  if (JSON.stringify(after) !== JSON.stringify(prior)) throw Error("job_context_test_rollback_changed");
  return { state: "test_rollback_verified", project: TEST_PROJECT, sourceSha256: SHA256, providerRequests: 0 };
}

export function releaseSql() {
  const file = source();
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $gate$ begin
 if to_regprocedure('${SIGNATURE}') is not null or
  exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}') or
  exists(select 1 from public.feature_flags where tenant_id='${TENANT}'::uuid
   and flag='new_dawn.job_context_candidates') then
  raise exception 'job_context_release_state_changed';end if;
end $gate$;
${file.body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(file.text)}]);
select '${VERSION}' as installed_version;
commit;`;
}

export async function installLive(token = savedCliToken(), read = readStage, write) {
  const rehearsal = await testRollback(token);
  if (rehearsal.state !== "test_rollback_verified") throw Error("job_context_test_gate_unverified");
  assessStage(await read(PROJECT, token), false);
  let acknowledged = false;
  try {
    const rows = await (write ?? ((sql) => management(PROJECT, "/database/query", sql, false, token)))(releaseSql());
    acknowledged = Array.isArray(rows) && rows.some((row) => row?.installed_version === VERSION);
  } catch { /* A lost write acknowledgement is never replayed. */ }
  let after;
  try { after = await read(PROJECT, token); assessStage(after, true); }
  catch { throw Error("job_context_write_outcome_unverified_no_replay"); }
  return { state: "installed_default_off", version: VERSION, sourceSha256: SHA256,
    acknowledged, ledgerAndGrantReadback: true, providerRequests: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--test-rollback-only")
      console.log(JSON.stringify(await testRollback()));
    else if (args.length === 1 && args[0] === "--live-read-only" &&
      process.env.NEW_DAWN_JOB_CONTEXT_PROJECT === PROJECT)
      console.log(JSON.stringify(assessStage(await readStage(), process.env.NEW_DAWN_JOB_CONTEXT_INSTALLED === "1")));
    else if (args.length === 3 && args[0] === "--live-install-exact" &&
      args[1] === "--sha" && args[2] === SHA256 &&
      process.env.NEW_DAWN_JOB_CONTEXT_PROJECT === PROJECT)
      console.log(JSON.stringify(await installLive()));
    else throw Error("job_context_exact_scope_required");
  } catch (error) {
    console.error(JSON.stringify({ state: "job_context_release_stopped",
      reason: error instanceof Error ? error.message : "unknown" }));
    process.exitCode = 1;
  }
}
