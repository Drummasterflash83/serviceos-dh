/** One Drummonds-only, operator-only opportunity source trial. No provider call. */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { savedCliToken } from "./learn-test-readiness.mjs";
import {
  LIVE_PROJECT,
  VERSION,
  NAME,
  SOURCE_SHA256,
  FUNCTION_HASHES,
  SQL_SCHEMA_SHA256,
  catalogSql,
  exactLedger,
  assessCatalog,
} from "./new-dawn-m5-ledger-reconcile.mjs";

export const TENANT = "00000000-0000-0000-0000-000000000001";
export const FLAG = "new_dawn.m5_opportunities_probe";
const EDGE = Object.freeze({
  slug: "learn-commusoft-opportunity-probe",
  id: "cf8d9ce2-0e45-4d8c-a795-4ee4793ab143",
  version: 2,
  hash: "ee6249254a0af98820bb44135641ae4735965e2b9779ac4ea27325ab1b748c09",
});
const uuid = (value) =>
  typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const enabled = `(select count(*) from public.feature_flags where flag='${FLAG}' and value='true'::jsonb)`;
const tenantEnabled = `(select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${FLAG}' and value='true'::jsonb)`;
const otherRows = `(select count(*) from public.feature_flags where flag='${FLAG}' and tenant_id is distinct from '${TENANT}'::uuid)`;
const scopeSql = `select
 (select count(*)::int from public.feature_flags where flag='${FLAG}') as flag_rows,
 ${enabled}::int as enabled_global,
 ${tenantEnabled}::int as enabled_tenant,
 ${otherRows}::int as other_rows,
 (select count(*)::int from public.new_dawn_commusoft_opportunity_probes where tenant_id='${TENANT}'::uuid) as receipt_count,
 exists(select 1 from public.new_dawn_commusoft_opportunity_probes where tenant_id='${TENANT}'::uuid
  and state in ('prepared','claimed') and expires_at>clock_timestamp()) as active_probe,
 exists(select 1 from public.platform_jobs where tenant_id='${TENANT}'::uuid
  and job_type='commusoft.source_sync' and status in ('queued','running','retrying')) as active_import,
 exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active') as active_tenant,
 (select count(*)::int from public.provider_connections where tenant_id='${TENANT}'::uuid
  and provider='commusoft') as connection_count,
 (select count(*)::int from pg_trigger where tgrelid='public.controlplane_change_log'::regclass
  and tgname in ('controlplane_change_log_no_update','controlplane_change_log_no_delete')
  and not tgisinternal and tgenabled='O') as audit_guards`;
const ledgerSql = `select version::text,name,statements from supabase_migrations.schema_migrations
 where version::text='${VERSION}'`;
const auditSql = (id) => `select id::text,tenant_id::text,actor,action,resource_type,resource_id,
 before,after,reason,source,view_as_active,correlation_id
 from public.controlplane_change_log where id='${id}'::uuid`;

async function management(path, query, token, readOnly = true, fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${LIVE_PROJECT}${path}`, {
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
  if (!response.ok) throw Error(`m5_flag_${readOnly ? "read" : "write"}_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 1024 * 1024) throw Error("m5_flag_response_oversized");
  return JSON.parse(bytes.toString("utf8"));
}

export async function readScope(token = savedCliToken(), auditId = null, fetcher = fetch) {
  if (auditId !== null && !uuid(auditId)) throw Error("m5_flag_audit_id_invalid");
  const q = (sql) => management("/database/query/read-only", sql, token, true, fetcher);
  const [project, functions, flags, ledger, audit] = await Promise.all([
    management("", null, token, true, fetcher),
    management("/functions", null, token, true, fetcher),
    q(scopeSql),
    q(ledgerSql),
    auditId === null ? Promise.resolve([]) : q(auditSql(auditId)),
  ]);
  return { project, functions, flags, ledger, audit };
}

export async function verifyExactCatalog(token = savedCliToken(), fetcher = fetch) {
  const response = await management("/database/query/read-only", catalogSql, token, true, fetcher);
  if (!Array.isArray(response) || response.length !== 1 || !response[0]?.catalog)
    throw Error("m5_exact_catalog_shape_changed");
  return assessCatalog(response[0].catalog, { requireMissing: false });
}

export function assessScope(snapshot, on, { beforeFirst = false } = {}) {
  const f = snapshot?.flags?.[0];
  const edge = snapshot?.functions?.filter?.((item) => item?.slug === EDGE.slug);
  if (
    typeof on !== "boolean" ||
    snapshot?.project?.id !== LIVE_PROJECT ||
    snapshot.project.status !== "ACTIVE_HEALTHY" ||
    snapshot.flags?.length !== 1 ||
    !f ||
    edge?.length !== 1 ||
    edge[0].id !== EDGE.id ||
    edge[0].version !== EDGE.version ||
    edge[0].ezbr_sha256 !== EDGE.hash ||
    edge[0].verify_jwt !== false ||
    edge[0].status !== "ACTIVE" ||
    f.enabled_global !== Number(on) ||
    f.enabled_tenant !== Number(on) ||
    f.other_rows !== 0 ||
    (on ? f.flag_rows !== 1 : ![0, 1].includes(f.flag_rows)) ||
    f.active_tenant !== true ||
    f.active_import !== false ||
    f.active_probe !== false ||
    f.connection_count < 1 ||
    f.audit_guards !== 2 ||
    !Number.isSafeInteger(f.receipt_count) ||
    f.receipt_count < 0 ||
    (beforeFirst && f.receipt_count !== 0) ||
    !exactLedger(snapshot.ledger)
  )
    throw Error("m5_flag_scope_changed");
  return {
    state: on ? "drummonds_operator_source_trial_on" : "opportunity_source_trial_off",
    project: LIVE_PROJECT,
    tenant: TENANT,
    flagEnabled: on,
    receiptCount: f.receipt_count,
    providerRequests: 0,
  };
}

/** Withdrawal remains possible if the source runtime or queue changed mid-trial. */
export function assessWithdrawalScope(snapshot, on) {
  const f = snapshot?.flags?.[0];
  if (
    typeof on !== "boolean" ||
    snapshot?.project?.id !== LIVE_PROJECT ||
    snapshot.project.status !== "ACTIVE_HEALTHY" ||
    snapshot.flags?.length !== 1 ||
    !f ||
    f.flag_rows !== 1 ||
    f.enabled_global !== Number(on) ||
    f.enabled_tenant !== Number(on) ||
    f.other_rows !== 0 ||
    f.audit_guards !== 2
  )
    throw Error("m5_flag_withdraw_scope_changed");
  return {
    state: on ? "drummonds_operator_source_trial_on" : "opportunity_source_trial_off",
    project: LIVE_PROJECT,
    tenant: TENANT,
    flagEnabled: on,
    receiptCount: f.receipt_count,
    providerRequests: 0,
  };
}

export function assessAudit(snapshot, auditId, on) {
  const a = snapshot?.audit?.[0];
  if (
    !uuid(auditId) ||
    snapshot.audit?.length !== 1 ||
    !a ||
    a.id !== auditId ||
    a.tenant_id !== TENANT ||
    a.actor !== "codex:delegated-openfolk-operator" ||
    a.action !== `new_dawn.m5_opportunities_probe.${on ? "enable" : "disable"}` ||
    a.resource_type !== "feature_flag" ||
    a.resource_id !== FLAG ||
    a.before?.enabled !== !on ||
    a.after?.enabled !== on ||
    a.source !== "codex-release" ||
    a.view_as_active !== false ||
    a.correlation_id !== auditId ||
    typeof a.reason !== "string" ||
    !a.reason
  )
    throw Error("m5_flag_audit_changed");
  return auditId;
}

const functionHashesSql = Object.entries(FUNCTION_HASHES)
  .map(([signature, digest]) => `('${signature}','${digest}')`)
  .join(",");

/** One flag row and one immutable audit row; unchanged schema and no provider call. */
export function flagSql(on, auditId) {
  if (typeof on !== "boolean" || !uuid(auditId)) throw Error("m5_flag_invalid_action");
  const action = `new_dawn.m5_opportunities_probe.${on ? "enable" : "disable"}`;
  const preflight = on
    ? `
 if not exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}'
   and name='${NAME}' and array_length(statements,1)=1
   and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${SOURCE_SHA256}')
  or (select encode(sha256(convert_to((catalog->'tables')::text,'UTF8')),'hex')
      from (${catalogSql}) m5_catalog) is distinct from '${SQL_SCHEMA_SHA256}'
  or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like 'new_dawn_commusoft_opportunity_probe_%')<>10
  or exists(select 1 from (values ${functionHashesSql}) expected(signature,digest)
   left join pg_proc p on p.proname||'('||oidvectortypes(p.proargtypes)||')'=expected.signature
    and p.pronamespace='public'::regnamespace
   where encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')
     is distinct from expected.digest)
  or exists(select 1 from public.platform_jobs where tenant_id='${TENANT}'::uuid
      and job_type='commusoft.source_sync' and status in ('queued','running','retrying'))
  or exists(select 1 from public.new_dawn_commusoft_opportunity_probes where tenant_id='${TENANT}'::uuid)
  or not exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active')
  or not exists(select 1 from public.provider_connections where tenant_id='${TENANT}'::uuid
      and provider='commusoft')
  or ${enabled}<>0 or ${otherRows}<>0
  or (select count(*) from public.feature_flags where flag='${FLAG}')>1
 then raise exception 'm5_flag_enable_preflight_changed';end if;`
    : `
 if ${enabled}<>1 or ${tenantEnabled}<>1 or ${otherRows}<>0
  or (select count(*) from public.feature_flags where flag='${FLAG}')<>1
 then raise exception 'm5_flag_disable_preflight_changed';end if;`;
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.feature_flags in share row exclusive mode;
lock table public.controlplane_change_log in share row exclusive mode;
do $m5_flag$ begin
 if exists(select 1 from public.controlplane_change_log where id='${auditId}'::uuid)
 then raise exception 'm5_flag_audit_reused';end if;${preflight}
 update public.feature_flags set value='${on ? "true" : "false"}'::jsonb
  where tenant_id='${TENANT}'::uuid and flag='${FLAG}';
 ${
   on
     ? `if not found then insert into public.feature_flags(tenant_id,flag,value)
  values('${TENANT}'::uuid,'${FLAG}','true'::jsonb);end if;`
     : `if not found then raise exception 'm5_flag_disable_missing';end if;`
 }
 if ${enabled}<>${Number(on)} or ${tenantEnabled}<>${Number(on)} or ${otherRows}<>0
 then raise exception 'm5_flag_postcheck_changed';end if;
 insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,
  resource_id,before,after,reason,correlation_id,view_as_active,source)
 values('${auditId}'::uuid,'${TENANT}'::uuid,'codex:delegated-openfolk-operator',
  '${action}','feature_flag','${FLAG}',jsonb_build_object('enabled',${!on}),
  jsonb_build_object('enabled',${on}),
  'Reviewed Drummonds one-page opportunity source trial',
  '${auditId}',false,'codex-release');
 if (select count(*) from public.controlplane_change_log where id='${auditId}'::uuid)<>1
 then raise exception 'm5_flag_audit_missing';end if;
end $m5_flag$;
select 'm5-opportunity-source-${on ? "enabled" : "disabled"}/1' as marker;
commit;`;
}

/** Unknown write outcome gets one fresh readback, never an automatic replay. */
export async function switchLive(
  on,
  {
    token = savedCliToken(),
    auditId = randomUUID(),
    read = readScope,
    verifyCatalog = verifyExactCatalog,
    write,
  } = {},
) {
  if (typeof on !== "boolean" || !uuid(auditId)) throw Error("m5_flag_invalid_action");
  if (on) assessScope(await read(token, null), false, { beforeFirst: true });
  else assessWithdrawalScope(await read(token, null), true);
  if (on) await verifyCatalog(token);
  const writer = write ?? ((sql) => management("/database/query", sql, token, false));
  let acknowledged = false;
  try {
    const rows = await writer(flagSql(on, auditId));
    acknowledged =
      Array.isArray(rows) &&
      rows.some((row) => row?.marker === `m5-opportunity-source-${on ? "enabled" : "disabled"}/1`);
  } catch {
    /* Do not replay an uncertain write. */
  }
  let result;
  try {
    const after = await read(token, auditId);
    result = on
      ? assessScope(after, true, { beforeFirst: true })
      : assessWithdrawalScope(after, false);
    assessAudit(after, auditId, on);
  } catch {
    throw Error("m5_flag_outcome_unverified_no_replay");
  }
  return { ...result, auditId, acknowledged, readbackVerified: true };
}

/** Rehearse the exact enable transaction on LIVE, ending in ROLLBACK. */
export async function rehearseLiveRollback({
  token = savedCliToken(),
  auditId = randomUUID(),
  read = readScope,
  verifyCatalog = verifyExactCatalog,
  write,
} = {}) {
  if (!uuid(auditId)) throw Error("m5_flag_invalid_audit_id");
  const before = assessScope(await read(token, null), false, { beforeFirst: true });
  await verifyCatalog(token);
  const sql = flagSql(true, auditId).replace(/\ncommit;$/, "\nrollback;");
  if (!sql.endsWith("\nrollback;") || sql.includes("\ncommit;"))
    throw Error("m5_rollback_fence_changed");
  let rows, failure;
  try {
    rows = await (write ?? ((query) => management("/database/query", query, token, false)))(sql);
  } catch (error) {
    failure = error;
  }
  let after;
  try {
    const snapshot = await read(token, auditId);
    after = assessScope(snapshot, false, { beforeFirst: true });
    if (snapshot.audit?.length !== 0) throw Error("m5_rollback_audit_retained");
  } catch {
    throw Error("m5_rollback_outcome_unverified_no_replay");
  }
  if (before.receiptCount !== after.receiptCount) throw Error("m5_rollback_receipt_changed");
  if (failure) throw failure;
  if (
    !Array.isArray(rows) ||
    !rows.some((row) => row?.marker === "m5-opportunity-source-enabled/1")
  )
    throw Error("m5_rollback_marker_missing");
  return {
    state: "exact_flag_enable_rolled_back",
    project: LIVE_PROJECT,
    tenant: TENANT,
    flagEnabled: false,
    providerRequests: 0,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.NEW_DAWN_M5_ALLOW_PROJECT !== LIVE_PROJECT)
      throw Error("m5_exact_project_required");
    const mode = process.argv.slice(2).join(" ");
    if (mode === "--live-read-only") {
      const snapshot = await readScope();
      const result = assessScope(snapshot, snapshot.flags?.[0]?.enabled_tenant === 1);
      if (!result.flagEnabled && result.receiptCount === 0) await verifyExactCatalog();
      console.log(JSON.stringify(result));
    } else if (process.env.NEW_DAWN_M5_ALLOW_FLAG === FLAG && mode === "--live-enable-one-page")
      console.log(JSON.stringify(await switchLive(true)));
    else if (process.env.NEW_DAWN_M5_ALLOW_FLAG === FLAG && mode === "--live-disable-one-page")
      console.log(JSON.stringify(await switchLive(false)));
    else if (process.env.NEW_DAWN_M5_ALLOW_FLAG === FLAG && mode === "--live-rollback-only")
      console.log(JSON.stringify(await rehearseLiveRollback()));
    else throw Error("m5_exact_flag_action_required");
  } catch (error) {
    console.error(
      JSON.stringify({
        state: "m5_flag_stopped",
        code: error instanceof Error ? error.message : "unknown",
        retryAllowed: false,
        providerRequests: 0,
      }),
    );
    process.exitCode = 1;
  }
}
