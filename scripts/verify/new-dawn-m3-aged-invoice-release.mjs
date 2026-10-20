/** Exact M3 91+ saved-invoice read release; no provider call, chase or client flag. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { savedCliToken } from "./learn-test-readiness.mjs";

export const PROJECT = "tgbnakbxwcqjeimygroz";
export const TENANT = "00000000-0000-0000-0000-000000000001";
export const VERSION = "20261110110000";
export const NAME = "new_dawn_md_aged_invoice_review";
export const SOURCE_SHA256 = "3ae0105b9918d2d9d3b54a8aece603ea00a5c59d54175f223d3905618248d270";
export const FUNCTION_SHA256 = "ee958166ebf4a3552794a4cec7761b744634785ccb07ba474bb1a6b0bd794e1a";
const PRIOR_VERSION = "20261110100000";
const PRIOR_NAME = "new_dawn_client_job_record";
const PRIOR_SHA256 = "927b0791219dfdcc2e0a7977d9ba78c195cbadef87961562a59c7b789c38298e";
const RPC = "public.new_dawn_md_aged_invoice_review(uuid,text,date,uuid)";
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";

export function reviewedSource() {
  const source = readFileSync(new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`, import.meta.url), "utf8");
  const hash = createHash("sha256").update(source).digest("hex");
  if (hash !== SOURCE_SHA256 || !/^\s*(?:--[^\n]*\n)*begin;\s*$/im.test(source) ||
    !/\ncommit;\s*$/i.test(source)) throw Error("aged_invoice_source_changed");
  const body = source.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im, "")
    .replace(/\ncommit;\s*$/i, "");
  if (/^\s*(?:begin|commit);\s*$/im.test(body)) throw Error("aged_invoice_nested_transaction");
  return { source, body, hash };
}

const ledgerSql = `select version::text,name,array_length(statements,1) statement_count,
 encode(sha256(convert_to(statements[1],'UTF8')),'hex') source_sha256
 from supabase_migrations.schema_migrations
 where version::text in ('${PRIOR_VERSION}','${VERSION}') order by version`;
const catalogSql = `select
 to_regprocedure('${RPC}') is not null as rpc_installed,
 case when to_regprocedure('${RPC}') is null then null else
  encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${RPC}')),'UTF8')),'hex') end as rpc_sha256,
 case when to_regprocedure('${RPC}') is null then null else
  (select p.prosecdef from pg_proc p where p.oid=to_regprocedure('${RPC}')) end as security_definer,
 case when to_regprocedure('${RPC}') is null then null else
  has_function_privilege('authenticated','${RPC}','execute') end as authenticated_grant,
 case when to_regprocedure('${RPC}') is null then null else
  has_function_privilege('anon','${RPC}','execute') end as anon_grant,
 (select count(*)::int from public.learn_quickbooks_connections where tenant_id='${TENANT}'::uuid
  and environment='production' and confirmed_at is not null and realm_id is not null
  and status<>'disconnected') as confirmed_connections,
 (select count(*)::int from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag='new_dawn.invoice_review_candidates_preview' and value='true'::jsonb) as review_flag_on`;

export function assess(snapshot, installed, file = reviewedSource()) {
  if (snapshot?.project?.id !== PROJECT || snapshot.project.status !== "ACTIVE_HEALTHY" ||
    !Array.isArray(snapshot.ledger) || snapshot.ledger.length !== 1 + Number(installed))
    throw Error("aged_invoice_project_or_ledger_changed");
  const prior = snapshot.ledger.find(row => row?.version === PRIOR_VERSION);
  const current = snapshot.ledger.find(row => row?.version === VERSION);
  if (prior?.name !== PRIOR_NAME || prior.statement_count !== 1 ||
    prior.source_sha256 !== PRIOR_SHA256 ||
    (installed && (current?.name !== NAME || current.statement_count !== 1 ||
      current.source_sha256 !== file.hash)) || (!installed && current))
    throw Error("aged_invoice_ledger_changed");
  const c = snapshot.catalog?.[0];
  if (!c || snapshot.catalog.length !== 1 ||
    c.rpc_installed !== installed ||
    c.rpc_sha256 !== (installed ? FUNCTION_SHA256 : null) ||
    c.security_definer !== (installed ? true : null) ||
    c.authenticated_grant !== (installed ? true : null) ||
    c.anon_grant !== (installed ? false : null) ||
    c.confirmed_connections !== 1 || c.review_flag_on !== 1)
    throw Error("aged_invoice_catalog_or_scope_changed");
  return { state: installed ? "aged_invoice_read_installed" : "aged_invoice_read_ready",
    version: VERSION, sourceSha256: file.hash,
    providerRequests: 0, moneyActions: 0, staffAccessChanges: 0 };
}

export function releaseSql(file = reviewedSource()) {
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
lock table public.feature_flags in share mode;
do $aged_gate$ begin
 if not exists(select 1 from supabase_migrations.schema_migrations
   where version::text='${PRIOR_VERSION}' and name='${PRIOR_NAME}'
   and array_length(statements,1)=1
   and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${PRIOR_SHA256}')
  or exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}')
  or to_regprocedure('${RPC}') is not null
  or (select count(*) from public.learn_quickbooks_connections
      where tenant_id='${TENANT}'::uuid and environment='production'
      and confirmed_at is not null and realm_id is not null and status<>'disconnected')<>1
  or not exists(select 1 from public.feature_flags
      where tenant_id='${TENANT}'::uuid and flag='new_dawn.invoice_review_candidates_preview'
      and value='true'::jsonb)
 then raise exception 'aged_invoice_install_preflight_changed';end if;
end $aged_gate$;
${file.body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(file.source)}]);
select '${VERSION}' as installed_aged_invoice_version;
commit;`;
}

async function management(project, token, path, query, readOnly = true, fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${token}`,
      ...(query ? { "Content-Type": "application/json" } : {}) },
    ...(query ? { body: JSON.stringify({ query, ...(readOnly ? {} : { read_only: false }) }) } : {}),
  });
  if (!response.ok) throw Error(`aged_invoice_management_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 1024 * 1024) throw Error("aged_invoice_management_response_oversized");
  return JSON.parse(bytes.toString("utf8"));
}
export async function readStage(project = PROJECT, token = savedCliToken(), fetcher = fetch) {
  if (project !== PROJECT) throw Error("exact_live_project_required");
  const q = sql => management(project, token, "/database/query/read-only", sql, true, fetcher);
  return { project: await management(project, token, "", null, true, fetcher),
    ledger: await q(ledgerSql), catalog: await q(catalogSql) };
}
export async function installLive({ project = PROJECT, token = savedCliToken(),
  read = readStage, write } = {}) {
  if (project !== PROJECT) throw Error("exact_live_project_required");
  const file = reviewedSource();
  assess(await read(project, token), false, file);
  const writer = write ?? (sql => management(project, token, "/database/query", sql, false));
  let acknowledged = false;
  try {
    const rows = await writer(releaseSql(file));
    acknowledged = Array.isArray(rows) &&
      rows.some(row => row?.installed_aged_invoice_version === VERSION);
  } catch { /* Unknown outcome gets one independent readback, never a replay. */ }
  try {
    return { ...assess(await read(project, token), true, file),
      ledgerReadbackVerified: true, writeAcknowledged: acknowledged };
  } catch { throw Error("aged_invoice_outcome_unverified_no_replay"); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.NEW_DAWN_M3_ALLOW_PROJECT !== PROJECT)
      throw Error("explicit_exact_live_project_required");
    const mode = process.argv.slice(2).join(" ");
    if (mode === "--live-read-only") {
      const snapshot = await readStage();
      console.log(JSON.stringify(assess(snapshot, snapshot.ledger?.length === 2)));
    } else if (mode === "--live-install-exact") {
      if (process.env.NEW_DAWN_M3_ALLOW_VERSION !== VERSION ||
        process.env.NEW_DAWN_M3_ALLOW_SOURCE_SHA256 !== SOURCE_SHA256)
        throw Error("explicit_exact_aged_source_required");
      console.log(JSON.stringify(await installLive()));
    } else throw Error("explicit_exact_aged_action_required");
  } catch (error) {
    console.error(JSON.stringify({ state: "aged_invoice_release_stopped",
      code: error instanceof Error ? error.message : "unknown",
      retryAllowed: false, providerRequests: 0, moneyActions: 0 }));
    process.exitCode = 1;
  }
}
