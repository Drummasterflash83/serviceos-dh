/** Exact default-OFF M2 users-trial SQL release. No flag, job or provider write. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import {
  PROJECT, TENANT, RELEASE_WORKER, FUNCTIONS as BACKEND_FUNCTIONS,
  VERSION as BACKEND_VERSION, NAME as BACKEND_NAME, SOURCE_SHA256 as BACKEND_SHA,
  RESUME_VERSION as BACKEND_RESUME_VERSION, RESUME_NAME as BACKEND_RESUME_NAME,
  RESUME_SOURCE_SHA256 as BACKEND_RESUME_SHA, source as backendSource,
  resumeSource as backendResumeSource, unsafeActiveJobsFrom,
} from "./new-dawn-m2-users-backend-release.mjs";

export const FILES = Object.freeze([
  { version: "20261108130000", name: "new_dawn_commusoft_users_trial_restore",
    sha256: "2bc5d35e70d807145ea50223abe07329e79f84da4ce01e89d68051c970630a98" },
  { version: "20261108131000", name: "new_dawn_commusoft_users_trial_resume_fence",
    sha256: "d96a203eb0fc8185df4972434228492fbbbe5e48266e0c6fbb455787b884f3ee" },
]);
const BASE = Object.freeze({
  control: "a07f6f4ad60bde24b207935a65fb06c192d86d11c4926b969a38685d015a2a32",
  input: BACKEND_FUNCTIONS["learn_operator_input_request(uuid, uuid, uuid, jsonb, text)"].after,
  resume: BACKEND_FUNCTIONS["learn_operator_resume_commusoft(uuid, uuid, uuid, jsonb, text)"].after,
});
export const POST = Object.freeze({
  control: "eae9011fe47ad9c33bc0ca52d89dd831be5c5edc943a157dff20e7a19f66c45d",
  input: "7c71a6348a268f4d8b50b99d9f1457f82e3d7ed546dfcd8165fe26d19006bd4e",
  resume: "e6ddcb631aea3f2247103ac1c644281ed3bc40eda5a0d805141ea0b6bd19e203",
  restore: "97318680261987112caba38bb9e7547f3ea7646cf66a54993c37166bb291821c",
  active: "077749def4bc8879264ab6a9a532a99d99b0274c15547521c71d22daf4ec8d83",
  allowed: "652128c38cf981d93675e7ad30d08072875d287ce6da0168c0bd639018858a59",
});
const SIGNATURES = Object.freeze({
  control: "public.learn_commusoft_recurring_control(uuid,uuid,uuid,jsonb,text)",
  input: "public.learn_operator_input_request(uuid,uuid,uuid,jsonb,text)",
  resume: "public.learn_operator_resume_commusoft(uuid,uuid,uuid,jsonb,text)",
  restore: "public.learn_commusoft_users_trial_restore(uuid,uuid,uuid,uuid,text,text)",
  active: "public.learn_commusoft_users_trial_active(uuid,uuid)",
  allowed: "public.learn_commusoft_users_trial_control_allowed(uuid,uuid)",
});
const sha = text => createHash("sha256").update(text).digest("hex");
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const HEALTHY_CYCLE = Object.freeze(["approved", "cycle_complete", "window_active",
  "window_queued", "caught_up", "empty_parent_set_verified"]);
const ledgerPins = Object.freeze([
  { version: BACKEND_VERSION, name: BACKEND_NAME, hash: BACKEND_SHA },
  { version: BACKEND_RESUME_VERSION, name: BACKEND_RESUME_NAME, hash: BACKEND_RESUME_SHA },
  ...FILES.map(file => ({ version: file.version, name: file.name, hash: file.sha256 })),
]);

export function reviewedFiles() {
  return FILES.map(file => {
    const text = readFileSync(new URL(`../../supabase/migrations/${file.version}_${file.name}.sql`, import.meta.url), "utf8");
    if (sha(text) !== file.sha256 || !/^\s*(?:--[^\n]*\n)*begin;\s*$/im.test(text) ||
      !/\ncommit;\s*$/i.test(text)) throw Error("trial_release_source_changed:" + file.version);
    const body = text.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im, "").replace(/\ncommit;\s*$/i, "");
    if (/^\s*(begin|commit);\s*$/im.test(body)) throw Error("trial_release_nested_transaction");
    return { ...file, text, body };
  });
}

const functionColumns = Object.entries(SIGNATURES).flatMap(([key, signature]) => {
  const proc = `to_regprocedure('${signature}')`;
  return [
    `encode(sha256(convert_to(pg_get_functiondef(${proc}),'UTF8')),'hex') as ${key}_hash`,
    `coalesce(has_function_privilege('anon',${proc},'EXECUTE'),false) as ${key}_anon`,
    `coalesce(has_function_privilege('authenticated',${proc},'EXECUTE'),false) as ${key}_auth`,
    `coalesce(has_function_privilege('service_role',${proc},'EXECUTE'),false) as ${key}_service`,
  ];
});
export const functionSql = `select ${functionColumns.join(",\n ")}`;
const ledgerSql = `(select coalesce(jsonb_agg(jsonb_build_object('version',version::text,
 'name',name,'hash',encode(sha256(convert_to(statements[1],'UTF8')),'hex'),
 'statements',cardinality(statements)) order by version),'[]'::jsonb)
 from supabase_migrations.schema_migrations where version::text in
 (${ledgerPins.map(pin => quote(pin.version)).join(",")})) as ledger`;
export const catalogSql = `select f.*,
 ${ledgerSql},
 (select count(*)::int from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag in ('learn.enabled','learn.inputs.commusoft.enabled') and value='true'::jsonb) as base_flags,
 (select count(*)::int from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag='learn.inputs.commusoft.users.enabled' and value is distinct from 'false'::jsonb) as users_flag_bad,
 (select count(*)::int from public.learn_business_input_versions where tenant_id='${TENANT}'::uuid
  and provider='commusoft' and collection='users') as users_versions,
 (select count(*)::int from public.platform_jobs j where j.tenant_id='${TENANT}'::uuid
  and j.job_type='commusoft.source_sync' and j.status in ('queued','running','retrying')) as active_jobs,
 (select count(*)::int ${unsafeActiveJobsFrom}) as unsafe_jobs,
 (select count(*)::int from public.controlplane_change_log arm
  where arm.tenant_id='${TENANT}'::uuid and arm.action='learn.commusoft.users_trial.arm'
   and arm.source='new-dawn-m2-users-trial' and not exists(
    select 1 from public.controlplane_change_log done where done.tenant_id=arm.tenant_id
     and done.action='learn.commusoft.users_trial.restore'
     and done.source='new-dawn-m2-users-trial' and done.correlation_id=arm.id::text)) as open_arms,
 (select coalesce(jsonb_agg(jsonb_build_object('enabled',s.enabled,'phase',s.phase,
  'current_request',s.current_request,'last_state',s.last_state,'account_id',s.account_id,
  'connection_ok',c.id is not null) order by s.account_id),'[]'::jsonb)
  from public.learn_commusoft_recurring s left join public.provider_connections c
   on c.id=s.connection_id and c.tenant_id=s.tenant_id and c.provider='commusoft'
    and c.status='configured' and c.revoked_at is null and c.updated_at=s.connection_revision
  where s.tenant_id='${TENANT}'::uuid) as recurring
 from (${functionSql}) f`;

function expectedLedger(installed) {
  return ledgerPins.slice(0, installed ? 4 : 2).map(pin => ({
    version: pin.version, name: pin.name, hash: pin.hash, statements: 1,
  }));
}
function ledgerMatches(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    expected.every((pin, i) => Object.keys(pin).every(key => actual[i]?.[key] === pin[key]));
}
export function assessStage(snapshot, installed = false) {
  if (snapshot?.project?.id !== PROJECT || snapshot.project.status !== "ACTIVE_HEALTHY" ||
    !Array.isArray(snapshot.functions)) throw Error("trial_release_project_unconfirmed");
  const worker = snapshot.functions.filter(row => row?.slug === RELEASE_WORKER.slug);
  if (worker.length !== 1 || worker[0].id !== RELEASE_WORKER.id ||
    worker[0].version !== RELEASE_WORKER.version || worker[0].ezbr_sha256 !== RELEASE_WORKER.hash ||
    worker[0].status !== "ACTIVE" || worker[0].verify_jwt !== true)
    throw Error("trial_release_worker_changed");
  const c = snapshot.catalog?.[0];
  if (snapshot.catalog?.length !== 1 || !c || !ledgerMatches(c.ledger, expectedLedger(installed)) ||
    c.base_flags !== 2 || c.users_flag_bad !== 0 || c.users_versions !== 0 || c.open_arms !== 0 ||
    !Number.isSafeInteger(c.active_jobs) || c.active_jobs < 0 || c.unsafe_jobs !== 0 ||
    !Array.isArray(c.recurring) || c.recurring.length !== 1)
    throw Error("trial_release_scope_or_ledger_changed");
  const cycle = c.recurring[0];
  if (cycle.enabled !== true || cycle.connection_ok !== true ||
    !Number.isSafeInteger(cycle.phase) || cycle.phase < 0 || cycle.phase > 4 ||
    (cycle.phase === 0 ? cycle.current_request !== null : cycle.current_request === null) ||
    !HEALTHY_CYCLE.includes(cycle.last_state))
    throw Error("trial_release_cycle_changed");
  for (const key of Object.keys(SIGNATURES)) {
    const expectedHash = installed ? POST[key] : BASE[key] ?? null;
    if (c[`${key}_hash`] !== expectedHash || c[`${key}_anon`] !== false ||
      c[`${key}_auth`] !== (installed ? !["active", "allowed"].includes(key) : expectedHash !== null) ||
      c[`${key}_service`] !== false)
      throw Error("trial_release_function_or_grant_changed:" + key);
  }
  return { state: installed ? "installed_default_off_readback" : "exact_trial_sql_ready",
    versions: FILES.map(file => file.version), sourceSha256: FILES.map(file => file.sha256),
    ordinaryActiveJobs: c.active_jobs, usersFlagEnabled: false, usersVersions: 0,
    providerRequests: 0 };
}

export function releaseSql(files = reviewedFiles(), rollback = false) {
  if (files.length !== 2 || files.some((file, i) => file.sha256 !== FILES[i].sha256))
    throw Error("trial_release_files_unreviewed");
  const before = expectedLedger(false);
  const after = expectedLedger(true);
  const guard = `select * into c from (${catalogSql}) as exact_catalog;
 if c.ledger is distinct from ${quote(JSON.stringify(before))}::jsonb
  or c.base_flags<>2 or c.users_flag_bad<>0 or c.users_versions<>0 or c.open_arms<>0
  or c.unsafe_jobs<>0 or jsonb_array_length(c.recurring)<>1
  or (c.recurring->0->>'enabled') is distinct from 'true'
  or (c.recurring->0->>'connection_ok') is distinct from 'true'
  or (c.recurring->0->>'phase')::integer not between 0 and 4
  or ((c.recurring->0->>'phase')::integer=0) is distinct from ((c.recurring->0->>'current_request') is null)
  or coalesce(c.recurring->0->>'last_state','') not in
   (${HEALTHY_CYCLE.map(quote).join(",")})
  ${Object.entries(BASE).map(([key, hash]) => `or c.${key}_hash is distinct from '${hash}'`).join("\n  ")}
  or c.restore_hash is not null or c.active_hash is not null or c.allowed_hash is not null
  ${Object.keys(SIGNATURES).map(key => `or c.${key}_anon or c.${key}_service
   or c.${key}_auth is distinct from ${["control", "input", "resume"].includes(key)}`).join("\n  ")}
 then raise exception 'users_trial_release_preflight_changed';end if;`;
  const post = `select * into c from (${catalogSql}) as exact_catalog;
 if c.ledger is distinct from ${quote(JSON.stringify(after))}::jsonb
  ${Object.entries(POST).map(([key, hash]) => `or c.${key}_hash is distinct from '${hash}'`).join("\n  ")}
  or not c.restore_auth or c.restore_anon or c.restore_service
  or c.active_auth or c.active_anon or c.active_service
  or c.allowed_auth or c.allowed_anon or c.allowed_service
  ${["control", "input", "resume"].map(key => `or not c.${key}_auth or c.${key}_anon or c.${key}_service`).join("\n  ")}
  or c.users_flag_bad<>0 or c.users_versions<>0 or c.open_arms<>0 or c.unsafe_jobs<>0
 then raise exception 'users_trial_release_postflight_changed';end if;`;
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
select pg_advisory_xact_lock(hashtextextended('learn-input-setup:${TENANT}',0));
do $preflight$ declare c record;begin
 ${guard}
end $preflight$;
${files.map(file => file.body).join("\n")}
insert into supabase_migrations.schema_migrations(version,name,statements) values
${files.map(file => ` (${quote(file.version)},${quote(file.name)},array[${quote(file.text)}])`).join(",\n")};
do $postflight$ declare c record;begin
 ${post}
end $postflight$;
select '${FILES[1].version}' as installed_trial_fence_version;
${rollback ? "rollback" : "commit"};`;
}

async function management(project, token, path, query, readOnly = true, fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${token}`,
      ...(query ? { "Content-Type": "application/json" } : {}) },
    ...(query ? { body: JSON.stringify({ query, ...(readOnly ? {} : { read_only: false }) }) } : {}),
  });
  if (!response.ok) throw Error(`trial_release_${readOnly ? "read" : "write"}_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 2 * 1024 * 1024) throw Error("trial_release_response_oversized");
  return JSON.parse(bytes.toString("utf8"));
}

export async function readStage(project = PROJECT, token = savedCliToken(), fetcher = fetch) {
  if (project !== PROJECT) throw Error("exact_live_project_required");
  const [info, functions, catalog] = await Promise.all([
    management(project, token, "", null, true, fetcher),
    management(project, token, "/functions", null, true, fetcher),
    management(project, token, "/database/query/read-only", catalogSql, true, fetcher),
  ]);
  return { project: info, functions, catalog };
}

export async function testRollback({ token = savedCliToken(), fetcher = fetch } = {}) {
  const files = reviewedFiles();
  const before = await management(TEST_PROJECT, token, "/database/query/read-only", functionSql, true, fetcher);
  if (before?.length !== 1 || before[0].control_hash !== BASE.control ||
    before[0].input_hash !== BACKEND_FUNCTIONS["learn_operator_input_request(uuid, uuid, uuid, jsonb, text)"].before ||
    before[0].resume_hash !== BACKEND_FUNCTIONS["learn_operator_resume_commusoft(uuid, uuid, uuid, jsonb, text)"].before ||
    ["restore", "active", "allowed"].some(key => before[0][`${key}_hash`] !== null))
    throw Error("trial_release_test_baseline_changed");
  const sql = `begin;\n${backendSource().body}\n${backendResumeSource().body}\n${files.map(file => file.body).join("\n")}\n${functionSql};\nrollback;`;
  const inside = await management(TEST_PROJECT, token, "/database/query", sql, false, fetcher);
  if (inside?.length !== 1 || Object.entries(POST).some(([key, hash]) => inside[0][`${key}_hash`] !== hash) ||
    inside[0].restore_auth !== true || inside[0].restore_anon !== false || inside[0].restore_service !== false ||
    ["active", "allowed"].some(key => inside[0][`${key}_auth`] !== false || inside[0][`${key}_service`] !== false))
    throw Error("trial_release_test_compilation_changed");
  const after = await management(TEST_PROJECT, token, "/database/query/read-only", functionSql, true, fetcher);
  if (JSON.stringify(after) !== JSON.stringify(before)) throw Error("trial_release_test_rollback_changed");
  return { state: "test_rollback_verified", project: TEST_PROJECT,
    sourceSha256: FILES.map(file => file.sha256), postFunctionHashes: POST,
    providerRequests: 0 };
}

export async function installLive({ token = savedCliToken(), rehearse = testRollback, read = readStage,
  write = sql => management(PROJECT, token, "/database/query", sql, false) } = {}) {
  const files = reviewedFiles();
  const test = await rehearse({ token });
  if (test?.state !== "test_rollback_verified") throw Error("trial_release_test_gate_unverified");
  assessStage(await read(PROJECT, token), false);
  let acknowledged = false;
  try {
    const rows = await write(releaseSql(files));
    acknowledged = rows?.some?.(row => row.installed_trial_fence_version === FILES[1].version) === true;
  } catch { /* Unknown outcome: read back once and never replay automatically. */ }
  let after;
  try { after = await read(PROJECT, token); assessStage(after, true); }
  catch { throw Error("trial_release_outcome_unverified_no_replay"); }
  return { state: "installed_default_off_readback", versions: FILES.map(file => file.version),
    sourceSha256: FILES.map(file => file.sha256), acknowledged,
    ledgerAndFunctionReadbackVerified: true, providerRequests: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--test-rollback-only")
      console.log(JSON.stringify(await testRollback()));
    else if (args.length === 1 && args[0] === "--live-read-only" &&
      process.env.NEW_DAWN_M2_TRIAL_PROJECT === PROJECT)
      console.log(JSON.stringify(assessStage(await readStage(), false)));
    else if (args.length === 6 && args[0] === "--live-install-exact" &&
      args[1] === "--source-sha" && args[2] === FILES[0].sha256 &&
      args[3] === "--fence-sha" && args[4] === FILES[1].sha256 &&
      args[5] === "--no-provider" && process.env.NEW_DAWN_M2_TRIAL_PROJECT === PROJECT)
      console.log(JSON.stringify(await installLive()));
    else throw Error("explicit_exact_trial_release_scope_required");
  } catch (error) {
    console.error(JSON.stringify({ state: "trial_release_stopped",
      code: error instanceof Error ? error.message : "unknown", retryAllowed: false,
      providerRequests: 0 }));
    process.exitCode = 1;
  }
}
