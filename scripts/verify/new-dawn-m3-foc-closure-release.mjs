/** Exact additive LIVE SQL release. Read-only preflight and one-use install only. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { savedCliToken } from "./learn-test-readiness.mjs";

export const PROJECT = "tgbnakbxwcqjeimygroz";
export const TENANT = "00000000-0000-0000-0000-000000000001";
export const VERSION = "20261109120000";
export const NAME = "new_dawn_foc_closure_review";
export const SOURCE_SHA256 = "8017df2770cfc3242a8d532b5b40dad8a1221cb11f5784d8613db18ed91c5075";
const INSTALLED_FUNCTION_SHA256 =
  "f3a8d3bc8e708c35feb2f819fc89037a446a97fc5051d92ef4d30c1fe4550697";
const ACTOR_SHA256 = "c219bb0b06c71235a999e7656504f3eb2b74739dadbd5de47c6a5f21789a2a6d";
const LATEST_SHA256 = "9c23056d83cf6e11557317db80a252277a723ff926066aab0ab7f4e1218fb3d4";
const DETAIL_FINISH_SHA256 = "7c4bb1e4baf72f56935ed40dd441ea1cbd25412d205576583152677d7f4ce36c";
const SIGNATURE = "public.new_dawn_foc_closure_review(uuid,text)";
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
const hash = (value) => createHash("sha256").update(value).digest("hex");

export function reviewedSource() {
  const source = readFileSync(
    new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`, import.meta.url),
    "utf8",
  );
  if (
    hash(source) !== SOURCE_SHA256 ||
    !/^\s*(?:--[^\n]*\n)*begin;\s*$/im.test(source) ||
    !/\ncommit;\s*$/i.test(source)
  )
    throw Error("foc_reviewed_source_changed");
  const body = source.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im, "").replace(/\ncommit;\s*$/i, "");
  if (/^\s*(?:begin|commit);\s*$/im.test(body)) throw Error("foc_nested_transaction");
  return { source, body, hash: SOURCE_SHA256 };
}

const ledgerSql = `select version::text,name,array_length(statements,1) as statement_count,
 encode(sha256(convert_to(statements[1],'UTF8')),'hex') as source_sha256
 from supabase_migrations.schema_migrations where version::text='${VERSION}'`;
const catalogSql = `select to_regprocedure('${SIGNATURE}') is not null as installed,
 coalesce((select p.prosecdef from pg_proc p where p.oid=to_regprocedure('${SIGNATURE}')),false) as security_definer,
 case when to_regprocedure('${SIGNATURE}') is null then null else
  encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${SIGNATURE}')),'UTF8')),'hex') end as installed_function_sha256,
 case when to_regprocedure('${SIGNATURE}') is null then false else
  has_function_privilege('authenticated','${SIGNATURE}','execute') end as authenticated_grant,
 case when to_regprocedure('${SIGNATURE}') is null then false else
  has_function_privilege('anon','${SIGNATURE}','execute') end as anon_grant,
 case when to_regprocedure('${SIGNATURE}') is null then false else
  has_function_privilege('service_role','${SIGNATURE}','execute') end as service_grant,
 encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(
  'public.new_dawn_commusoft_job_actor_access(uuid,uuid)')),'UTF8')),'hex') as actor_sha256,
 encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(
  'public.learn_business_input_latest(uuid,uuid,text,text,text)')),'UTF8')),'hex') as latest_sha256,
 encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(
  'public.new_dawn_commusoft_job_detail_finish(uuid,text)')),'UTF8')),'hex') as detail_finish_sha256,
 exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active') as tenant_active,
 (select c.relrowsecurity from pg_class c where c.oid='public.new_dawn_commusoft_job_detail_reads'::regclass) as detail_rls,
 has_table_privilege('authenticated','public.new_dawn_commusoft_job_detail_reads','select') as detail_authenticated_select,
 (select count(*)::int from public.feature_flags where flag='new_dawn.m3_foc_closure_review'
  and value='true'::jsonb) as foc_flags_on,
 (select count(*)::int from public.feature_flags where flag in
  ('new_dawn.owner_money','new_dawn.owner_report_review','new_dawn.owner_accounts_report')
  and value='true'::jsonb) as client_money_on`;
const countsSql = `select
 (select count(*)::bigint from public.new_dawn_commusoft_job_detail_reads
  where tenant_id='${TENANT}'::uuid) as detail_receipts,
 (select count(*)::bigint from public.controlplane_change_log
  where tenant_id='${TENANT}'::uuid and action='client_jobs.foc_closure_review_read') as review_audits`;

async function management(project, token, path, query, readOnly = true, fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? "POST" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(90000),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(query ? { "Content-Type": "application/json" } : {}),
    },
    ...(query
      ? { body: JSON.stringify({ query, ...(readOnly ? {} : { read_only: false }) }) }
      : {}),
  });
  if (!response.ok)
    throw Error(`foc_management_${readOnly ? "read" : "write"}_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 1024 * 1024) throw Error("foc_management_response_oversized");
  return JSON.parse(bytes.toString("utf8"));
}
export async function readStage(project, token, fetcher = fetch) {
  if (project !== PROJECT) throw Error("exact_live_project_required");
  const q = (sql) => management(project, token, "/database/query/read-only", sql, true, fetcher);
  return {
    project: await management(project, token, "", null, true, fetcher),
    ledger: await q(ledgerSql),
    catalog: await q(catalogSql),
    counts: await q(countsSql),
  };
}
export function assess(stage, installed, file = reviewedSource()) {
  if (
    stage?.project?.id !== PROJECT ||
    stage.project.status !== "ACTIVE_HEALTHY" ||
    !Array.isArray(stage.ledger) ||
    stage.ledger.length !== Number(installed) ||
    !Array.isArray(stage.catalog) ||
    stage.catalog.length !== 1 ||
    !Array.isArray(stage.counts) ||
    stage.counts.length !== 1
  )
    throw Error("foc_target_or_ledger_changed");
  if (installed) {
    const row = stage.ledger[0];
    if (
      String(row.version) !== VERSION ||
      row.name !== NAME ||
      row.statement_count !== 1 ||
      row.source_sha256 !== file.hash
    )
      throw Error("foc_ledger_source_changed");
  }
  const c = stage.catalog[0];
  if (
    c.installed !== installed ||
    c.security_definer !== installed ||
    c.installed_function_sha256 !== (installed ? INSTALLED_FUNCTION_SHA256 : null) ||
    c.authenticated_grant !== installed ||
    c.anon_grant !== false ||
    c.service_grant !== false ||
    c.actor_sha256 !== ACTOR_SHA256 ||
    c.latest_sha256 !== LATEST_SHA256 ||
    c.detail_finish_sha256 !== DETAIL_FINISH_SHA256 ||
    c.tenant_active !== true ||
    c.detail_rls !== true ||
    c.detail_authenticated_select !== false ||
    c.foc_flags_on !== 0 ||
    c.client_money_on !== 0
  )
    throw Error("foc_access_or_flag_boundary_changed");
  const counts = stage.counts[0];
  if (
    !["detail_receipts", "review_audits"].every(
      (key) => Number.isSafeInteger(Number(counts[key])) && Number(counts[key]) >= 0,
    )
  )
    throw Error("foc_counts_unconfirmed");
  return {
    state: installed ? "installed_default_off_readback" : "exact_foc_review_ready",
    version: VERSION,
    sourceSha256: file.hash,
    providerRequests: 0,
    flagEnabled: false,
    clientMoneyFlagsEnabled: false,
    detailReceipts: Number(counts.detail_receipts),
    reviewAudits: Number(counts.review_audits),
  };
}

export function releaseSql(file = reviewedSource(), rollback = false) {
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
lock table public.feature_flags in share mode;
do $foc_gate$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}')
  or to_regprocedure('${SIGNATURE}') is not null
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(
   'public.new_dawn_commusoft_job_actor_access(uuid,uuid)')),'UTF8')),'hex') is distinct from '${ACTOR_SHA256}'
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(
   'public.learn_business_input_latest(uuid,uuid,text,text,text)')),'UTF8')),'hex') is distinct from '${LATEST_SHA256}'
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(
   'public.new_dawn_commusoft_job_detail_finish(uuid,text)')),'UTF8')),'hex') is distinct from '${DETAIL_FINISH_SHA256}'
  or not exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active')
  or not (select c.relrowsecurity from pg_class c where c.oid='public.new_dawn_commusoft_job_detail_reads'::regclass)
  or has_table_privilege('authenticated','public.new_dawn_commusoft_job_detail_reads','select')
  or exists(select 1 from public.feature_flags where flag in
   ('new_dawn.m3_foc_closure_review','new_dawn.owner_money',
    'new_dawn.owner_report_review','new_dawn.owner_accounts_report') and value='true'::jsonb)
 then raise exception 'foc_install_preflight_changed';end if;
end $foc_gate$;
${file.body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(file.source)}]);
select '${VERSION}' as installed_foc_version;
${rollback ? "rollback" : "commit"};`;
}

export async function installLive({
  project = PROJECT,
  token = savedCliToken(),
  read = readStage,
  write,
} = {}) {
  if (project !== PROJECT) throw Error("exact_live_project_required");
  const file = reviewedSource();
  const before = await read(project, token);
  assess(before, false, file);
  const writer = write ?? ((sql) => management(project, token, "/database/query", sql, false));
  let acknowledged = false;
  try {
    const rows = await writer(releaseSql(file));
    acknowledged =
      Array.isArray(rows) && rows.some((row) => row?.installed_foc_version === VERSION);
  } catch {
    /* Unknown outcome is read back once; never replay an uncertain write. */
  }
  let after;
  try {
    after = await read(project, token);
  } catch {
    throw Error("foc_install_outcome_unverified_no_replay");
  }
  let result;
  try {
    result = assess(after, true, file);
    if (
      result.detailReceipts !== Number(before.counts[0].detail_receipts) ||
      result.reviewAudits !== Number(before.counts[0].review_audits)
    )
      throw Error("foc_install_counts_changed");
  } catch {
    throw Error("foc_install_outcome_unverified_no_replay");
  }
  return { ...result, ledgerReadbackVerified: true, writeAcknowledged: acknowledged };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.NEW_DAWN_M3_ALLOW_PROJECT !== PROJECT)
      throw Error("explicit_exact_live_project_required");
    const mode = process.argv.slice(2).join(" ");
    if (mode === "--live-read-only") {
      const snapshot = await readStage(PROJECT, savedCliToken());
      console.log(JSON.stringify(assess(snapshot, snapshot.ledger?.length === 1)));
    } else if (mode === "--live-install-exact") console.log(JSON.stringify(await installLive()));
    else throw Error("explicit_exact_foc_action_required");
  } catch (error) {
    console.error(
      JSON.stringify({
        state: "foc_release_stopped",
        code: error instanceof Error ? error.message : "unknown",
        retryAllowed: false,
        providerRequests: 0,
      }),
    );
    process.exitCode = 1;
  }
}
