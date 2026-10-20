/** Exact, one-file-at-a-time M2 SQL release. No db push or provider request. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { assessM2WorkerFirst, ENDPOINTS, FLAGS, MIGRATIONS, PROJECT, TENANT } from
  "./new-dawn-m2-live-preflight.mjs";

const FILES = Object.freeze([
  ["20261106150000", "new_dawn_commusoft_shared_lease", "a984a2fc235699d3d92ea4980191cb786bc94740e481b3c1ffa8c9004f41848b"],
  ["20261106160000", "new_dawn_commusoft_shared_lease_routes", "6a9eaac74785cefb1ca53351dfc77f55adce112af97cd721d71cb6789935c953"],
  ["20261106180000", "new_dawn_commusoft_lease_coexistence", "e1e631ff7c6f2142120e32ffe9132b22cf9bba9301481204f23ab22a3759067f"],
]);
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const sha = value => createHash("sha256").update(value).digest("hex");
const markers = [
  [false, false, false, false],
  [true, true, false, false],
  [true, true, true, false],
  [true, true, true, true],
];
const ledgerQuery = `select version::text,name,statements from supabase_migrations.schema_migrations
 where version::text in ('${MIGRATIONS.join("','")}') order by version`;
const flagQuery = `select flag from public.feature_flags where tenant_id='${TENANT}'::uuid
 and flag in (${FLAGS.map(quote).join(",")}) order by flag`;
const queueQuery = `select exists(select 1 from public.platform_jobs where tenant_id='${TENANT}'::uuid
 and job_type='commusoft.source_sync' and status in ('queued','running','retrying')) as active_import`;
const schemaQuery = `select
 (select count(*)=5 from information_schema.columns where table_schema='public'
  and table_name='learn_business_input_request_gates' and column_name in
  ('lease_owner_kind','lease_owner_id','lease_expires_at','manual_waiter_id','manual_waiter_expires_at')) as lease_columns,
 to_regprocedure('public.learn_commusoft_shared_lease_acquire(text,text,text)') is not null as lease_acquire,
 to_regprocedure('public.new_dawn_commusoft_manual_lease_release()') is not null as manual_release,
 to_regprocedure('public.learn_commusoft_yield_job(uuid,uuid,text,integer,timestamptz)') is not null as yield_job`;
const testLedgerQuery = `select to_regclass('supabase_migrations.schema_migrations') is not null as present`;

export function sources() {
  return FILES.map(([version, name, hash]) => {
    const path = new URL(`../../supabase/migrations/${version}_${name}.sql`, import.meta.url);
    const source = readFileSync(path, "utf8");
    if (sha(source) !== hash || !/^\s*(?:--[^\n]*\n)*begin;\s*$/im.test(source) ||
      !/\ncommit;\s*$/i.test(source)) throw Error("reviewed_migration_source_changed:" + version);
    const body = source.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im, "")
      .replace(/\ncommit;\s*$/i, "");
    if (/^\s*(begin|commit);\s*$/im.test(body)) throw Error("nested_transaction_fence:" + version);
    return { version, name, hash, source, body };
  });
}

export function assessStage(snapshot, stage, files = sources(), now = Date.now()) {
  if (!Number.isInteger(stage) || stage < 0 || stage > 3) throw Error("stage_invalid");
  const ledger = snapshot.ledger;
  if (!Array.isArray(ledger) || ledger.length !== stage) throw Error("migration_ledger_prefix_changed");
  for (let i = 0; i < stage; i++) {
    const row = ledger[i], expected = files[i];
    if (String(row?.version) !== expected.version || row.name !== expected.name ||
      !Array.isArray(row.statements) || row.statements.length !== 1 ||
      row.statements[0] !== expected.source)
      throw Error("migration_ledger_receipt_changed:" + expected.version);
  }
  const actual = snapshot.schema?.[0];
  if (!actual || ["lease_columns", "lease_acquire", "manual_release", "yield_job"]
    .some((key, i) => actual[key] !== markers[stage][i]))
    throw Error("migration_schema_stage_changed");
  if (!Array.isArray(snapshot.flags) || snapshot.flags.length !== 0)
    throw Error("m2_flags_not_absent");
  if (!Array.isArray(snapshot.queue) || snapshot.queue.length !== 1 ||
    typeof snapshot.queue[0]?.active_import !== "boolean") throw Error("source_queue_unconfirmed");
  if (snapshot.project?.id !== PROJECT || snapshot.project?.status !== "ACTIVE_HEALTHY")
    throw Error("production_project_unconfirmed");
  const worker = assessM2WorkerFirst({ ...snapshot,
    migrations: ledger.map(row => ({ version: row.version })) }, now, MIGRATIONS.slice(0, stage));
  if (worker.state !== "worker_first_sql_ready") throw Error("worker_first_gate_not_ready");
  return { stage, worker, activeImport: snapshot.queue[0].active_import };
}

function expectedLedgerSql(files, stage) {
  const rows = files.slice(0, stage).map(file =>
    `(version=${quote(file.version)} and name=${quote(file.name)} and
      array_length(statements,1)=1 and statements[1]=${quote(file.source)})`).join(" or ");
  return stage === 0 ? "not exists(select 1 from supabase_migrations.schema_migrations where version::text in (" +
    MIGRATIONS.map(quote).join(",") + "))" :
    `(select count(*) from supabase_migrations.schema_migrations where version::text in
      (${MIGRATIONS.map(quote).join(",")}))=${stage} and
     (select count(*) from supabase_migrations.schema_migrations where ${rows})=${stage}`;
}

export function releaseSql(file, stage, files = sources(), rollback = false) {
  if (files[stage] !== file || stage < 0 || stage > 2) throw Error("release_version_out_of_order");
  const expected = expectedLedgerSql(files, stage);
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $m2_gate$ begin
 if not (${expected}) then raise exception 'm2_ledger_changed'; end if;
 if exists(select 1 from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag in (${FLAGS.map(quote).join(",")})) then raise exception 'm2_flag_changed'; end if;
end $m2_gate$;
${file.body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values(${quote(file.version)},${quote(file.name)},array[${quote(file.source)}]);
select ${quote(file.version)} as m2_version;
${rollback ? "rollback" : "commit"};`;
}

async function management(project, token, path, query, readOnly = true, fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${token}`,
      ...(query ? { "Content-Type": "application/json" } : {}) },
    ...(query ? { body: JSON.stringify({ query, read_only: readOnly }) } : {}),
  });
  if (!response.ok) throw Error(`management_${readOnly ? "read" : "write"}_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 2 * 1024 * 1024) throw Error("management_response_oversized");
  return JSON.parse(bytes.toString("utf8"));
}

export async function readStage(project, token, fetcher = fetch) {
  const q = (path, sql) => management(project, token, path, sql, true, fetcher);
  const base = "/database/query/read-only";
  const projectInfo = await q("", null);
  const functions = await q("/functions", null);
  const worker = functions.find(row => row.slug === ENDPOINTS[0].name);
  if (!Number.isSafeInteger(worker?.updated_at)) throw Error("worker_activation_unconfirmed");
  const activation = new Date(worker.updated_at).toISOString();
  const healthQuery = `select
 count(*) filter(where status='running' and claimed_at<'${activation}'::timestamptz) as pre_activation_running,
 count(*) filter(where status='retrying' and last_attempt_at>='${activation}'::timestamptz) as recent_retrying,
 count(*) filter(where status='dead_letter' and last_attempt_at>='${activation}'::timestamptz) as recent_dead_letter,
 count(*) filter(where status='succeeded' and completed_at>='${activation}'::timestamptz) as completed_since
 from public.platform_jobs where tenant_id='${TENANT}'::uuid and job_type='commusoft.source_sync'`;
  return { project: projectInfo, functions, ledger: await q(base, ledgerQuery),
    flags: await q(base, flagQuery), queue: await q(base, queueQuery),
    schema: await q(base, schemaQuery), health: await q(base, healthQuery) };
}

export async function applyNext({ project, version, token = savedCliToken(), fetcher = fetch,
  read = readStage, write } = {}) {
  if (project !== PROJECT) throw Error("exact_live_project_required");
  const files = sources(), stage = MIGRATIONS.indexOf(version);
  if (stage < 0) throw Error("exact_version_required");
  const before = await read(project, token, fetcher);
  assessStage(before, stage, files);
  const sql = releaseSql(files[stage], stage, files);
  const writer = write ?? ((query) => management(project, token, "/database/query", query, false, fetcher));
  let acknowledged = false;
  try {
    const rows = await writer(sql);
    acknowledged = Array.isArray(rows) && rows.some(row => row?.m2_version === version);
  } catch { /* An unknown write is never replayed. Read back once. */ }
  let after;
  try { after = await read(project, token, fetcher); }
  catch { throw Error("write_outcome_unverified_no_replay"); }
  try { assessStage(after, stage + 1, files); }
  catch { throw Error("write_outcome_unverified_no_replay"); }
  return { state: "exact_migration_installed", version, sourceSha256: files[stage].hash,
    writeAcknowledged: acknowledged, ledgerReadbackVerified: true, flagsAbsent: true,
    providerRequests: 0 };
}

function transactionBody(source, name) {
  if (!/^\s*(?:--[^\n]*\n)*begin;\s*$/im.test(source) || !/\ncommit;\s*$/i.test(source))
    throw Error("test_source_transaction_fence_changed:" + name);
  return source.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im, "")
    .replace(/\ncommit;\s*$/i, "");
}

export function testRollbackSql(files = sources()) {
  const baseNames = [
    "20261106120000_new_dawn_commusoft_job_detail_read.sql",
    "20261106130000_new_dawn_commusoft_opportunities_probe.sql",
  ];
  const base = baseNames.map(name => transactionBody(
    readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8"), name));
  const stages = files.map((file, stage) => transactionBody(
    releaseSql(file, stage, files), file.version));
  return `begin;\nset local lock_timeout='3s';\nset local statement_timeout='90s';\n` +
    `create schema supabase_migrations;\ncreate table supabase_migrations.schema_migrations
      (version text primary key,name text,statements text[]);\n` +
    [...base, ...stages].join("\n") + "\nrollback;";
}

export async function rehearseTest({ token = savedCliToken(), fetcher = fetch } = {}) {
  const query = (sql, readOnly = true) => management(TEST_PROJECT, token,
    readOnly ? "/database/query/read-only" : "/database/query", sql, readOnly, fetcher);
  const baseline = await query(testLedgerQuery), beforeSchema = await query(schemaQuery);
  if (!Array.isArray(baseline) || baseline.length !== 1 || baseline[0]?.present !== false ||
    !Array.isArray(beforeSchema) || beforeSchema.length !== 1 ||
    ["lease_columns", "lease_acquire", "manual_release", "yield_job"]
      .some(key => beforeSchema[0]?.[key] !== false)) throw Error("test_baseline_not_absent");
  const sql = testRollbackSql();
  await query(sql, false);
  const afterLedger = await query(testLedgerQuery), afterSchema = await query(schemaQuery);
  if (JSON.stringify(afterLedger) !== JSON.stringify(baseline) ||
    JSON.stringify(afterSchema) !== JSON.stringify(beforeSchema))
    throw Error("test_rollback_readback_changed");
  return { state: "test_exact_three_rolled_back", project: TEST_PROJECT,
    versions: MIGRATIONS, sourceHashes: sources().map(file => file.hash),
    syntheticLedger: true, providerRequests: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === "--test-rollback-only" && process.argv.length === 3 &&
      process.env.NEW_DAWN_M2_ALLOW_PROJECT === TEST_PROJECT)
      console.log(JSON.stringify(await rehearseTest()));
    else if (process.argv[2] === "--live-apply-next" && process.argv[3] === "--version" &&
      MIGRATIONS.includes(process.argv[4]) && process.argv.length === 5 &&
      process.env.NEW_DAWN_M2_ALLOW_PROJECT === PROJECT)
      console.log(JSON.stringify(await applyNext({ project: PROJECT, version: process.argv[4] })));
    else throw Error("explicit_exact_release_scope_required");
  } catch (error) {
    console.error(JSON.stringify({ state: "release_stopped", code: error.message,
      retryAllowed: false, providerRequests: 0 }));
    process.exitCode = 1;
  }
}
