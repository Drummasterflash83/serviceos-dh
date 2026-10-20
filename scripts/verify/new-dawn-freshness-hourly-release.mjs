/** Exact, drift-checked release for hourly read-only Commusoft newest-job checks. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { savedCliToken } from "./learn-test-readiness.mjs";

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const version = "20261110230000";
const name = "new_dawn_hourly_commusoft_freshness";
const oldDefinitionHash = "ac033ade3ed10ea707e67e3885c60654561c967e455e58ae6bf46606d509ed27";
const sourceHash = "937601c61992f1c6d6a5d27ab1bf5e4edfa82d33503f0849b81ffbb00e0ab472";
const signature = "public.new_dawn_commusoft_freshness_claim()";
const hash = (text) => createHash("sha256").update(text).digest("hex");
const literal = (text) => `'${text.replaceAll("'", "''")}'`;

export function exactSource() {
  const source = readFileSync(new URL(`../../supabase/migrations/${version}_${name}.sql`, import.meta.url), "utf8");
  if (hash(source) !== sourceHash || !source.startsWith("-- Recheck Commusoft") ||
      !/\nbegin;\n/.test(source) || !/\ncommit;\n$/.test(source)) throw Error("hourly_source_changed");
  const body = source.slice(source.indexOf("\nbegin;") + 8, source.lastIndexOf("\ncommit;"));
  if (/^\s*(begin|commit);\s*$/im.test(body)) throw Error("hourly_nested_transaction");
  return { source, body };
}

const catalog = `select
 encode(sha256(convert_to(pg_get_functiondef('${signature}'::regprocedure),'UTF8')),'hex') definition_sha256,
 (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.new_dawn_commusoft_freshness_runs'::regclass
   and conname='new_dawn_commusoft_freshness_runs_run_number_check') run_cap,
 has_function_privilege('service_role','${signature}','EXECUTE') service_execute,
 has_function_privilege('authenticated','${signature}','EXECUTE') authenticated_execute,
 has_function_privilege('anon','${signature}','EXECUTE') anon_execute,
 (select count(*)::int from supabase_migrations.schema_migrations where version::text='${version}') ledger_count,
 (select name from supabase_migrations.schema_migrations where version::text='${version}' limit 1) ledger_name,
 (select cardinality(statements) from supabase_migrations.schema_migrations where version::text='${version}' limit 1) statement_count,
 (select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version::text='${version}' limit 1) ledger_hash,
 (select count(*)::int from public.feature_flags where tenant_id='${tenant}'::uuid
   and flag='new_dawn.commusoft_freshness' and value='true'::jsonb) enabled_count,
 pg_get_functiondef('${signature}'::regprocedure) ~ 'run_number[[:space:]]*>=[[:space:]]*26' hourly_cap_in_function,
 pg_get_functiondef('${signature}'::regprocedure) like '%saved_id is not distinct from latest_id%' unchanged_skip_in_function`;

async function management(path, query, readOnly, token = savedCliToken(), fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${token}`, ...(query ? { "Content-Type": "application/json" } : {}) },
    ...(query ? { body: JSON.stringify({ query, read_only: readOnly }) } : {}),
  });
  if (!response.ok) throw Error(`hourly_management_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 1_000_000) throw Error("hourly_management_response_too_large");
  return JSON.parse(bytes.toString("utf8"));
}

export async function readStage(token = savedCliToken(), fetcher = fetch) {
  const [info, rows] = await Promise.all([
    management("", null, true, token, fetcher),
    management("/database/query/read-only", catalog, true, token, fetcher),
  ]);
  if (info?.id !== project || info.status !== "ACTIVE_HEALTHY" || !Array.isArray(rows) || rows.length !== 1)
    throw Error("hourly_live_catalog_unconfirmed");
  return rows[0];
}

export function assess(row, installed) {
  const expectedCap = installed
    ? "CHECK (((run_number >= 1) AND (run_number <= 26)))"
    : "CHECK (((run_number >= 1) AND (run_number <= 8)))";
  if (!row || row.run_cap !== expectedCap || row.service_execute !== true ||
      row.authenticated_execute !== false || row.anon_execute !== false ||
      row.enabled_count !== 1 || row.ledger_count !== (installed ? 1 : 0) ||
      row.ledger_name !== (installed ? name : null) ||
      row.statement_count !== (installed ? 1 : null) ||
      row.ledger_hash !== (installed ? sourceHash : null) ||
      row.unchanged_skip_in_function !== !installed ||
      row.hourly_cap_in_function !== installed ||
      (installed ? row.definition_sha256 === oldDefinitionHash : row.definition_sha256 !== oldDefinitionHash))
    throw Error("hourly_live_stage_changed");
  return { state: installed ? "installed_hourly" : "ready_exact_release",
    project, sourceSha256: sourceHash, providerRequestsByRelease: 0 };
}

export function releaseSql() {
  const { source, body } = exactSource();
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $gate$ begin
 if (select encode(sha256(convert_to(pg_get_functiondef('${signature}'::regprocedure),'UTF8')),'hex'))
    <> '${oldDefinitionHash}'
 or (select pg_get_constraintdef(oid) from pg_constraint
     where conrelid='public.new_dawn_commusoft_freshness_runs'::regclass
       and conname='new_dawn_commusoft_freshness_runs_run_number_check')
    <> 'CHECK (((run_number >= 1) AND (run_number <= 8)))'
 or exists(select 1 from supabase_migrations.schema_migrations where version::text='${version}')
 or (select count(*) from public.feature_flags where tenant_id='${tenant}'::uuid
     and flag='new_dawn.commusoft_freshness' and value='true'::jsonb)<>1 then
  raise exception 'hourly_release_state_changed';end if;
end $gate$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${version}','${name}',array[${literal(source)}]);
select '${version}' installed_version;
commit;`;
}

export async function installLive(token = savedCliToken(), fetcher = fetch) {
  exactSource();
  assess(await readStage(token, fetcher), false);
  let acknowledged = false;
  try {
    const rows = await management("/database/query", releaseSql(), false, token, fetcher);
    acknowledged = Array.isArray(rows) && rows.some((row) => row?.installed_version === version);
  } catch { /* Lost acknowledgements are inspected, never replayed. */ }
  try { assess(await readStage(token, fetcher), true); }
  catch { throw Error("hourly_release_outcome_unverified_no_replay"); }
  return { state: "installed_hourly", version, sourceSha256: sourceHash,
    acknowledged, providerRequestsByRelease: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--live-read-only")
      console.log(JSON.stringify(assess(await readStage(), process.env.NEW_DAWN_HOURLY_INSTALLED === "1")));
    else if (args.length === 3 && args[0] === "--live-install-exact" &&
      args[1] === "--sha" && args[2] === sourceHash &&
      process.env.NEW_DAWN_HOURLY_PROJECT === project)
      console.log(JSON.stringify(await installLive()));
    else throw Error("hourly_exact_scope_required");
  } catch (error) {
    console.error(JSON.stringify({ state: "hourly_release_stopped",
      reason: error instanceof Error ? error.message : "unknown" }));
    process.exitCode = 1;
  }
}
