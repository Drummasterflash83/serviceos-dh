/** Exact one-file M2 trial permit release. No db push, flag write or provider GET. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { PROJECT, readM2Postrelease } from "./new-dawn-m2-live-preflight.mjs";
import { rehearseTest } from "./new-dawn-m2-one-job-trial-rehearse.mjs";

export const VERSION = "20261107010000";
export const NAME = "new_dawn_commusoft_one_job_trial_permit";
export const SOURCE_SHA256 = "0c95e79b99457e4c1f29b7973f769e65da79f7ce12918d2d2891a7ee8abf5c9f";
const TENANT = "00000000-0000-0000-0000-000000000001";
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const ledgerSql = `select version::text,name,statements from supabase_migrations.schema_migrations
 where version::text='${VERSION}'`;
const catalogSql = `select
 to_regclass('public.new_dawn_commusoft_job_trial_permits') is not null as permit_table,
 to_regprocedure('public.new_dawn_commusoft_job_trial_arm(uuid,uuid,uuid,uuid,uuid,timestamptz,text)') is not null as arm,
 to_regprocedure('public.new_dawn_commusoft_job_trial_disarm(uuid,text)') is not null as disarm,
 to_regprocedure('public.new_dawn_commusoft_job_trial_offer(uuid,uuid)') is not null as offer,
 to_regprocedure('public.new_dawn_commusoft_job_trial_current(uuid,uuid,uuid,uuid,uuid,boolean)') is not null as current,
 coalesce(has_function_privilege('authenticated',to_regprocedure(
  'public.new_dawn_commusoft_job_trial_offer(uuid,uuid)'),'execute'),false) as auth_offer,
 coalesce(has_function_privilege('anon',to_regprocedure(
  'public.new_dawn_commusoft_job_trial_offer(uuid,uuid)'),'execute'),false) as anon_offer,
 coalesce(has_function_privilege('authenticated',to_regprocedure(
  'public.new_dawn_commusoft_job_trial_arm(uuid,uuid,uuid,uuid,uuid,timestamptz,text)'),'execute'),false) as auth_arm,
 coalesce(has_function_privilege('service_role',to_regprocedure(
  'public.new_dawn_commusoft_job_trial_arm(uuid,uuid,uuid,uuid,uuid,timestamptz,text)'),'execute'),false) as service_arm,
 (select count(*)::int from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag in ('new_dawn.m2_commusoft_coexistence','new_dawn.exact_job_detail')
  and value='true'::jsonb) as broad_flags`;

export function reviewedSource() {
  const source = readFileSync(new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`, import.meta.url), "utf8");
  const hash = createHash("sha256").update(source).digest("hex");
  if (hash !== SOURCE_SHA256 || !/^\s*(?:--[^\n]*\n)*begin;/i.test(source) ||
    !/\ncommit;\s*$/i.test(source)) throw Error("reviewed_trial_migration_changed");
  const body = source.replace(/\bbegin;(?=[\s\S]*)/i, "").replace(/commit;\s*$/i, "");
  if (/^\s*(begin|commit);\s*$/im.test(body)) throw Error("nested_transaction_fence");
  return { source, body, hash };
}

export function assessStage(snapshot, installed, source = reviewedSource().source) {
  if (snapshot?.runtime?.state !== "installed_default_off_readback" ||
    snapshot.runtime.flagsPresent?.length !== 0) throw Error("m2_runtime_or_flags_changed");
  if (!Array.isArray(snapshot.ledger) || snapshot.ledger.length !== (installed ? 1 : 0))
    throw Error("trial_migration_ledger_changed");
  if (installed && (snapshot.ledger[0]?.version !== VERSION || snapshot.ledger[0]?.name !== NAME ||
    !Array.isArray(snapshot.ledger[0]?.statements) || snapshot.ledger[0].statements.length !== 1 ||
    snapshot.ledger[0].statements[0] !== source)) throw Error("trial_migration_receipt_changed");
  const c = snapshot.catalog?.[0];
  if (!c || !Number.isSafeInteger(c.permit_count) || c.permit_count !== 0 ||
    !Number.isSafeInteger(c.broad_flags) || c.broad_flags !== 0) throw Error("trial_catalog_unverified");
  for (const key of ["permit_table", "arm", "disarm", "offer", "current"])
    if (c[key] !== installed) throw Error("trial_schema_stage_changed:" + key);
  for (const key of ["anon_offer", "auth_arm", "service_arm"])
    if (c[key] !== false) throw Error("trial_grant_changed:" + key);
  if (c.auth_offer !== installed) throw Error("trial_offer_grant_changed");
  return { state: installed ? "installed_default_off_no_permit" : "exact_trial_sql_ready",
    activeImport: snapshot.runtime.activeImport, providerRequests: 0 };
}

export function releaseSql(file = reviewedSource(), rollback = false) {
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $trial_gate$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}')
  or to_regclass('public.new_dawn_commusoft_job_trial_permits') is not null
  or exists(select 1 from public.feature_flags where tenant_id='${TENANT}'::uuid
   and flag in ('new_dawn.m2_commusoft_coexistence','new_dawn.exact_job_detail')
   and value='true'::jsonb)
  then raise exception 'trial_install_preflight_changed';end if;
end $trial_gate$;
${file.body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(file.source)}]);
select '${VERSION}' as installed_trial_version;
${rollback ? "rollback" : "commit"};`;
}

async function management(project, token, sql, readOnly = true, fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }),
  });
  if (!response.ok) throw Error(`trial_management_${readOnly ? "read" : "write"}_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 2 * 1024 * 1024) throw Error("trial_management_response_oversized");
  return JSON.parse(bytes.toString("utf8"));
}

export async function readStage(project, token, fetcher = fetch) {
  if (project !== PROJECT) throw Error("exact_live_project_required");
  const runtime = await readM2Postrelease({ token });
  const ledger = await management(project, token, ledgerSql, true, fetcher);
  const catalog = await management(project, token, catalogSql, true, fetcher);
  if (!Array.isArray(catalog) || catalog.length !== 1) throw Error("trial_catalog_shape_unverified");
  catalog[0].permit_count = catalog[0].permit_table === true
    ? (await management(project, token,
      "select count(*)::int permit_count from public.new_dawn_commusoft_job_trial_permits",
      true, fetcher))?.[0]?.permit_count : 0;
  return { runtime, ledger, catalog };
}

export async function installLive({ token = savedCliToken(), read = readStage,
  write = sql => management(PROJECT, token, sql, false) } = {}) {
  const file = reviewedSource();
  assessStage(await read(PROJECT, token), false, file.source);
  let acknowledged = false;
  try {
    const rows = await write(releaseSql(file));
    acknowledged = Array.isArray(rows) && rows.some(row => row?.installed_trial_version === VERSION);
  } catch { /* Unknown write outcome: read back exactly once; never replay. */ }
  let after;
  try { after = await read(PROJECT, token); }
  catch { throw Error("trial_install_outcome_unverified_no_replay"); }
  try { assessStage(after, true, file.source); }
  catch { throw Error("trial_install_outcome_unverified_no_replay"); }
  return { state: "installed_default_off_no_permit", version: VERSION,
    sourceSha256: file.hash, ledgerReadbackVerified: true, writeAcknowledged: acknowledged,
    providerRequests: 0 };
}

export async function testRollback({ token = savedCliToken(), fetcher = fetch } = {}) {
  reviewedSource();
  const presenceSql = "select to_regclass('supabase_migrations.schema_migrations') is null as ledger_absent";
  const before = await management(TEST_PROJECT, token, presenceSql, true, fetcher);
  if (before?.[0]?.ledger_absent !== true) throw Error("TEST_trial_ledger_not_absent");
  const result = await rehearseTest(token, fetcher);
  const after = await management(TEST_PROJECT, token, presenceSql, true, fetcher);
  if (after?.[0]?.ledger_absent !== true) throw Error("TEST_trial_ledger_rollback_unverified");
  return { ...result, ledgerUnchanged: true, version: VERSION, sourceSha256: SOURCE_SHA256 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const mode = process.argv.slice(2).join(" ");
    if (mode === "--test-rollback-only" && process.env.NEW_DAWN_M2_ALLOW_PROJECT === TEST_PROJECT)
      console.log(JSON.stringify(await testRollback()));
    else if (mode === "--live-read-only" && process.env.NEW_DAWN_M2_ALLOW_PROJECT === PROJECT)
      console.log(JSON.stringify(assessStage(await readStage(PROJECT, savedCliToken()), false)));
    else if (mode === "--live-install-exact" && process.env.NEW_DAWN_M2_ALLOW_PROJECT === PROJECT)
      console.log(JSON.stringify(await installLive()));
    else throw Error("explicit_exact_trial_release_scope_required");
  } catch (error) {
    console.error(JSON.stringify({ state: "trial_release_stopped",
      code: error instanceof Error ? error.message : "unknown", retryAllowed: false,
      providerRequests: 0 }));
    process.exitCode = 1;
  }
}
