/** Exact Drummonds-only operator comparison switch. No provider request or client grant. */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { savedCliToken } from "./learn-test-readiness.mjs";
import { PROJECT, TENANT, VERSION, NAME, SHA256, source } from "./new-dawn-invoice-job-pair-release.mjs";

export const FLAG = "new_dawn.invoice_job_pair_source_preview";
const RPC = "public.new_dawn_invoice_job_pair_source(uuid,uuid,uuid,text)";
const FUNCTION_SHA256 = "1576eae7e70a474c99eb4641250474af58a31a6f8600db002de265a5793e183a";
const CLIENT_MONEY_FLAGS = ["new_dawn.owner_money", "new_dawn.owner_report_review", "new_dawn.owner_accounts_report"];
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const flags = CLIENT_MONEY_FLAGS.map(value => `'${value}'`).join(",");
const catalog = `select
 to_regprocedure('${RPC}') is not null as installed,
 coalesce(has_function_privilege('anon',to_regprocedure('${RPC}'),'EXECUTE'),false) as anon_execute,
 coalesce(has_function_privilege('authenticated',to_regprocedure('${RPC}'),'EXECUTE'),false) as operator_execute,
 coalesce(has_function_privilege('service_role',to_regprocedure('${RPC}'),'EXECUTE'),false) as service_execute,
 encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${RPC}')),'UTF8')),'hex') as function_sha256,
 (select count(*)::int from supabase_migrations.schema_migrations where version::text='${VERSION}') as ledger_count,
 (select name from supabase_migrations.schema_migrations where version::text='${VERSION}' limit 1) as ledger_name,
 (select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version::text='${VERSION}' limit 1) as ledger_hash,
 (select count(*)::int from public.feature_flags where flag='${FLAG}') as target_rows,
 (select count(*)::int from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${FLAG}' and value='true'::jsonb) as target_on,
 (select count(*)::int from public.feature_flags where flag='${FLAG}' and tenant_id is distinct from '${TENANT}'::uuid) as other_rows,
 (select count(*)::int from public.feature_flags where flag in (${flags}) and value='true'::jsonb) as client_money_on,
 (select count(*)::int from public.tenants where id='${TENANT}'::uuid and status='active') as active_tenant,
 (select count(*)::int from public.learn_quickbooks_connections where tenant_id='${TENANT}'::uuid and environment='production' and confirmed_at is not null and realm_id is not null and status<>'disconnected') as confirmed_realms,
 (select count(*)::int from pg_trigger where tgrelid='public.controlplane_change_log'::regclass and tgname in ('controlplane_change_log_no_update','controlplane_change_log_no_delete') and not tgisinternal and tgenabled='O') as audit_triggers`;
const auditQuery = id => `select id::text,tenant_id::text,actor,action,resource_type,resource_id,before,after,reason,source,view_as_active,correlation_id from public.controlplane_change_log where id='${id}'::uuid`;

async function management(token, path, query, readOnly = true, fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${PROJECT}${path}`, {
    method: query ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${token}`, ...(query ? { "Content-Type": "application/json" } : {}) },
    ...(query ? { body: JSON.stringify({ query, read_only: readOnly }) } : {}),
  });
  if (!response.ok) throw Error(`m3_pair_flag_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 1_000_000) throw Error("m3_pair_flag_response_too_large");
  return JSON.parse(bytes.toString("utf8"));
}

export async function readScope(token = savedCliToken(), auditId = null, fetcher = fetch) {
  if (auditId !== null && !uuid(auditId)) throw Error("m3_pair_flag_invalid_audit_id");
  const [project, rows, audit] = await Promise.all([
    management(token, "", null, true, fetcher),
    management(token, "/database/query/read-only", catalog, true, fetcher),
    auditId ? management(token, "/database/query/read-only", auditQuery(auditId), true, fetcher) : Promise.resolve([]),
  ]);
  return { project, rows, audit };
}

export function assess(snapshot, enabled, { withdrawal = false } = {}) {
  const c = snapshot?.rows?.[0];
  if (snapshot?.project?.id !== PROJECT || snapshot.project.status !== "ACTIVE_HEALTHY" ||
    snapshot.rows?.length !== 1 || !c ||
    ![0, 1].includes(c.target_rows) || c.target_on !== Number(enabled) ||
    c.other_rows !== 0 || c.audit_triggers !== 2 ||
    (enabled && c.target_rows !== 1) ||
    (!withdrawal && (c.installed !== true || c.anon_execute !== false ||
      c.operator_execute !== true || c.service_execute !== false ||
      c.function_sha256 !== FUNCTION_SHA256 || c.ledger_count !== 1 ||
      c.ledger_name !== NAME || c.ledger_hash !== SHA256 ||
      c.client_money_on !== 0 || c.active_tenant !== 1 ||
      c.confirmed_realms !== 1))) throw Error("m3_pair_flag_scope_changed");
  if (!withdrawal) source();
  return { state: enabled ? "drummonds_operator_pair_review_on" : "operator_pair_review_off",
    project: PROJECT, tenant: TENANT, sourceSha256: SHA256, operatorFlagEnabled: enabled,
    clientMoneyFlagsEnabled: false, providerRequests: 0 };
}

export function flagSql(enable, auditId) {
  if (typeof enable !== "boolean" || !uuid(auditId)) throw Error("m3_pair_flag_invalid_action");
  const target = enable ? "true" : "false";
  const prior = enable ? "false" : "true";
  const action = `new_dawn.invoice_job_pair_source_preview.${enable ? "enable" : "disable"}`;
  const preflight = enable ? `
 if to_regprocedure('${RPC}') is null
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${RPC}')),'UTF8')),'hex')<>'${FUNCTION_SHA256}'
  or not has_function_privilege('authenticated','${RPC}','execute')
  or has_function_privilege('anon','${RPC}','execute')
  or has_function_privilege('service_role','${RPC}','execute')
  or not exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}' and name='${NAME}' and cardinality(statements)=1 and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${SHA256}')
  or (select count(*) from public.tenants where id='${TENANT}'::uuid and status='active')<>1
  or (select count(*) from public.learn_quickbooks_connections where tenant_id='${TENANT}'::uuid and environment='production' and confirmed_at is not null and realm_id is not null and status<>'disconnected')<>1
  or exists(select 1 from public.feature_flags where flag in (${flags}) and value='true'::jsonb)
  or (select count(*) from public.feature_flags where flag='${FLAG}')>1
  or (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${FLAG}' and value='true'::jsonb)<>0` : `
 if (select count(*) from public.feature_flags where flag='${FLAG}')<>1
  or (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${FLAG}' and value='true'::jsonb)<>1`;
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.feature_flags in share row exclusive mode;
lock table public.controlplane_change_log in share row exclusive mode;
do $gate$ begin${preflight}
  or (select count(*) from pg_trigger where tgrelid='public.controlplane_change_log'::regclass and tgname in ('controlplane_change_log_no_update','controlplane_change_log_no_delete') and not tgisinternal and tgenabled='O')<>2
  or exists(select 1 from public.feature_flags where flag='${FLAG}' and tenant_id is distinct from '${TENANT}'::uuid)
  or exists(select 1 from public.controlplane_change_log where id='${auditId}'::uuid)
 then raise exception 'm3_pair_flag_preflight_changed';end if;
 update public.feature_flags set value='${target}'::jsonb where tenant_id='${TENANT}'::uuid and flag='${FLAG}';
 ${enable ? `if not found then insert into public.feature_flags(tenant_id,flag,value) values('${TENANT}'::uuid,'${FLAG}','true'::jsonb);end if;` : `if not found then raise exception 'm3_pair_flag_missing';end if;`}
 if (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${FLAG}' and value='true'::jsonb)<>${Number(enable)}
 then raise exception 'm3_pair_flag_postcheck_changed';end if;
 insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,resource_id,before,after,reason,correlation_id,view_as_active,source)
 values('${auditId}'::uuid,'${TENANT}'::uuid,'codex:delegated-openfolk-operator','${action}','feature_flag','${FLAG}',jsonb_build_object('enabled',${prior}),jsonb_build_object('enabled',${target}),'Reviewed exact invoice/job source comparison for OpenFolk operator only','${auditId}',false,'codex-release');
end $gate$;
select 'm3-pair-flag-${enable ? "enabled" : "disabled"}/1' as marker;
commit;`;
}

export function assessAudit(snapshot, auditId, enable) {
  const a = snapshot?.audit?.[0];
  if (!uuid(auditId) || snapshot.audit?.length !== 1 || a?.id !== auditId || a.tenant_id !== TENANT ||
    a.actor !== "codex:delegated-openfolk-operator" ||
    a.action !== `new_dawn.invoice_job_pair_source_preview.${enable ? "enable" : "disable"}` ||
    a.resource_type !== "feature_flag" || a.resource_id !== FLAG ||
    a.before?.enabled !== !enable || a.after?.enabled !== enable ||
    a.source !== "codex-release" || a.view_as_active !== false ||
    a.correlation_id !== auditId || typeof a.reason !== "string" || !a.reason)
    throw Error("m3_pair_flag_audit_changed");
}

export async function switchLive(enable, { token = savedCliToken(), auditId = randomUUID(),
  read = readScope, write } = {}) {
  assess(await read(token), !enable, { withdrawal: !enable });
  let acknowledged = false;
  try {
    const rows = await (write ?? (sql => management(token, "/database/query", sql, false)))(flagSql(enable, auditId));
    acknowledged = Array.isArray(rows) && rows.some(row => row?.marker ===
      `m3-pair-flag-${enable ? "enabled" : "disabled"}/1`);
  } catch { /* Read back once; an uncertain write is never replayed. */ }
  let result;
  try {
    const after = await read(token, auditId);
    result = assess(after, enable, { withdrawal: !enable });
    assessAudit(after, auditId, enable);
  } catch { throw Error("m3_pair_flag_outcome_unverified_no_replay"); }
  return { ...result, auditId, acknowledged, readbackVerified: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.NEW_DAWN_M3_PAIR_PROJECT !== PROJECT ||
      process.env.NEW_DAWN_M3_PAIR_FLAG !== FLAG) throw Error("m3_pair_exact_scope_required");
    const mode = process.argv.slice(2).join(" ");
    if (mode === "--live-read-only") {
      const snapshot = await readScope();
      console.log(JSON.stringify(assess(snapshot, snapshot.rows?.[0]?.target_on === 1)));
    } else if (mode === "--live-enable-operator-only")
      console.log(JSON.stringify(await switchLive(true)));
    else if (mode === "--live-disable-operator-only")
      console.log(JSON.stringify(await switchLive(false)));
    else throw Error("m3_pair_action_required");
  } catch (error) {
    console.error(JSON.stringify({ state: "m3_pair_flag_stopped",
      reason: error instanceof Error ? error.message : "unknown", retryAllowed: false }));
    process.exitCode = 1;
  }
}
