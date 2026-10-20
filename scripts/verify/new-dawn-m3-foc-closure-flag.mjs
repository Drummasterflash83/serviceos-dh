/** One Drummonds-only private FOC review switch, with a separate withdrawal path. */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { savedCliToken } from "./learn-test-readiness.mjs";
import {
  PROJECT,
  TENANT,
  VERSION,
  NAME,
  SOURCE_SHA256,
  reviewedSource,
} from "./new-dawn-m3-foc-closure-release.mjs";

export const FLAG = "new_dawn.m3_foc_closure_review";
const RPC = "public.new_dawn_foc_closure_review(uuid,text)";
const RPC_SHA256 = "f3a8d3bc8e708c35feb2f819fc89037a446a97fc5051d92ef4d30c1fe4550697";
const CLIENT_FLAGS = [
  "new_dawn.owner_money",
  "new_dawn.owner_report_review",
  "new_dawn.owner_accounts_report",
];
const clientFlags = CLIENT_FLAGS.map((value) => `'${value}'`).join(",");
const uuid = (value) =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
const reasonText = (value) => {
  const reason = typeof value === "string" ? value.trim() : "";
  if (reason.length < 3 || reason.length > 500 || /[\x00-\x1f\x7f]/.test(reason))
    throw Error("foc_flag_review_reason_required");
  return reason;
};
const targetOn = `(select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${FLAG}' and value='true'::jsonb)`;
const globalOn = `(select count(*) from public.feature_flags where flag='${FLAG}' and value='true'::jsonb)`;
const otherRows = `exists(select 1 from public.feature_flags where flag='${FLAG}' and tenant_id is distinct from '${TENANT}'::uuid)`;
const clientOn = `exists(select 1 from public.feature_flags where flag in (${clientFlags}) and value='true'::jsonb)`;
const auditTriggers = `(select count(*) from pg_trigger where tgrelid='public.controlplane_change_log'::regclass and tgname in ('controlplane_change_log_no_update','controlplane_change_log_no_delete') and not tgisinternal and tgenabled='O')`;

// Match the private RPC's current-source eligibility, without reading content
// or bypassing its OFF flag. An older FOC receipt cannot count after a newer
// exact detail or changed reviewed job link.
export const candidateCount = `(with latest_detail as materialized (
 select distinct on(r.job_id) r.* from public.new_dawn_commusoft_job_detail_reads r
 where r.tenant_id='${TENANT}'::uuid and r.state='complete'
 order by r.job_id,r.checked_at desc,r.id desc
), eligible as materialized (
 select r.job_id from latest_detail r
 join public.jobs j on j.id=r.job_id and j.tenant_id='${TENANT}'::uuid
 join public.learn_business_input_current_links l on l.tenant_id='${TENANT}'::uuid
  and l.entity_kind='job' and l.entity_table='jobs' and l.entity_id=r.job_id
  and l.provider='commusoft' and l.collection='jobs'
  and l.connection_id=r.connection_id and l.source_version_id=r.source_version_id
  and l.external_id=r.external_id
 join public.learn_business_input_versions v on v.id=r.source_version_id
  and v.tenant_id='${TENANT}'::uuid and v.connection_id=r.connection_id
  and v.provider='commusoft' and v.collection='jobs' and v.external_id=r.external_id
 where r.result->>'version'='commusoft-exact-job-detail/5'
  and r.result#>>'{source_closure_facts,closedOutcome,state}'='present'
  and r.result#>>'{source_closure_facts,closedOutcome,value}'='FreeOfCharge'
  and r.raw_sha256~'^[0-9a-f]{64}$' and v.content_hash~'^[0-9a-f]{64}$'
  and j.metadata#>>'{learn_business_input,source_version_id}'=r.source_version_id::text
  and j.metadata#>>'{learn_business_input,connection_id}'=r.connection_id::text
  and j.source_system='commusoft:connection:'||r.connection_id::text
  and j.external_id=r.external_id
  and (select count(*) from public.learn_business_input_current_links x
   where x.tenant_id='${TENANT}'::uuid and x.entity_kind='job' and x.entity_table='jobs'
    and x.entity_id=r.job_id and x.provider='commusoft' and x.collection='jobs')=1
  and (select count(distinct s.id) from public.learn_business_input_versions s
   join public.learn_business_input_observations o on o.version_id=s.id
   join public.learn_business_input_pages p on p.id=o.page_id
   where s.tenant_id='${TENANT}'::uuid and s.connection_id=r.connection_id
    and s.provider='commusoft' and s.collection='jobs' and s.external_id=r.external_id
    and p.tenant_id=s.tenant_id and p.connection_id=s.connection_id
    and p.provider=s.provider and p.collection=s.collection
    and p.committed_at=(select max(p2.committed_at) from public.learn_business_input_versions s2
     join public.learn_business_input_observations o2 on o2.version_id=s2.id
     join public.learn_business_input_pages p2 on p2.id=o2.page_id
     where s2.tenant_id=s.tenant_id and s2.connection_id=s.connection_id
      and s2.provider=s.provider and s2.collection=s.collection and s2.external_id=s.external_id
      and p2.tenant_id=s2.tenant_id and p2.connection_id=s2.connection_id
      and p2.provider=s2.provider and p2.collection=s2.collection))=1
  and exists(select 1 from public.learn_business_input_observations o
   join public.learn_business_input_pages p on p.id=o.page_id
   where o.version_id=r.source_version_id and p.tenant_id='${TENANT}'::uuid
    and p.connection_id=r.connection_id and p.provider='commusoft' and p.collection='jobs'
    and p.committed_at=(select max(p2.committed_at) from public.learn_business_input_versions s2
     join public.learn_business_input_observations o2 on o2.version_id=s2.id
     join public.learn_business_input_pages p2 on p2.id=o2.page_id
     where s2.tenant_id='${TENANT}'::uuid and s2.connection_id=r.connection_id
      and s2.provider='commusoft' and s2.collection='jobs' and s2.external_id=r.external_id
      and p2.tenant_id=s2.tenant_id and p2.connection_id=s2.connection_id
      and p2.provider=s2.provider and p2.collection=s2.collection))
) select count(*)::int from eligible)`;

const catalogSql = `select
 to_regprocedure('${RPC}') is not null as installed,
 encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${RPC}')),'UTF8')),'hex') as function_sha256,
 coalesce(has_function_privilege('authenticated',to_regprocedure('${RPC}'),'execute'),false) as authenticated_grant,
 coalesce(has_function_privilege('anon',to_regprocedure('${RPC}'),'execute'),false) as anon_grant,
 coalesce(has_function_privilege('service_role',to_regprocedure('${RPC}'),'execute'),false) as service_grant,
 (select count(*)::int from supabase_migrations.schema_migrations where version::text='${VERSION}') as ledger_count,
 (select name from supabase_migrations.schema_migrations where version::text='${VERSION}' limit 1) as ledger_name,
 (select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version::text='${VERSION}' limit 1) as ledger_hash,
 (select count(*)::int from public.feature_flags where flag='${FLAG}') as target_rows,
 ${targetOn}::int as target_on,${globalOn}::int as global_on,
 (select count(*)::int from public.feature_flags where flag='${FLAG}' and tenant_id is distinct from '${TENANT}'::uuid) as other_rows,
 (select count(*)::int from public.feature_flags where flag in (${clientFlags}) and value='true'::jsonb) as client_money_on,
 (select count(*)::int from public.tenants where id='${TENANT}'::uuid and status='active') as active_tenant,
 ${auditTriggers}::int as audit_triggers`;
const auditSql = (id) =>
  `select id::text,tenant_id::text,actor,action,resource_type,resource_id,before,after,reason,source,view_as_active,correlation_id from public.controlplane_change_log where id='${id}'::uuid`;

async function management(token, path, query, readOnly = true, fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${PROJECT}${path}`, {
    method: query ? "POST" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(60000),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(query ? { "Content-Type": "application/json" } : {}),
    },
    ...(query ? { body: JSON.stringify({ query, read_only: readOnly }) } : {}),
  });
  if (!response.ok) throw Error(`foc_flag_${readOnly ? "read" : "write"}_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 1024 * 1024) throw Error("foc_flag_response_oversized");
  return JSON.parse(bytes.toString("utf8"));
}
export async function readFlagScope(token = savedCliToken(), auditId = null, fetcher = fetch) {
  if (auditId !== null && !uuid(auditId)) throw Error("foc_flag_audit_id_invalid");
  const [project, catalog, audit] = await Promise.all([
    management(token, "", null, true, fetcher),
    management(token, "/database/query/read-only", catalogSql, true, fetcher),
    auditId === null
      ? Promise.resolve([])
      : management(token, "/database/query/read-only", auditSql(auditId), true, fetcher),
  ]);
  return { project, catalog, audit };
}
export async function readEnableScope(token = savedCliToken(), auditId = null, fetcher = fetch) {
  const [scope, candidates] = await Promise.all([
    readFlagScope(token, auditId, fetcher),
    management(
      token,
      "/database/query/read-only",
      `select ${candidateCount} as candidate_count`,
      true,
      fetcher,
    ),
  ]);
  return { ...scope, candidates };
}
export function assessFlagScope(snapshot, on, { withdrawal = false } = {}) {
  const c = snapshot?.catalog?.[0];
  if (
    typeof on !== "boolean" ||
    snapshot?.project?.id !== PROJECT ||
    snapshot.project.status !== "ACTIVE_HEALTHY" ||
    snapshot.catalog?.length !== 1 ||
    !c ||
    ![0, 1].includes(c.target_rows) ||
    c.target_on !== Number(on) ||
    c.global_on !== Number(on) ||
    c.other_rows !== 0 ||
    (on && c.target_rows !== 1) ||
    c.audit_triggers !== 2 ||
    (!withdrawal && c.client_money_on !== 0)
  )
    throw Error("foc_flag_scope_changed");
  return {
    state: on ? "drummonds_operator_foc_review_on" : "operator_foc_review_off",
    project: PROJECT,
    tenant: TENANT,
    operatorFlagEnabled: on,
    clientMoneyFlagsEnabled: c.client_money_on !== 0,
    providerRequests: 0,
  };
}
export function assessEnableScope(snapshot, on) {
  const base = assessFlagScope(snapshot, on);
  const c = snapshot.catalog[0],
    n = snapshot.candidates?.[0]?.candidate_count;
  if (
    snapshot.candidates?.length !== 1 ||
    n !== 1 ||
    c.installed !== true ||
    c.function_sha256 !== RPC_SHA256 ||
    c.authenticated_grant !== true ||
    c.anon_grant !== false ||
    c.service_grant !== false ||
    c.ledger_count !== 1 ||
    c.ledger_name !== NAME ||
    c.ledger_hash !== SOURCE_SHA256 ||
    c.active_tenant !== 1
  )
    throw Error("foc_flag_source_changed");
  reviewedSource();
  return { ...base, sourceVersion: VERSION, sourceSha256: SOURCE_SHA256, candidateCount: n };
}
export function assessAudit(snapshot, auditId, on, reason) {
  const a = snapshot?.audit?.[0];
  if (
    !uuid(auditId) ||
    snapshot.audit?.length !== 1 ||
    a?.id !== auditId ||
    a.tenant_id !== TENANT ||
    a.actor !== "codex:delegated-openfolk-operator" ||
    a.action !== `new_dawn.m3_foc_closure_review.${on ? "enable" : "disable"}` ||
    a.resource_type !== "feature_flag" ||
    a.resource_id !== FLAG ||
    a.before?.enabled !== !on ||
    a.after?.enabled !== on ||
    a.reason !== reason ||
    a.source !== "codex-release" ||
    a.view_as_active !== false ||
    a.correlation_id !== auditId
  )
    throw Error("foc_flag_audit_changed");
}
export function flagSql(on, auditId, reasonInput) {
  if (typeof on !== "boolean" || !uuid(auditId)) throw Error("foc_flag_invalid_action");
  const reason = reasonText(reasonInput),
    state = on ? "true" : "false",
    prior = on ? "false" : "true";
  const preflight = on
    ? `
  or not exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}' and name='${NAME}' and cardinality(statements)=1 and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${SOURCE_SHA256}')
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${RPC}')),'UTF8')),'hex') is distinct from '${RPC_SHA256}'
  or not has_function_privilege('authenticated','${RPC}','execute')
  or has_function_privilege('anon','${RPC}','execute')
  or has_function_privilege('service_role','${RPC}','execute')
  or not exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active')
  or ${candidateCount}<>1 or ${clientOn}
  or ${globalOn}<>0 or (select count(*) from public.feature_flags where flag='${FLAG}')>1
  or exists(select 1 from public.feature_flags where flag='${FLAG}' and value is distinct from 'false'::jsonb)`
    : `
  or ${globalOn}<>1 or ${targetOn}<>1
  or (select count(*) from public.feature_flags where flag='${FLAG}')<>1`;
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.feature_flags in share row exclusive mode;
lock table public.controlplane_change_log in share row exclusive mode;
do $gate$ begin
 if exists(select 1 from public.controlplane_change_log where id='${auditId}'::uuid)${preflight}
  or ${otherRows} or ${auditTriggers}<>2
 then raise exception 'foc_flag_preflight_changed';end if;
 update public.feature_flags set value='${state}'::jsonb where tenant_id='${TENANT}'::uuid and flag='${FLAG}';
 ${on ? `if not found then insert into public.feature_flags(tenant_id,flag,value) values('${TENANT}'::uuid,'${FLAG}','true'::jsonb);end if;` : `if not found then raise exception 'foc_flag_missing';end if;`}
 if ${globalOn}<>${Number(on)} or ${targetOn}<>${Number(on)} or ${otherRows}${on ? ` or ${clientOn}` : ""}
 then raise exception 'foc_flag_postcheck_changed';end if;
 insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,resource_id,before,after,reason,correlation_id,view_as_active,source)
 values('${auditId}'::uuid,'${TENANT}'::uuid,'codex:delegated-openfolk-operator',
  'new_dawn.m3_foc_closure_review.${on ? "enable" : "disable"}','feature_flag','${FLAG}',
  jsonb_build_object('enabled',${prior}),jsonb_build_object('enabled',${state}),
  ${quote(reason)},'${auditId}',false,'codex-release');
 if (select count(*) from public.controlplane_change_log where id='${auditId}'::uuid)<>1
 then raise exception 'foc_flag_audit_missing';end if;
end $gate$;
select 'm3-foc-flag-${on ? "enabled" : "disabled"}/1' as marker;
commit;`;
}
export async function switchLive(
  on,
  {
    token = savedCliToken(),
    auditId = randomUUID(),
    reason,
    readEnable = readEnableScope,
    readFlag = readFlagScope,
    write,
  } = {},
) {
  if (typeof on !== "boolean" || !uuid(auditId)) throw Error("foc_flag_invalid_action");
  const reviewedReason = reasonText(reason);
  if (on) assessEnableScope(await readEnable(token, auditId), false);
  else assessFlagScope(await readFlag(token, auditId), true, { withdrawal: true });
  const writer = write ?? ((sql) => management(token, "/database/query", sql, false));
  let acknowledged = false;
  try {
    const rows = await writer(flagSql(on, auditId, reviewedReason));
    acknowledged =
      Array.isArray(rows) &&
      rows.some((row) => row?.marker === `m3-foc-flag-${on ? "enabled" : "disabled"}/1`);
  } catch {
    /* Read once; never replay an uncertain write. */
  }
  let result;
  try {
    const after = on ? await readEnable(token, auditId) : await readFlag(token, auditId);
    result = on
      ? assessEnableScope(after, true)
      : assessFlagScope(after, false, { withdrawal: true });
    assessAudit(after, auditId, on, reviewedReason);
  } catch {
    throw Error("foc_flag_outcome_unverified_no_replay");
  }
  return { ...result, auditId, writeAcknowledged: acknowledged, readbackVerified: true };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (
      process.env.NEW_DAWN_M3_FOC_PROJECT !== PROJECT ||
      process.env.NEW_DAWN_M3_FOC_FLAG !== FLAG
    )
      throw Error("exact_foc_live_scope_required");
    const [mode, ...rest] = process.argv.slice(2);
    if (mode === "--live-read-only" && rest.length === 0) {
      const scope = await readEnableScope();
      console.log(JSON.stringify(assessEnableScope(scope, scope.catalog?.[0]?.target_on === 1)));
    } else if (
      (mode === "--live-enable-drummonds-operator-only" ||
        mode === "--live-disable-drummonds-operator-only") &&
      rest.length === 1 &&
      rest[0].startsWith("--reason=")
    ) {
      console.log(
        JSON.stringify(await switchLive(mode.includes("enable"), { reason: rest[0].slice(9) })),
      );
    } else throw Error("exact_foc_flag_action_and_reason_required");
  } catch (error) {
    console.error(
      JSON.stringify({
        state: "foc_flag_stopped",
        code: error instanceof Error ? error.message : "unknown",
        retryAllowed: false,
        providerRequests: 0,
      }),
    );
    process.exitCode = 1;
  }
}
