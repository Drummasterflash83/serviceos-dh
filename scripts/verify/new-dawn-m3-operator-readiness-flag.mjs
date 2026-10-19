/** Exact Drummonds-only OpenFolk source-readiness switch. No client money or provider call. */
import { pathToFileURL } from "node:url";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import {
  PROJECT,
  TENANT,
  VERSION,
  NAME,
  SOURCE_SHA256,
  source,
  readStage,
} from "./new-dawn-m3-readiness-exact-sql-release.mjs";

export const FLAG = "new_dawn.money_source_readiness";
export const CLIENT_FLAGS = [
  "new_dawn.owner_report_review",
  "new_dawn.owner_accounts_report",
  "new_dawn.owner_money",
  "new_dawn.job_home_accounts_preview",
];
// Existing saved-report preview is separately operator-only and already ON in LIVE.
// Pin that baseline; the client-home companion flag above must remain OFF.
export const EXISTING_OPERATOR_REPORT = "new_dawn.report_summary_preview";
const SIGNATURE = "public.learn_quickbooks_money_source_readiness(uuid,uuid,text)";
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
const clientFlags = CLIENT_FLAGS.map(quote).join(",");
const uuid = (value) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

async function query(project, token, sql, readOnly = true, fetcher = fetch) {
  const response = await fetcher(
    `https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, read_only: readOnly }),
    },
  );
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const embedded =
      typeof problem?.message === "string"
        ? problem.message.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]
        : null;
    const code =
      typeof problem?.code === "string" && /^[A-Z0-9]{5}$/.test(problem.code)
        ? problem.code
        : (embedded ?? "unknown");
    throw Error(
      `m3_operator_flag_${readOnly ? "read" : "write"}_http_${response.status}_sqlstate_${code}`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 1024 * 1024) throw Error("m3_operator_flag_response_oversized");
  return JSON.parse(bytes.toString("utf8"));
}

const globalSql = `select
 (select count(*)::integer from public.feature_flags where flag='${FLAG}' and value='true'::jsonb) as operator_enabled,
 (select count(*)::integer from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${FLAG}' and value='true'::jsonb) as drummonds_enabled,
 (select count(*)::integer from public.feature_flags where flag in (${clientFlags}) and value='true'::jsonb) as client_enabled,
 (select count(*)::integer from public.feature_flags where flag='${EXISTING_OPERATOR_REPORT}' and value='true'::jsonb) as existing_operator_report_enabled,
 (select count(*)::integer from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${EXISTING_OPERATOR_REPORT}' and value='true'::jsonb) as drummonds_operator_report_enabled`;

export function assess(snapshot, enabled) {
  if (
    typeof enabled !== "boolean" ||
    snapshot.project?.id !== PROJECT ||
    snapshot.project?.status !== "ACTIVE_HEALTHY" ||
    snapshot.scope?.length !== 1 ||
    snapshot.scope[0]?.active_tenant !== true ||
    snapshot.scope[0]?.confirmed_production_realms !== 1
  )
    throw Error("m3_operator_flag_scope_changed");
  const row = snapshot.ledger?.[0],
    schema = snapshot.schema?.[0],
    global = snapshot.global?.[0];
  if (
    snapshot.ledger?.length !== 1 ||
    String(row.version) !== VERSION ||
    row.name !== NAME ||
    row.statements?.length !== 1 ||
    row.statements[0] !== source().sql ||
    schema?.readiness_rpc !== true ||
    schema.security_definer !== true ||
    schema.bounded_statement !== true ||
    schema.authenticated_grant !== true ||
    schema.anon_grant !== false ||
    schema.service_grant !== false ||
    schema.owner_review_rpc !== false ||
    schema.owner_read_rpc !== false ||
    schema.owner_publication_table !== false
  )
    throw Error("m3_operator_flag_migration_or_grants_changed");
  if (
    !Array.isArray(snapshot.flags) ||
    snapshot.flags.some(
      (flag) =>
        ![FLAG, ...CLIENT_FLAGS].includes(flag.flag) ||
        (flag.flag !== FLAG && flag.value !== false) ||
        (flag.flag === FLAG && flag.value !== enabled),
    )
  )
    throw Error("m3_operator_flag_tenant_flags_changed");
  if (
    global?.operator_enabled !== Number(enabled) ||
    global.drummonds_enabled !== Number(enabled) ||
    global.client_enabled !== 0 ||
    global.existing_operator_report_enabled !== 1 ||
    global.drummonds_operator_report_enabled !== 1
  )
    throw Error("m3_operator_flag_global_flags_changed");
  return {
    state: enabled ? "drummonds_operator_readiness_only" : "operator_readiness_off",
    project: PROJECT,
    operatorFlagEnabled: enabled,
    clientMoneyFlagsEnabled: false,
    sourceSha256: SOURCE_SHA256,
    providerRequests: 0,
  };
}

export async function readLive(token = savedCliToken(), fetcher = fetch) {
  const snapshot = await readStage(PROJECT, token, fetcher);
  snapshot.global = await query(PROJECT, token, globalSql, true, fetcher);
  return snapshot;
}

export function flagBody(enable, tenant = TENANT) {
  if (typeof enable !== "boolean" || !uuid(tenant)) throw Error("m3_operator_flag_invalid_scope");
  const before = Number(!enable),
    after = Number(enable);
  const change = enable
    ? `update public.feature_flags set value='true'::jsonb
   where tenant_id='${tenant}'::uuid and flag='${FLAG}';
   if not found then insert into public.feature_flags(tenant_id,flag,value)
    values('${tenant}'::uuid,'${FLAG}','true'::jsonb);end if;`
    : `update public.feature_flags set value='false'::jsonb
     where tenant_id='${tenant}'::uuid and flag='${FLAG}';`;
  return `lock table public.feature_flags in share row exclusive mode;
do $m3_operator_flag$ begin
 if to_regprocedure('${SIGNATURE}') is null
  or not has_function_privilege('authenticated','${SIGNATURE}','execute')
  or has_function_privilege('anon','${SIGNATURE}','execute')
  or has_function_privilege('service_role','${SIGNATURE}','execute')
  or not exists(select 1 from supabase_migrations.schema_migrations
   where version::text='${VERSION}' and name='${NAME}' and statements=array[${quote(source().sql)}])
  or not exists(select 1 from public.tenants where id='${tenant}'::uuid and status='active')
  or (select count(*) from public.learn_quickbooks_connections where tenant_id='${tenant}'::uuid
   and environment='production' and realm_id is not null and confirmed_at is not null
   and status in ('active','paused'))<>1
  or to_regclass('public.learn_quickbooks_owner_report_publications') is not null
  or to_regprocedure('public.learn_quickbooks_owner_report_review(uuid,text,uuid,uuid,text,text,bigint,text,text)') is not null
  or to_regprocedure('public.learn_quickbooks_owner_accounts_report(uuid)') is not null
  or exists(select 1 from public.feature_flags where flag in (${clientFlags}) and value='true'::jsonb)
  or (select count(*) from public.feature_flags where flag='${EXISTING_OPERATOR_REPORT}' and value='true'::jsonb)<>1
  or (select count(*) from public.feature_flags where tenant_id='${tenant}'::uuid
   and flag='${EXISTING_OPERATOR_REPORT}' and value='true'::jsonb)<>1
  or (select count(*) from public.feature_flags where flag='${FLAG}' and value='true'::jsonb)<>${before}
  or (select count(*) from public.feature_flags where tenant_id='${tenant}'::uuid
   and flag='${FLAG}' and value='true'::jsonb)<>${before}
 then raise exception 'm3_operator_flag_preflight_changed';end if;
 ${change}
 if (select count(*) from public.feature_flags where flag='${FLAG}' and value='true'::jsonb)<>${after}
  or (select count(*) from public.feature_flags where tenant_id='${tenant}'::uuid
   and flag='${FLAG}' and value='true'::jsonb)<>${after}
  or exists(select 1 from public.feature_flags where flag in (${clientFlags}) and value='true'::jsonb)
  or (select count(*) from public.feature_flags where flag='${EXISTING_OPERATOR_REPORT}' and value='true'::jsonb)<>1
  or (select count(*) from public.feature_flags where tenant_id='${tenant}'::uuid
   and flag='${EXISTING_OPERATOR_REPORT}' and value='true'::jsonb)<>1
 then raise exception 'm3_operator_flag_postcheck_changed';end if;
end $m3_operator_flag$;
select '${enable ? "m3-operator-readiness-enabled/1" : "m3-operator-readiness-disabled/1"}' as marker;`;
}

export function flagSql(enable, tenant = TENANT, rollback = false) {
  return `begin;\nset local lock_timeout='3s';\nset local statement_timeout='30s';\n${flagBody(enable, tenant)}\n${rollback ? "rollback" : "commit"};`;
}

export async function switchLive(
  enable,
  { token = savedCliToken(), fetcher = fetch, read = readLive, write } = {},
) {
  if (typeof enable !== "boolean") throw Error("m3_operator_flag_invalid_action");
  assess(await read(token, fetcher), !enable);
  const writer = write ?? ((sql) => query(PROJECT, token, sql, false, fetcher));
  let acknowledged = false;
  try {
    const result = await writer(flagSql(enable));
    acknowledged =
      Array.isArray(result) &&
      result.some(
        (row) =>
          row?.marker ===
          (enable ? "m3-operator-readiness-enabled/1" : "m3-operator-readiness-disabled/1"),
      );
  } catch {
    /* Read back exactly once; never replay an uncertain write. */
  }
  let outcome;
  try {
    outcome = assess(await read(token, fetcher), enable);
  } catch {
    throw Error("m3_operator_flag_outcome_unverified_no_replay");
  }
  return { ...outcome, writeAcknowledged: acknowledged, readbackVerified: true };
}

export async function rehearseTest({ token = savedCliToken(), fetcher = fetch } = {}) {
  const before = await query(
    TEST_PROJECT,
    token,
    `select to_regprocedure('${SIGNATURE}') is not null as installed,
      to_regclass('supabase_migrations.schema_migrations') is not null as ledger,
      (select count(*)::integer from public.feature_flags where flag='${FLAG}' and value='true'::jsonb) as enabled,
      (select count(*)::integer from public.feature_flags where flag='${EXISTING_OPERATOR_REPORT}' and value='true'::jsonb) as operator_report_enabled`,
    true,
    fetcher,
  );
  if (
    before.length !== 1 ||
    before[0]?.installed !== false ||
    before[0]?.ledger !== false ||
    before[0]?.enabled !== 0 ||
    before[0]?.operator_report_enabled !== 0
  )
    throw Error("m3_operator_flag_test_baseline_changed");
  const tenants = await query(
    TEST_PROJECT,
    token,
    `select c.tenant_id::text as id from public.learn_quickbooks_connections c
     join public.tenants t on t.id=c.tenant_id and t.status='active'
     where c.realm_id is not null group by c.tenant_id having count(*)=1 limit 1`,
    true,
    fetcher,
  );
  const tenant = tenants?.[0]?.id;
  if (!tenant || !uuid(tenant)) throw Error("m3_operator_flag_test_tenant_missing");
  const migration = source();
  const sql = `begin;\nset local lock_timeout='3s';\nset local statement_timeout='90s';
create schema if not exists supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
${migration.body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(migration.sql)}]);
update public.learn_quickbooks_connections set environment='production',status='paused',
 confirmed_at=clock_timestamp() where tenant_id='${tenant}'::uuid;
do $test_operator_report$ begin
 update public.feature_flags set value='true'::jsonb
  where tenant_id='${tenant}'::uuid and flag='${EXISTING_OPERATOR_REPORT}';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values('${tenant}'::uuid,'${EXISTING_OPERATOR_REPORT}','true'::jsonb);end if;
end $test_operator_report$;
${flagBody(true, tenant)}\n${flagBody(false, tenant)}\nrollback;`;
  let result, error;
  try {
    result = await query(TEST_PROJECT, token, sql, false, fetcher);
  } catch (cause) {
    error = cause;
  }
  const after = await query(
    TEST_PROJECT,
    token,
    `select to_regprocedure('${SIGNATURE}') is not null as installed,
      to_regclass('supabase_migrations.schema_migrations') is not null as ledger,
      (select count(*)::integer from public.feature_flags where flag='${FLAG}' and value='true'::jsonb) as enabled,
      (select count(*)::integer from public.feature_flags where flag='${EXISTING_OPERATOR_REPORT}' and value='true'::jsonb) as operator_report_enabled`,
    true,
    fetcher,
  );
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw Error("m3_operator_flag_test_rollback_changed");
  if (error) throw error;
  if (
    !Array.isArray(result) ||
    !result.some((row) => row?.marker === "m3-operator-readiness-disabled/1")
  )
    throw Error("m3_operator_flag_test_receipt_missing");
  return {
    state: "passed_rolled_back",
    project: TEST_PROJECT,
    clientMoneyFlagsEnabled: false,
    providerRequests: 0,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const mode = process.argv.slice(2).join(" "),
      allowed = process.env.NEW_DAWN_M3_ALLOW_PROJECT;
    if (mode === "--live-read-only" && allowed === PROJECT) {
      const snapshot = await readLive();
      const observed = snapshot.global?.[0]?.drummonds_enabled;
      if (observed !== 0 && observed !== 1) throw Error("m3_operator_flag_count_changed");
      console.log(JSON.stringify(assess(snapshot, observed === 1)));
    } else if (mode === "--test-rollback-only" && allowed === TEST_PROJECT)
      console.log(JSON.stringify(await rehearseTest()));
    else if (mode === "--live-enable-drummonds-operator-only" && allowed === PROJECT)
      console.log(JSON.stringify(await switchLive(true)));
    else if (mode === "--live-disable-drummonds-operator-only" && allowed === PROJECT)
      console.log(JSON.stringify(await switchLive(false)));
    else throw Error("m3_operator_flag_exact_mode_required");
  } catch (error) {
    console.error(
      JSON.stringify({
        state: "m3_operator_flag_stopped",
        code: error.message,
        retryAllowed: false,
        providerRequests: 0,
      }),
    );
    process.exitCode = 1;
  }
}
