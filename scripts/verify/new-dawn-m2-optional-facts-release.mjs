/** One reviewed M2 optional-fact replacement; no provider GET or flag write. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { savedCliToken } from "./learn-test-readiness.mjs";
import { PROJECT, TENANT } from "./new-dawn-m2-live-preflight.mjs";

export const VERSION = "20261107150000";
export const NAME = "new_dawn_commusoft_job_optional_source_facts";
export const SOURCE_SHA256 = "3d41c68570e53e9b4b96f4d9759283098dd8031af4a9755de77a1ac3f27082df";
const PRIOR_VERSION = "20261107140000";
const PRIOR_NAME = "new_dawn_commusoft_job_source_quote";
const PRIOR_SOURCE_SHA256 = "274646b97905f4f840833261827d95b9621b820631dd36c525b6d58aa9e7b9b3";
const PRIOR_FUNCTION_SHA256 = "7652d2e4f669338cb75e9ccbc05f6322ee3dba1c3c783dca268fd640e2108853";
const OPTIONAL_FUNCTION_SHA256 = "8eb34ddd828420ea84f695b5a893ff9f9e4d1786537f36921aa9408370026090";
export const EDGE = Object.freeze({
  id: "009b9fb6-8e3c-49b8-8a3e-95531ba370bd",
  slug: "learn-commusoft-job-detail",
  version: 5,
  status: "ACTIVE",
  verify_jwt: false,
  ezbr_sha256: "eafe6d4310c3e6588c7e89f630890d5b14be2e18b6651062ba6d3d6549957bfa",
});
const sqlQuote = value => "'" + value.replaceAll("'", "''") + "'";
const ledgerSql = `select version::text,name,statements from supabase_migrations.schema_migrations
 where version::text in ('${PRIOR_VERSION}','${VERSION}') order by version`;
const catalogSql = `select
 encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(
  'public.new_dawn_commusoft_job_detail_finish(uuid,text)')),'UTF8')),'hex') as function_sha256,
 to_regclass('public.new_dawn_commusoft_job_trial_permits') is not null as permit_table,
 (select count(*)::int from public.new_dawn_commusoft_job_trial_permits
  where revoked_at is null and expires_at>clock_timestamp()) as active_permits,
 (select count(*)::int from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag in ('new_dawn.m2_commusoft_coexistence','new_dawn.exact_job_detail')
  and value='true'::jsonb) as enabled_flags`;

export function reviewedSource() {
  const source = readFileSync(new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`, import.meta.url), "utf8");
  const hash = createHash("sha256").update(source).digest("hex");
  if (hash !== SOURCE_SHA256 || !/^\s*(?:--[^\n]*\n)*begin;\s*$/im.test(source) ||
    !/\ncommit;\s*$/i.test(source)) throw Error("reviewed_optional_migration_changed");
  const body = source.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im, "")
    .replace(/\ncommit;\s*$/i, "");
  if (/^\s*(begin|commit);\s*$/im.test(body)) throw Error("nested_transaction_fence");
  return { source, body, hash };
}

function reviewedPriorSource() {
  const source = readFileSync(new URL(`../../supabase/migrations/${PRIOR_VERSION}_${PRIOR_NAME}.sql`, import.meta.url), "utf8");
  if (createHash("sha256").update(source).digest("hex") !== PRIOR_SOURCE_SHA256)
    throw Error("reviewed_quote_prerequisite_changed");
  return source;
}

export function assessStage(snapshot, installed, source = reviewedSource().source) {
  if (snapshot?.project?.id !== PROJECT || snapshot.project.status !== "ACTIVE_HEALTHY")
    throw Error("production_project_unconfirmed");
  const matches = snapshot.functions?.filter(row => row?.slug === EDGE.slug);
  if (!Array.isArray(matches) || matches.length !== 1 ||
    Object.entries(EDGE).some(([key, value]) => matches[0][key] !== value))
    throw Error("exact_optional_edge_runtime_unconfirmed");
  if (!Array.isArray(snapshot.ledger) || snapshot.ledger.length !== (installed ? 2 : 1) ||
    String(snapshot.ledger[0]?.version) !== PRIOR_VERSION ||
    snapshot.ledger[0]?.name !== PRIOR_NAME ||
    !Array.isArray(snapshot.ledger[0]?.statements) ||
    snapshot.ledger[0].statements.length !== 1 ||
    snapshot.ledger[0].statements[0] !== reviewedPriorSource())
    throw Error("optional_prerequisite_ledger_changed");
  if (installed && (String(snapshot.ledger[1]?.version) !== VERSION ||
    snapshot.ledger[1]?.name !== NAME || !Array.isArray(snapshot.ledger[1]?.statements) ||
    snapshot.ledger[1].statements.length !== 1 || snapshot.ledger[1].statements[0] !== source))
    throw Error("optional_migration_receipt_changed");
  const catalog = snapshot.catalog?.[0];
  if (!catalog || snapshot.catalog.length !== 1 || catalog.permit_table !== true ||
    catalog.active_permits !== 0 || catalog.enabled_flags !== 0 ||
    catalog.function_sha256 !== (installed ? OPTIONAL_FUNCTION_SHA256 : PRIOR_FUNCTION_SHA256))
    throw Error("optional_function_or_default_off_changed");
  return { state: installed ? "installed_default_off_readback" : "exact_optional_sql_ready",
    version: VERSION, sourceSha256: SOURCE_SHA256, edgeVersion: EDGE.version,
    edgeSha256: EDGE.ezbr_sha256, activePermits: 0, broadFlagsEnabled: 0,
    providerRequests: 0 };
}

export function releaseSql(file = reviewedSource(), rollback = false) {
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $optional_gate$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}')
  or not exists(select 1 from supabase_migrations.schema_migrations
   where version::text='${PRIOR_VERSION}' and name='${PRIOR_NAME}'
    and array_length(statements,1)=1
    and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${PRIOR_SOURCE_SHA256}')
  or to_regclass('public.new_dawn_commusoft_job_trial_permits') is null
  or exists(select 1 from public.new_dawn_commusoft_job_trial_permits
   where revoked_at is null and expires_at>clock_timestamp())
  or exists(select 1 from public.feature_flags where tenant_id='${TENANT}'::uuid
   and flag in ('new_dawn.m2_commusoft_coexistence','new_dawn.exact_job_detail')
   and value='true'::jsonb)
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(
   'public.new_dawn_commusoft_job_detail_finish(uuid,text)')),'UTF8')),'hex')
   is distinct from '${PRIOR_FUNCTION_SHA256}'
  then raise exception 'optional_install_preflight_changed';end if;
end $optional_gate$;
${file.body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${sqlQuote(file.source)}]);
select '${VERSION}' as installed_optional_version;
${rollback ? "rollback" : "commit"};`;
}

async function management(project, token, path, query, readOnly = true, fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${token}`,
      ...(query ? { "Content-Type": "application/json" } : {}) },
    ...(query ? { body: JSON.stringify({ query, ...(readOnly ? {} : { read_only: false }) }) } : {}),
  });
  if (!response.ok) throw Error(`optional_management_${readOnly ? "read" : "write"}_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 3 * 1024 * 1024) throw Error("optional_management_response_oversized");
  return JSON.parse(bytes.toString("utf8"));
}

export async function readStage(project, token, fetcher = fetch) {
  if (project !== PROJECT) throw Error("exact_live_project_required");
  const projectInfo = await management(project, token, "", null, true, fetcher);
  const functions = await management(project, token, "/functions", null, true, fetcher);
  const ledger = await management(project, token, "/database/query/read-only", ledgerSql, true, fetcher);
  const catalog = await management(project, token, "/database/query/read-only", catalogSql, true, fetcher);
  return { project: projectInfo, functions, ledger, catalog };
}

export async function installLive({ project = PROJECT, token = savedCliToken(),
  read = readStage, write } = {}) {
  if (project !== PROJECT) throw Error("exact_live_project_required");
  const file = reviewedSource();
  assessStage(await read(project, token), false, file.source);
  const writer = write ?? (sql => management(project, token, "/database/query", sql, false));
  let acknowledged = false;
  try {
    const rows = await writer(releaseSql(file));
    acknowledged = Array.isArray(rows) && rows.some(row => row?.installed_optional_version === VERSION);
  } catch { /* An uncertain write is never replayed. Read back once. */ }
  let after;
  try { after = await read(project, token); }
  catch { throw Error("optional_install_outcome_unverified_no_replay"); }
  try { assessStage(after, true, file.source); }
  catch { throw Error("optional_install_outcome_unverified_no_replay"); }
  return { state: "installed_default_off_readback", version: VERSION, sourceSha256: file.hash,
    ledgerReadbackVerified: true, writeAcknowledged: acknowledged,
    edgeVersion: EDGE.version, providerRequests: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const mode = process.argv.slice(2).join(" ");
    if (process.env.NEW_DAWN_M2_ALLOW_PROJECT !== PROJECT)
      throw Error("explicit_exact_live_project_required");
    if (mode === "--live-read-only") {
      const snapshot = await readStage(PROJECT, savedCliToken());
      console.log(JSON.stringify(assessStage(snapshot, snapshot.ledger?.length === 2)));
    } else if (mode === "--live-install-exact")
      console.log(JSON.stringify(await installLive()));
    else throw Error("explicit_exact_optional_release_scope_required");
  } catch (error) {
    console.error(JSON.stringify({ state: "optional_release_stopped",
      code: error instanceof Error ? error.message : "unknown", retryAllowed: false,
      providerRequests: 0 }));
    process.exitCode = 1;
  }
}
