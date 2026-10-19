/** One reviewed M3 operator-metadata migration. No flags, provider calls or client money. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { rehearse as rehearseReadiness } from "./new-dawn-money-source-readiness-rehearse.mjs";

export const PROJECT = "tgbnakbxwcqjeimygroz";
export const TENANT = "00000000-0000-0000-0000-000000000001";
export const VERSION = "20261106170000";
export const NAME = "new_dawn_money_source_readiness";
export const SOURCE_SHA256 = "f9dba3316d3fc7a4438b201a0ab0f08638dda06eb4daefac2c2e2c15a67d3606";
const SIGNATURE = "public.learn_quickbooks_money_source_readiness(uuid,uuid,text)";
const FLAGS = [
  "new_dawn.money_source_readiness",
  "new_dawn.owner_report_review",
  "new_dawn.owner_accounts_report",
  "new_dawn.owner_money",
  "new_dawn.job_home_accounts_preview",
];
const quote = (s) => "'" + s.replaceAll("'", "''") + "'";

export function source() {
  const sql = readFileSync(
    new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`, import.meta.url),
    "utf8",
  );
  if (
    createHash("sha256").update(sql).digest("hex") !== SOURCE_SHA256 ||
    !/\nbegin;\n/i.test(sql) ||
    !/\ncommit;\s*$/i.test(sql)
  )
    throw Error("reviewed_m3_source_changed");
  const body = sql.replace(/\nbegin;\n/i, "\n").replace(/\ncommit;\s*$/i, "\n");
  if (/^\s*(begin|commit);\s*$/im.test(body)) throw Error("nested_m3_transaction");
  return { sql, body };
}

const ledgerSql = `select version::text,name,statements from supabase_migrations.schema_migrations
 where version::text='${VERSION}'`;
const flagsSql = `select flag,value from public.feature_flags where tenant_id='${TENANT}'::uuid
 and flag in (${FLAGS.map(quote).join(",")}) order by flag`;
const scopeSql = `select
 exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active') as active_tenant,
 (select count(*) from public.learn_quickbooks_connections where tenant_id='${TENANT}'::uuid
  and environment='production' and realm_id is not null and confirmed_at is not null
  and status in ('active','paused')) as confirmed_production_realms`;
const schemaSql = `select
 to_regprocedure('${SIGNATURE}') is not null as readiness_rpc,
 coalesce((select p.prosecdef from pg_proc p where p.oid=to_regprocedure('${SIGNATURE}')),false) as security_definer,
 coalesce((select 'statement_timeout=15s'=any(p.proconfig) from pg_proc p
  where p.oid=to_regprocedure('${SIGNATURE}')),false) as bounded_statement,
 case when to_regprocedure('${SIGNATURE}') is null then false
  else has_function_privilege('authenticated',to_regprocedure('${SIGNATURE}'),'execute') end as authenticated_grant,
 case when to_regprocedure('${SIGNATURE}') is null then false
  else has_function_privilege('anon',to_regprocedure('${SIGNATURE}'),'execute') end as anon_grant,
 case when to_regprocedure('${SIGNATURE}') is null then false
  else has_function_privilege('service_role',to_regprocedure('${SIGNATURE}'),'execute') end as service_grant,
 to_regprocedure('public.learn_quickbooks_owner_report_review(uuid,text,uuid,uuid,text,text,bigint,text,text)') is not null as owner_review_rpc,
 to_regprocedure('public.learn_quickbooks_owner_accounts_report(uuid)') is not null as owner_read_rpc,
 to_regclass('public.learn_quickbooks_owner_report_publications') is not null as owner_publication_table`;

export function assess(snapshot, installed, expectedFlags = snapshot.flags) {
  if (snapshot.project?.id !== PROJECT || snapshot.project?.status !== "ACTIVE_HEALTHY")
    throw Error("m3_live_project_unconfirmed");
  if (
    !Array.isArray(snapshot.scope) ||
    snapshot.scope.length !== 1 ||
    snapshot.scope[0]?.active_tenant !== true ||
    snapshot.scope[0]?.confirmed_production_realms !== 1
  )
    throw Error("m3_tenant_realm_unconfirmed");
  if (
    !Array.isArray(snapshot.flags) ||
    snapshot.flags.some((row) => !FLAGS.includes(row?.flag) || row.value !== false) ||
    JSON.stringify(snapshot.flags) !== JSON.stringify(expectedFlags)
  )
    throw Error("m3_flag_changed_or_enabled");
  const s = snapshot.schema?.[0];
  if (
    !s ||
    s.owner_review_rpc !== false ||
    s.owner_read_rpc !== false ||
    s.owner_publication_table !== false
  )
    throw Error("m3_owner_publication_changed");
  for (const key of [
    "readiness_rpc",
    "security_definer",
    "bounded_statement",
    "authenticated_grant",
  ])
    if (s[key] !== installed) throw Error("m3_readiness_schema_changed");
  if (s.anon_grant !== false || s.service_grant !== false)
    throw Error("m3_readiness_grant_changed");
  if (!Array.isArray(snapshot.ledger) || snapshot.ledger.length !== Number(installed))
    throw Error("m3_migration_ledger_changed");
  if (installed) {
    const row = snapshot.ledger[0];
    if (
      String(row?.version) !== VERSION ||
      row.name !== NAME ||
      !Array.isArray(row.statements) ||
      row.statements.length !== 1 ||
      row.statements[0] !== source().sql
    )
      throw Error("m3_migration_receipt_changed");
  }
  return {
    state: installed ? "exact_readiness_installed" : "exact_readiness_absent",
    version: VERSION,
    sourceSha256: SOURCE_SHA256,
    flagsOff: true,
    ownerPublicationAbsent: true,
    providerRequests: 0,
  };
}

export function releaseSql() {
  const { sql, body } = source();
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $m3_gate$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}')
  or to_regprocedure('${SIGNATURE}') is not null then raise exception 'm3_source_already_installed'; end if;
 if exists(select 1 from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag in (${FLAGS.map(quote).join(",")}) and value is distinct from 'false'::jsonb)
  or to_regclass('public.learn_quickbooks_owner_report_publications') is not null
  or to_regprocedure('public.learn_quickbooks_owner_report_review(uuid,text,uuid,uuid,text,text,bigint,text,text)') is not null
  or to_regprocedure('public.learn_quickbooks_owner_accounts_report(uuid)') is not null
  then raise exception 'm3_release_boundary_changed'; end if;
 if not exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active')
  or (select count(*) from public.learn_quickbooks_connections
   where tenant_id='${TENANT}'::uuid and environment='production' and realm_id is not null
   and confirmed_at is not null and status in ('active','paused'))<>1
  then raise exception 'm3_tenant_realm_unconfirmed'; end if;
end $m3_gate$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(sql)}]);
select '${VERSION}' as m3_version;
commit;`;
}

async function management(project, token, path, query, readOnly = true, fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? "POST" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(90000),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(query ? { "Content-Type": "application/json" } : {}),
    },
    ...(query ? { body: JSON.stringify({ query, read_only: readOnly }) } : {}),
  });
  if (!response.ok)
    throw Error(`m3_management_${readOnly ? "read" : "write"}_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 1024 * 1024) throw Error("m3_management_response_oversized");
  return JSON.parse(bytes.toString("utf8"));
}

export async function readStage(project, token, fetcher = fetch) {
  const q = (sql) => management(project, token, "/database/query/read-only", sql, true, fetcher);
  return {
    project: await management(project, token, "", null, true, fetcher),
    ledger: await q(ledgerSql),
    flags: await q(flagsSql),
    scope: await q(scopeSql),
    schema: await q(schemaSql),
  };
}

export async function applyExact({
  project,
  token = savedCliToken(),
  fetcher = fetch,
  read = readStage,
  write,
} = {}) {
  if (project !== PROJECT) throw Error("exact_m3_live_project_required");
  const before = await read(project, token, fetcher);
  assess(before, false);
  const writer =
    write ?? ((sql) => management(project, token, "/database/query", sql, false, fetcher));
  let acknowledged = false;
  try {
    const result = await writer(releaseSql());
    acknowledged = Array.isArray(result) && result.some((row) => row?.m3_version === VERSION);
  } catch {
    /* Unknown write outcome is read back once and never replayed. */
  }
  let after;
  try {
    after = await read(project, token, fetcher);
  } catch {
    throw Error("m3_write_outcome_unverified_no_replay");
  }
  try {
    assess(after, true, before.flags);
  } catch {
    throw Error("m3_write_outcome_unverified_no_replay");
  }
  return {
    state: "exact_readiness_installed",
    version: VERSION,
    sourceSha256: SOURCE_SHA256,
    writeAcknowledged: acknowledged,
    ledgerReadbackVerified: true,
    flagsOff: true,
    ownerPublicationAbsent: true,
    providerRequests: 0,
  };
}

export async function rehearseTest({ token = savedCliToken(), fetcher = fetch } = {}) {
  const baseline = await management(
    TEST_PROJECT,
    token,
    "/database/query/read-only",
    `select to_regprocedure('${SIGNATURE}') is not null as installed`,
    true,
    fetcher,
  );
  if (baseline.length !== 1 || baseline[0]?.installed !== false)
    throw Error("m3_test_baseline_changed");
  const result = await rehearseReadiness(fetcher, token);
  const after = await management(
    TEST_PROJECT,
    token,
    "/database/query/read-only",
    `select to_regprocedure('${SIGNATURE}') is not null as installed`,
    true,
    fetcher,
  );
  if (JSON.stringify(after) !== JSON.stringify(baseline)) throw Error("m3_test_rollback_changed");
  return {
    ...result,
    version: VERSION,
    sourceSha256: SOURCE_SHA256,
    readinessFunctionAfter: false,
    providerRequests: 0,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2),
      allowed = process.env.NEW_DAWN_M3_ALLOW_PROJECT;
    if (args.length === 1 && args[0] === "--test-rollback-only" && allowed === TEST_PROJECT)
      console.log(JSON.stringify(await rehearseTest()));
    else if (args.length === 1 && args[0] === "--live-read-only" && allowed === PROJECT) {
      const result = await readStage(PROJECT, savedCliToken());
      console.log(JSON.stringify(assess(result, result.ledger.length === 1)));
    } else if (
      args.length === 3 &&
      args[0] === "--live-apply-exact" &&
      args[1] === "--version" &&
      args[2] === VERSION &&
      allowed === PROJECT
    )
      console.log(JSON.stringify(await applyExact({ project: PROJECT })));
    else throw Error("explicit_m3_release_scope_required");
  } catch (error) {
    console.error(
      JSON.stringify({
        state: "m3_release_stopped",
        code: error.message,
        retryAllowed: false,
        providerRequests: 0,
      }),
    );
    process.exitCode = 1;
  }
}
