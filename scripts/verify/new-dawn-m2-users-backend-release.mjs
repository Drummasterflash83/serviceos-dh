/** Exact, default-off Commusoft /users authority release. No provider call. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { executableStructure } from "./new-dawn-m2-closure-edge-release.mjs";

export const PROJECT = "tgbnakbxwcqjeimygroz";
export const TENANT = "00000000-0000-0000-0000-000000000001";
export const VERSION = "20261105180000";
export const NAME = "commusoft_source_users";
export const SOURCE_SHA256 = "bac767a835c1e8c97bc1e90d343cccfb2010893d3188ef04ad65c33610d5e501";
export const RESUME_VERSION = "20261105190000";
export const RESUME_NAME = "commusoft_source_users_resume";
export const RESUME_SOURCE_SHA256 =
  "cbb7498d28b2a4bb7c238fed65ee7f1441fcf1cb70cb513e43ed7bcd7a86708d";
export const WORKER = Object.freeze({
  slug: "learn-commusoft-worker",
  version: 11,
  hash: "57b89f4513f78ed9cfa1fcd6f93bca5e9982361a9ede71f6b324225e0d3a0339",
  files: Object.freeze({
    "index.ts": "399e7bec653f653124522966a45528e1b9b83655bd7a7cd20381c53459b45007",
    "functions/_shared/commusoft/read_page.ts":
      "82a355c3381679a6d245ab3e37bb1570b6ede7f20fc96c50b074fc7a31dace7e",
    "functions/_shared/commusoft/stored_scope.ts":
      "969447732054d36f07b4e5505ffa02a51717b91f5e3ccf1b6a5872748e55ad76",
  }),
});
export const RELEASE_WORKER = Object.freeze({
  id: "d0db77c9-c88c-49ff-b055-aceef8b59933",
  slug: WORKER.slug,
  version: 12,
  hash: "3c74bf18dde616ef8f6170242d4b13cee27a64e7ae205c58e771e55c30dfe4fb",
  sourceClosureSha256: "71f07dc895970b0780751b4d206cbb3b8b71668bd1f357341e3e2d373d3fef44",
});
export const FUNCTIONS = Object.freeze({
  "learn_commusoft_acquire_page(uuid, uuid, text, integer, jsonb)": Object.freeze({
    before: "cce74c44543ef2ea0bf295911f0e1cf30b48c9564c187ba45db6ee75167ba984",
    after: "f4add374485860c2029fd00ecc2eb75a87e79715036bd62abc199a7e59078ed9",
    testBefore: "2313ba6f1a7bc833530b1e4d3b0add2eec766d9684dbc610ac74858841f17e41",
    testAfter: "2df66dbf95a7ba52ba86d80697fff064ecb4d9a90d28b6a4cd8158d7a7b4ca4d",
    authenticated: false,
    service: true,
  }),
  "learn_commusoft_commit_page(uuid, uuid, text, integer, uuid, jsonb)": Object.freeze({
    before: "137f0fab64802bc6ac651f852d072bfc21700fe81600fd831084cdcf2a1bea1e",
    after: "dd607fb5610e1d50c3cc744b08b360273588f7a15b962967dacfe1d0d028df56",
    testBefore: "137f0fab64802bc6ac651f852d072bfc21700fe81600fd831084cdcf2a1bea1e",
    testAfter: "dd607fb5610e1d50c3cc744b08b360273588f7a15b962967dacfe1d0d028df56",
    authenticated: false,
    service: true,
  }),
  "learn_operator_resume_commusoft(uuid, uuid, uuid, jsonb, text)": Object.freeze({
    before: "dd8e8a0297d7ac83e4db8d833aaa509ca2dc67b096eb2d4f0f5d350b6fa7af68",
    after: "026cd89cc1e83a16419d5a1453e7c2e780599762a0371c1ce822e71cc6a3682e",
    testBefore: "dd8e8a0297d7ac83e4db8d833aaa509ca2dc67b096eb2d4f0f5d350b6fa7af68",
    testAfter: "026cd89cc1e83a16419d5a1453e7c2e780599762a0371c1ce822e71cc6a3682e",
    authenticated: true,
    service: false,
  }),
  "learn_operator_input_request(uuid, uuid, uuid, jsonb, text)": Object.freeze({
    before: "3ee922794d40d56e70fca41581e6660bb946cfb0297edad7ee38719a697072bd",
    after: "cf69a0e32538fc0e025350e523b6309527ab4a4db416a5caff770047e3988f65",
    testBefore: "3ee922794d40d56e70fca41581e6660bb946cfb0297edad7ee38719a697072bd",
    testAfter: "cf69a0e32538fc0e025350e523b6309527ab4a4db416a5caff770047e3988f65",
    authenticated: true,
    service: false,
  }),
});
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const signatures = Object.keys(FUNCTIONS);
const functionRows = `select jsonb_agg(jsonb_build_object(
  'signature',p.proname||'('||oidvectortypes(p.proargtypes)||')',
  'hash',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
  'definer',p.prosecdef,'config',p.proconfig,
  'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'service',has_function_privilege('service_role',p.oid,'EXECUTE'))
  order by p.proname,oidvectortypes(p.proargtypes)) as functions
  from pg_proc p where p.oid in (${signatures.map((s) => quote("public." + s.replaceAll(", ", ",")) + "::regprocedure").join(",")})`;

export function source() {
  const text = readFileSync(
    new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`, import.meta.url),
    "utf8",
  );
  if (
    sha(text) !== SOURCE_SHA256 ||
    !/^\s*(?:--[^\n]*\n)*begin;\s*$/im.test(text) ||
    !/\ncommit;\s*$/i.test(text)
  )
    throw Error("users_reviewed_source_changed");
  const body = text.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im, "").replace(/\ncommit;\s*$/i, "");
  if (
    [...body.matchAll(/\$old\$/g)].length !== 10 ||
    [...body.matchAll(/\$new\$/g)].length !== 10 ||
    /\b(?:create table|insert into|delete from|update public\.)\b/i.test(body)
  )
    throw Error("users_migration_scope_changed");
  return { text, body };
}

export function resumeSource() {
  const text = readFileSync(
    new URL(`../../supabase/migrations/${RESUME_VERSION}_${RESUME_NAME}.sql`, import.meta.url),
    "utf8",
  );
  if (
    sha(text) !== RESUME_SOURCE_SHA256 ||
    !/^\s*(?:--[^\n]*\n)*begin;\s*$/im.test(text) ||
    !/\ncommit;\s*$/i.test(text) ||
    [...text.matchAll(/\$old\$/g)].length !== 8 ||
    [...text.matchAll(/\$new\$/g)].length !== 8
  )
    throw Error("users_resume_reviewed_source_changed");
  return {
    text,
    body: text.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im, "").replace(/\ncommit;\s*$/i, ""),
  };
}

export const catalogSql = `select jsonb_build_object(
 'functions',(select functions from (${functionRows}) f),
 'ledger',(select coalesce(jsonb_agg(jsonb_build_object('version',version::text,
  'name',name,'statements',statements) order by version::text),'[]'::jsonb)
  from supabase_migrations.schema_migrations where version::text in ('${VERSION}','${RESUME_VERSION}')),
 'flag_count',(select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag='learn.inputs.commusoft.users.enabled'),
 'active_jobs',(select count(*) from public.platform_jobs where tenant_id='${TENANT}'::uuid
  and job_type='commusoft.source_sync' and status in ('queued','running','retrying')),
 'source_versions',(select count(*) from public.learn_business_input_versions
  where tenant_id='${TENANT}'::uuid and provider='commusoft' and collection='users'),
 'base_flags',(select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag in ('learn.enabled','learn.inputs.commusoft.enabled') and value='true'::jsonb),
 'connections',(select count(*) from public.provider_connections where tenant_id='${TENANT}'::uuid
  and provider='commusoft' and status='configured' and revoked_at is null)
) as catalog`;

export function assessFunctions(rows, stage = "before", project = PROJECT) {
  if (!["before", "after"].includes(stage) || ![PROJECT, TEST_PROJECT].includes(project))
    throw Error("users_stage_invalid");
  if (
    !Array.isArray(rows) ||
    rows.length !== 4 ||
    new Set(rows.map((row) => row?.signature)).size !== 4
  )
    throw Error("users_functions_missing");
  for (const row of rows) {
    const expected = FUNCTIONS[row.signature];
    if (
      !expected ||
      row.hash !==
        (project === TEST_PROJECT
          ? expected[stage === "before" ? "testBefore" : "testAfter"]
          : expected[stage]) ||
      row.definer !== true ||
      JSON.stringify(row.config) !== JSON.stringify(["search_path=pg_catalog"]) ||
      row.anon !== false ||
      row.authenticated !== expected.authenticated ||
      row.service !== expected.service
    )
      throw Error("users_function_or_grant_changed");
  }
  return true;
}

export function assess(catalog, stage = "before", project = PROJECT) {
  if (
    !catalog ||
    !Array.isArray(catalog.ledger) ||
    Number(catalog.flag_count) !== 0 ||
    Number(catalog.active_jobs) !== 0 ||
    Number(catalog.source_versions) !== 0 ||
    Number(catalog.base_flags) !== 2 ||
    Number(catalog.connections) !== 1
  )
    throw Error("users_catalog_scope_changed");
  assessFunctions(catalog.functions, stage, project);
  const expectedLedger =
    stage === "before"
      ? []
      : [
          { version: VERSION, name: NAME, text: source().text },
          { version: RESUME_VERSION, name: RESUME_NAME, text: resumeSource().text },
        ];
  if (
    catalog.ledger.length !== expectedLedger.length ||
    expectedLedger.some(
      (expected, i) =>
        catalog.ledger[i]?.version !== expected.version ||
        catalog.ledger[i]?.name !== expected.name ||
        !Array.isArray(catalog.ledger[i]?.statements) ||
        catalog.ledger[i].statements.length !== 1 ||
        catalog.ledger[i].statements[0] !== expected.text,
    )
  )
    throw Error("users_ledger_changed");
  return {
    state:
      stage === "before"
        ? "users_backend_ready_default_off"
        : "users_backend_installed_default_off",
    project,
    versions: [VERSION, RESUME_VERSION],
    sourceSha256: SOURCE_SHA256,
    resumeSourceSha256: RESUME_SOURCE_SHA256,
    providerRequests: 0,
  };
}

export function assessDownloadedWorker(root, metadata) {
  if (
    metadata?.slug !== WORKER.slug ||
    metadata.version !== WORKER.version ||
    metadata.ezbr_sha256 !== WORKER.hash ||
    metadata.status !== "ACTIVE" ||
    metadata.verify_jwt !== true
  )
    throw Error("users_worker_version_changed");
  const base = join(root, "supabase/functions/learn-commusoft-worker");
  for (const [file, hash] of Object.entries(WORKER.files)) {
    if (sha(readFileSync(join(base, file))) !== hash)
      throw Error("users_worker_bundle_changed:" + file);
  }
  const request = readFileSync(join(base, "functions/_shared/commusoft/read_page.ts"), "utf8");
  const scope = readFileSync(join(base, "functions/_shared/commusoft/stored_scope.ts"), "utf8");
  if (
    !request.includes('"users"') ||
    !request.includes("/api/v2/${request.resource}") ||
    !scope.includes('cfg.resource === "users"') ||
    !scope.includes("cfg.maxPages !== 1") ||
    !scope.includes("cfg.pageSize > 10")
  )
    throw Error("users_worker_boundary_changed");
  return {
    state: "exact_live_worker_users_route",
    version: WORKER.version,
    bundleHash: WORKER.hash,
    providerRequests: 0,
  };
}

export function assessDownloadedReleaseWorker(root, metadata) {
  if (
    metadata?.id !== RELEASE_WORKER.id ||
    metadata.slug !== RELEASE_WORKER.slug ||
    metadata.version !== RELEASE_WORKER.version ||
    metadata.ezbr_sha256 !== RELEASE_WORKER.hash ||
    metadata.status !== "ACTIVE" ||
    metadata.verify_jwt !== true
  )
    throw Error("users_release_worker_changed");
  const bundle = edgeRuntimeBundle([{ name: WORKER.slug, verifyJwt: true }]);
  if (
    bundle.sha256 !== RELEASE_WORKER.sourceClosureSha256 ||
    bundle.files.length !== 9 ||
    JSON.stringify(bundle.external) !==
      JSON.stringify(["https://esm.sh/@supabase/supabase-js@2.45.4"])
  )
    throw Error("users_release_worker_source_changed");
  const base = join(root, "supabase/functions", WORKER.slug);
  for (const file of bundle.files) {
    const path = file.path.startsWith(WORKER.slug + "/")
      ? join(base, "index.ts")
      : join(base, "functions", file.path);
    if (executableStructure(readFileSync(path, "utf8")) !== executableStructure(file.source))
      throw Error("users_release_worker_download_changed:" + file.path);
  }
  return {
    state: "exact_live_worker_v12_executable_closure",
    workerVersion: RELEASE_WORKER.version,
    runtimeHash: RELEASE_WORKER.hash,
    sourceClosureSha256: bundle.sha256,
    providerRequests: 0,
  };
}

async function management(project, token, path, sql = null, readOnly = true, fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: sql ? "POST" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(60000),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(sql ? { "Content-Type": "application/json" } : {}),
    },
    ...(sql ? { body: JSON.stringify({ query: sql, read_only: readOnly }) } : {}),
  });
  if (!response.ok) throw Error(`users_${readOnly ? "read" : "write"}_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 1024 * 1024) throw Error("users_management_result_oversized");
  return JSON.parse(bytes.toString("utf8"));
}

export async function readStage(project = PROJECT, token = savedCliToken(), fetcher = fetch) {
  const [info, functions, rows] = await Promise.all([
    management(project, token, "", null, true, fetcher),
    management(project, token, "/functions", null, true, fetcher),
    management(project, token, "/database/query/read-only", catalogSql, true, fetcher),
  ]);
  if (
    info?.id !== project ||
    info.status !== "ACTIVE_HEALTHY" ||
    !Array.isArray(functions) ||
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    !rows[0]?.catalog
  )
    throw Error("users_project_or_catalog_unverified");
  const worker = functions.filter((f) => f.slug === WORKER.slug);
  if (worker.length !== 1) throw Error("users_worker_missing_or_duplicate");
  return { catalog: rows[0].catalog, worker: worker[0] };
}

export function releaseSql(rollback = false) {
  const { text, body } = source();
  const resume = resumeSource();
  const checks = signatures
    .map((s) => {
      const x = FUNCTIONS[s],
        reg = `${quote("public." + s.replaceAll(", ", ","))}::regprocedure`;
      return `encode(sha256(convert_to(pg_get_functiondef(${reg}),'UTF8')),'hex')
      is distinct from '${x.before}'
      or not (select p.prosecdef and p.proconfig=array['search_path=pg_catalog']::text[]
       and not has_function_privilege('anon',p.oid,'EXECUTE')
       and has_function_privilege('authenticated',p.oid,'EXECUTE')=${x.authenticated}
       and has_function_privilege('service_role',p.oid,'EXECUTE')=${x.service}
       from pg_proc p where p.oid=${reg})`;
    })
    .join(" or\n  ");
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $users_gate$ begin
 if exists(select 1 from supabase_migrations.schema_migrations
   where version::text in ('${VERSION}','${RESUME_VERSION}'))
  or exists(select 1 from public.feature_flags where tenant_id='${TENANT}'::uuid
   and flag='learn.inputs.commusoft.users.enabled')
  or exists(select 1 from public.platform_jobs where tenant_id='${TENANT}'::uuid
   and job_type='commusoft.source_sync' and status in ('queued','running','retrying'))
  or exists(select 1 from public.learn_business_input_versions where tenant_id='${TENANT}'::uuid
   and provider='commusoft' and collection='users')
  or (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid
   and flag in ('learn.enabled','learn.inputs.commusoft.enabled') and value='true'::jsonb)<>2
  or ${checks}
 then raise exception 'users_exact_live_preflight_changed';end if;
end $users_gate$;
${body}
${resume.body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values(${quote(VERSION)},${quote(NAME)},array[${quote(text)}]),
  (${quote(RESUME_VERSION)},${quote(RESUME_NAME)},array[${quote(resume.text)}]);
select 'new-dawn-users-backend/1' as marker;
${rollback ? "rollback" : "commit"};`;
}

export async function installLive({
  token = savedCliToken(),
  fetcher = fetch,
  read = readStage,
  write = (sql) => management(PROJECT, token, "/database/query", sql, false, fetcher),
} = {}) {
  const before = await read(PROJECT, token, fetcher);
  assess(before.catalog, "before");
  if (
    before.worker?.id !== RELEASE_WORKER.id ||
    before.worker?.ezbr_sha256 !== RELEASE_WORKER.hash ||
    before.worker.version !== RELEASE_WORKER.version ||
    before.worker.status !== "ACTIVE" ||
    before.worker.verify_jwt !== true
  )
    throw Error("users_worker_version_changed");
  let acknowledged = false;
  try {
    const rows = await write(releaseSql());
    acknowledged = rows?.some?.((r) => r.marker === "new-dawn-users-backend/1") === true;
  } catch {
    /* Unknown outcome: read once, never replay automatically. */
  }
  let after;
  try {
    after = await read(PROJECT, token, fetcher);
    assess(after.catalog, "after");
  } catch {
    throw Error("users_install_outcome_unverified_no_replay");
  }
  return {
    state: "users_backend_installed_default_off",
    versions: [VERSION, RESUME_VERSION],
    sourceSha256: SOURCE_SHA256,
    resumeSourceSha256: RESUME_SOURCE_SHA256,
    workerVersion: RELEASE_WORKER.version,
    acknowledged,
    providerRequests: 0,
    flagEnabled: false,
  };
}

export async function rehearseTest({ token = savedCliToken(), fetcher = fetch } = {}) {
  const before = await management(
    TEST_PROJECT,
    token,
    "/database/query/read-only",
    functionRows,
    true,
    fetcher,
  );
  if (before.length !== 1 || !assessFunctions(before[0]?.functions, "before", TEST_PROJECT))
    throw Error("users_test_baseline_changed");
  const sql = `begin;\n${source().body}\n${resumeSource().body}\n${functionRows};\nrollback;`;
  const rows = await management(TEST_PROJECT, token, "/database/query", sql, false, fetcher);
  const receipt = rows?.find?.((r) => Array.isArray(r.functions));
  if (!receipt) throw Error("users_test_marker_missing");
  assessFunctions(receipt.functions, "after", TEST_PROJECT);
  const after = await management(
    TEST_PROJECT,
    token,
    "/database/query/read-only",
    functionRows,
    true,
    fetcher,
  );
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error("users_test_rollback_changed");
  return {
    state: "users_backend_test_rolled_back",
    project: TEST_PROJECT,
    sourceSha256: SOURCE_SHA256,
    resumeSourceSha256: RESUME_SOURCE_SHA256,
    providerRequests: 0,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2).join(" ");
    if (args === "--live-read-only") {
      const s = await readStage();
      console.log(
        JSON.stringify({
          ...assess(s.catalog, s.catalog.ledger.length ? "after" : "before"),
          workerVersion: s.worker.version,
        }),
      );
    } else if (args === "--test-rollback-only") console.log(JSON.stringify(await rehearseTest()));
    else if (args.startsWith("--verify-worker-bundle --path ")) {
      const s = await readStage();
      console.log(JSON.stringify(assessDownloadedWorker(process.argv[4], s.worker)));
    } else if (args.startsWith("--verify-release-worker-bundle --path ")) {
      const s = await readStage();
      console.log(JSON.stringify(assessDownloadedReleaseWorker(process.argv[4], s.worker)));
    } else if (
      args === `--live-install-exact --source-sha ${SOURCE_SHA256}` &&
      process.env.NEW_DAWN_M2_USERS_PROJECT === PROJECT
    )
      console.log(JSON.stringify(await installLive()));
    else throw Error("users_exact_mode_or_project_required");
  } catch (error) {
    console.error(
      JSON.stringify({
        state: "users_backend_stopped",
        code: error.message,
        retryAllowed: false,
        providerRequests: 0,
      }),
    );
    process.exitCode = 1;
  }
}
