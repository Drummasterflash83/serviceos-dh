/** Exact, one-file M2 SQL release. No db push, flag write or provider GET. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { savedCliToken } from "./learn-test-readiness.mjs";
import { PROJECT, TENANT } from "./new-dawn-m2-live-preflight.mjs";

export const VERSION = "20261107110000";
export const NAME = "new_dawn_commusoft_job_operational_facts";
export const SOURCE_SHA256 = "e82c5faf833818ef9d58f5117137cbc48a37357b57b9066f4b4a958f95db6707";
const TRIAL = "20261107010000";
const TRIAL_SHA256 = "0c95e79b99457e4c1f29b7973f769e65da79f7ce12918d2d2891a7ee8abf5c9f";
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const ledgerSql = `select version::text,name,statements from supabase_migrations.schema_migrations
 where version::text in ('${TRIAL}','${VERSION}') order by version`;
const catalogSql = `select
 to_regprocedure('public.new_dawn_commusoft_job_detail_finish(uuid,text)') is not null as finish_present,
 coalesce(position('commusoft-exact-job-detail/1' in pg_get_functiondef(to_regprocedure(
  'public.new_dawn_commusoft_job_detail_finish(uuid,text)')))>0,false) as finish_v1,
 coalesce(position('commusoft-exact-job-detail/2' in pg_get_functiondef(to_regprocedure(
  'public.new_dawn_commusoft_job_detail_finish(uuid,text)')))>0,false) as finish_v2,
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
    !/\ncommit;\s*$/i.test(source)) throw Error("reviewed_operational_migration_changed");
  const body = source.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im, "")
    .replace(/\ncommit;\s*$/i, "");
  if (/^\s*(begin|commit);\s*$/im.test(body)) throw Error("nested_transaction_fence");
  return { source, body, hash };
}

function reviewedTrialSource() {
  const source = readFileSync(new URL("../../supabase/migrations/20261107010000_new_dawn_commusoft_one_job_trial_permit.sql", import.meta.url), "utf8");
  if (createHash("sha256").update(source).digest("hex") !== TRIAL_SHA256)
    throw Error("reviewed_trial_migration_changed");
  return source;
}

export function assessStage(snapshot, installed, source = reviewedSource().source) {
  if (snapshot?.project?.id !== PROJECT || snapshot.project.status !== "ACTIVE_HEALTHY")
    throw Error("production_project_unconfirmed");
  if (!Array.isArray(snapshot.ledger) || snapshot.ledger.length !== (installed ? 2 : 1) ||
    String(snapshot.ledger[0]?.version) !== TRIAL ||
    snapshot.ledger[0]?.name !== "new_dawn_commusoft_one_job_trial_permit" ||
    !Array.isArray(snapshot.ledger[0]?.statements) || snapshot.ledger[0].statements.length !== 1 ||
    snapshot.ledger[0].statements[0] !== reviewedTrialSource())
    throw Error("operational_prerequisite_ledger_changed");
  if (installed && (String(snapshot.ledger[1]?.version) !== VERSION ||
    snapshot.ledger[1]?.name !== NAME || !Array.isArray(snapshot.ledger[1]?.statements) ||
    snapshot.ledger[1].statements.length !== 1 || snapshot.ledger[1].statements[0] !== source))
    throw Error("operational_migration_receipt_changed");
  const c = snapshot.catalog?.[0];
  if (!c || snapshot.catalog.length !== 1 || c.finish_present !== true ||
    c.permit_table !== true || c.active_permits !== 0 || c.enabled_flags !== 0 ||
    c.finish_v1 !== !installed || c.finish_v2 !== installed)
    throw Error("operational_schema_or_default_off_changed");
  return { state: installed ? "installed_default_off_readback" : "exact_operational_sql_ready",
    version: VERSION, sourceSha256: SOURCE_SHA256, activePermits: 0,
    broadFlagsEnabled: 0, providerRequests: 0 };
}

export function releaseSql(file = reviewedSource(), rollback = false) {
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $operational_gate$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}')
  or not exists(select 1 from supabase_migrations.schema_migrations
   where version::text='${TRIAL}' and name='new_dawn_commusoft_one_job_trial_permit'
    and array_length(statements,1)=1
    and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${TRIAL_SHA256}')
  or to_regclass('public.new_dawn_commusoft_job_trial_permits') is null
  or exists(select 1 from public.new_dawn_commusoft_job_trial_permits
   where revoked_at is null and expires_at>clock_timestamp())
  or exists(select 1 from public.feature_flags where tenant_id='${TENANT}'::uuid
   and flag in ('new_dawn.m2_commusoft_coexistence','new_dawn.exact_job_detail')
   and value='true'::jsonb)
  or coalesce(position('commusoft-exact-job-detail/1' in pg_get_functiondef(to_regprocedure(
   'public.new_dawn_commusoft_job_detail_finish(uuid,text)')))>0,false) is not true
  then raise exception 'operational_install_preflight_changed';end if;
end $operational_gate$;
${file.body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(file.source)}]);
select '${VERSION}' as installed_operational_version;
${rollback ? "rollback" : "commit"};`;
}

async function management(project, token, path, query, readOnly = true, fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${token}`,
      ...(query ? { "Content-Type": "application/json" } : {}) },
    ...(query ? { body: JSON.stringify({ query, ...(readOnly ? {} : { read_only: false }) }) } : {}),
  });
  if (!response.ok) throw Error(`operational_management_${readOnly ? "read" : "write"}_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 2 * 1024 * 1024) throw Error("operational_management_response_oversized");
  return JSON.parse(bytes.toString("utf8"));
}

export async function readStage(project, token, fetcher = fetch) {
  if (project !== PROJECT) throw Error("exact_live_project_required");
  const projectInfo = await management(project, token, "", null, true, fetcher);
  const ledger = await management(project, token, "/database/query/read-only", ledgerSql, true, fetcher);
  const catalog = await management(project, token, "/database/query/read-only", catalogSql, true, fetcher);
  return { project: projectInfo, ledger, catalog };
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
    acknowledged = Array.isArray(rows) && rows.some(row => row?.installed_operational_version === VERSION);
  } catch { /* An uncertain write is never replayed. Read back once. */ }
  let after;
  try { after = await read(project, token); }
  catch { throw Error("operational_install_outcome_unverified_no_replay"); }
  try { assessStage(after, true, file.source); }
  catch { throw Error("operational_install_outcome_unverified_no_replay"); }
  return { state: "installed_default_off_readback", version: VERSION, sourceSha256: file.hash,
    ledgerReadbackVerified: true, writeAcknowledged: acknowledged, providerRequests: 0 };
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
    else throw Error("explicit_exact_operational_release_scope_required");
  } catch (error) {
    console.error(JSON.stringify({ state: "operational_release_stopped",
      code: error instanceof Error ? error.message : "unknown", retryAllowed: false,
      providerRequests: 0 }));
    process.exitCode = 1;
  }
}
