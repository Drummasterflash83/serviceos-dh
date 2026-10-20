/** Exact, default-OFF scheduled-activity source release. No provider request. */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { savedCliToken } from "./learn-test-readiness.mjs";

export const PROJECT = "tgbnakbxwcqjeimygroz";
export const TEST_PROJECT = "saatxzwxvdvqevbnskxy";
export const MERGED_SOURCE = "c117ee30c31977a7c361aa6b3d2661d02ea614d5";
export const VERSION = "20261106193000";
export const NAME = "new_dawn_commusoft_scheduled_activity_probe";
export const SLUG = "learn-commusoft-scheduled-activity-probe";
export const FLAG = "new_dawn.m2_scheduled_activity_probe";
const CLI = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PIN = Object.freeze({
  [`supabase/migrations/${VERSION}_${NAME}.sql`]:
    "c5d57b4cdbd0c46ffdb1ae3b48c457619ff5ce17593b02ac145c7279931e4ae2",
  [`supabase/functions/${SLUG}/index.ts`]:
    "4303cb7e516e6d6a4b05ff46d42f68d2e77fe98548b9b2795fe2488e254317b6",
  "supabase/functions/_shared/commusoft/scheduled_activity_probe.ts":
    "1435b65d03877de24e88e26b88f277b7e2d18aa529e821589a6f898c70f0a635",
  "supabase/functions/_shared/commusoft/retry_after.ts":
    "fa106174e9d5e08faf2e956c3f370fdd8d0df4d7d93e397fac586e4b3ec04b10",
});
const sha = (value) => createHash("sha256").update(value).digest("hex");
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";

export function pinnedSources(read = readFileSync, git = execFileSync) {
  const files = Object.entries(PIN).map(([path, hash]) => {
    const bytes = read(join(ROOT, path));
    if (
      sha(bytes) !== hash ||
      sha(
        git("git", ["show", `${MERGED_SOURCE}:${path}`], {
          cwd: ROOT,
          stdio: ["ignore", "pipe", "ignore"],
          maxBuffer: 1024 * 1024,
        }),
      ) !== hash
    )
      throw Error("reviewed_source_changed:" + path);
    return { path, hash, source: bytes.toString("utf8") };
  });
  const sql = files[0].source;
  if (!/^\s*(?:--[^\n]*\n)*begin;\s*$/im.test(sql) || !/\ncommit;\s*$/i.test(sql))
    throw Error("migration_transaction_fence_changed");
  return {
    files,
    sql,
    body: sql.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im, "").replace(/\ncommit;\s*$/i, ""),
    sourceSha256: PIN[files[0].path],
    closureSha256: sha(JSON.stringify(files.slice(1).map(({ path, hash }) => [path, hash]))),
  };
}

export const SCOPE_SQL = `select
 to_regclass('public.new_dawn_commusoft_scheduled_activity_probes') is not null as probe_table,
 to_regclass('public.new_dawn_commusoft_scheduled_activity_probe_events') is not null as event_table,
 (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'new_dawn_commusoft_scheduled_activity_probe_%') as probe_functions,
 (select count(*)::int from public.feature_flags where flag='${FLAG}') as flag_rows,
 to_regprocedure('public.learn_commusoft_verification_authority(public.learn_commusoft_verification_requests)') is not null as authority_ready,
 to_regprocedure('public.learn_operator_input_access(uuid,uuid,boolean)') is not null as operator_gate_ready,
 to_regclass('public.learn_business_input_request_gates') is not null as quota_gate_ready`;
export const LEDGER_SQL = `select version::text,name,statements from supabase_migrations.schema_migrations
 where version::text='${VERSION}'`;
const GRANTS_SQL = `select
 (select relrowsecurity from pg_class where oid='public.new_dawn_commusoft_scheduled_activity_probes'::regclass) as probe_rls,
 (select relrowsecurity from pg_class where oid='public.new_dawn_commusoft_scheduled_activity_probe_events'::regclass) as event_rls,
 has_table_privilege('anon','public.new_dawn_commusoft_scheduled_activity_probes','SELECT') as anon_read,
 has_table_privilege('authenticated','public.new_dawn_commusoft_scheduled_activity_probes','SELECT') as client_read,
 has_table_privilege('service_role','public.new_dawn_commusoft_scheduled_activity_probes','SELECT') as service_read`;

async function management(token, path, query = null, readOnly = true, fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${PROJECT}${path}`, {
    method: query === null ? "GET" : "POST",
    redirect: "error",
    signal: AbortSignal.timeout(90000),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(query === null ? {} : { "Content-Type": "application/json" }),
    },
    ...(query === null ? {} : { body: JSON.stringify({ query, read_only: readOnly }) }),
  });
  if (!response.ok)
    throw Error(`management_${readOnly ? "read" : "write"}_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 2 * 1024 * 1024) throw Error("management_response_oversized");
  return JSON.parse(bytes.toString("utf8"));
}
export async function readStage(token, fetcher = fetch) {
  const q = (sql) => management(token, "/database/query/read-only", sql, true, fetcher);
  const [project, functions, scope, ledger] = await Promise.all([
    management(token, "", null, true, fetcher),
    management(token, "/functions", null, true, fetcher),
    q(SCOPE_SQL),
    q(LEDGER_SQL),
  ]);
  if (!Array.isArray(functions) || new Set(functions.map((x) => x.slug)).size !== functions.length)
    throw Error("edge_inventory_unconfirmed");
  return { project, functions, scope, ledger };
}
export function assessStage(snapshot, stage, source = pinnedSources()) {
  const scope = snapshot?.scope?.[0];
  const edge = snapshot?.functions?.filter((x) => x.slug === SLUG);
  const ledger = snapshot?.ledger;
  if (
    !["absent", "sql", "complete"].includes(stage) ||
    snapshot?.project?.id !== PROJECT ||
    snapshot.project.status !== "ACTIVE_HEALTHY" ||
    snapshot.scope?.length !== 1 ||
    !scope ||
    !Array.isArray(edge) ||
    scope.authority_ready !== true ||
    scope.operator_gate_ready !== true ||
    scope.quota_gate_ready !== true ||
    scope.flag_rows !== 0 ||
    scope.probe_table !== (stage !== "absent") ||
    scope.event_table !== (stage !== "absent") ||
    scope.probe_functions !== (stage === "absent" ? 0 : 9) ||
    !Array.isArray(ledger) ||
    ledger.length !== (stage === "absent" ? 0 : 1) ||
    (stage !== "absent" &&
      (String(ledger[0]?.version) !== VERSION ||
        ledger[0]?.name !== NAME ||
        ledger[0]?.statements?.length !== 1 ||
        ledger[0].statements[0] !== source.sql)) ||
    edge.length !== (stage === "complete" ? 1 : 0)
  )
    throw Error("scheduled_release_stage_changed");
  if (
    stage === "complete" &&
    (edge[0].status !== "ACTIVE" ||
      edge[0].version !== 1 ||
      edge[0].verify_jwt !== false ||
      !/^[a-f0-9]{64}$/.test(edge[0].ezbr_sha256))
  )
    throw Error("scheduled_edge_readback_changed");
  return {
    state: stage,
    project: PROJECT,
    sourceSha256: source.sourceSha256,
    closureSha256: source.closureSha256,
    edgeVersion: stage === "complete" ? edge[0].version : null,
    edgeSha256: stage === "complete" ? edge[0].ezbr_sha256 : null,
    flagEnabled: false,
    providerRequests: 0,
  };
}
export function migrationSql(source = pinnedSources(), rollback = false) {
  return `begin;\nset local lock_timeout='3s';\nset local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $scheduled_gate$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}')
  or to_regclass('public.new_dawn_commusoft_scheduled_activity_probes') is not null
  or to_regclass('public.new_dawn_commusoft_scheduled_activity_probe_events') is not null
  or exists(select 1 from public.feature_flags where flag='${FLAG}')
 then raise exception 'scheduled_release_scope_changed';end if;
end $scheduled_gate$;
${source.body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values(${quote(VERSION)},${quote(NAME)},array[${quote(source.sql)}]);
select '${VERSION}' as installed_version;
${rollback ? "rollback" : "commit"};`;
}
export async function verifyGrants(token, fetcher = fetch) {
  const rows = await management(token, "/database/query/read-only", GRANTS_SQL, true, fetcher);
  if (
    rows?.length !== 1 ||
    rows[0].probe_rls !== true ||
    rows[0].event_rls !== true ||
    rows[0].anon_read !== false ||
    rows[0].client_read !== false ||
    rows[0].service_read !== false
  )
    throw Error("scheduled_private_receipt_grants_changed");
  return true;
}
export async function installSql({
  token = savedCliToken(),
  read = readStage,
  write,
  grants = verifyGrants,
} = {}) {
  const source = pinnedSources();
  assessStage(await read(token), "absent", source);
  const writer = write ?? ((sql) => management(token, "/database/query", sql, false));
  let acknowledged = false;
  try {
    const rows = await writer(migrationSql(source));
    acknowledged = Array.isArray(rows) && rows.some((x) => x?.installed_version === VERSION);
  } catch {
    /* Unknown write outcome: inspect once, never replay. */
  }
  try {
    const after = await read(token);
    assessStage(after, "sql", source);
    await grants(token);
  } catch {
    throw Error("sql_outcome_unverified_no_replay");
  }
  return {
    state: "exact_sql_installed",
    acknowledged,
    sourceSha256: source.sourceSha256,
    defaultOff: true,
    providerRequests: 0,
  };
}

// A downloaded Edge bundle may format compiled JS differently. Compare executable syntax.
export function executableStructure(source) {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
      verbatimModuleSyntax: false,
    },
  }).outputText;
  const file = ts.createSourceFile("module.js", js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function shape(node) {
    if (ts.isParenthesizedExpression(node)) return shape(node.expression);
    const children = [];
    ts.forEachChild(node, (child) => children.push(shape(child)));
    return [
      node.kind,
      ts.isIdentifier(node) || ts.isLiteralExpression(node) || ts.isTemplateLiteralToken(node)
        ? node.text
        : null,
      node.operator ?? null,
      ts.isVariableDeclarationList(node) ? node.flags & ts.NodeFlags.BlockScoped : null,
      children,
    ];
  }
  return JSON.stringify(shape(file));
}
function stagedPath(path) {
  return path.replace(/^supabase\/functions\//, "");
}
function downloadedPath(root, path) {
  return join(
    root,
    "supabase/functions",
    SLUG,
    path.endsWith(`${SLUG}/index.ts`) ? "index.ts" : `work/supabase/functions/${stagedPath(path)}`,
  );
}
export function verifyDownloaded(root, source = pinnedSources()) {
  for (const file of source.files.slice(1)) {
    const downloaded = readFileSync(downloadedPath(root, file.path), "utf8");
    if (executableStructure(downloaded) !== executableStructure(file.source))
      throw Error("downloaded_source_changed:" + file.path);
  }
  return source.closureSha256;
}
async function download(token, root, runner = spawnSync) {
  if (existsSync(root)) throw Error("fresh_download_path_required");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const result = runner(
    CLI,
    ["functions", "download", SLUG, "--project-ref", PROJECT, "--workdir", root],
    {
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
      encoding: "utf8",
      timeout: 90000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.status !== 0) throw Error("edge_download_unconfirmed");
}
export async function installEdge({
  token = savedCliToken(),
  read = readStage,
  grants = verifyGrants,
  runCli = spawnSync,
  downloader = download,
  verifier = verifyDownloaded,
} = {}) {
  const source = pinnedSources();
  assessStage(await read(token), "sql", source);
  await grants(token);
  const stage = mkdtempSync(join(tmpdir(), "scheduled-activity-edge-"));
  let submitted = false;
  try {
    for (const file of source.files.slice(1)) {
      const path = join(stage, file.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.source);
    }
    writeFileSync(
      join(stage, "supabase/config.toml"),
      `project_id = "${PROJECT}"\n[functions.${SLUG}]\nverify_jwt = false\n`,
    );
    const result = runCli(
      CLI,
      [
        "functions",
        "deploy",
        SLUG,
        "--project-ref",
        PROJECT,
        "--use-api",
        "--no-verify-jwt",
        "--workdir",
        stage,
      ],
      {
        env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
        encoding: "utf8",
        timeout: 90000,
        maxBuffer: 1024 * 1024,
      },
    );
    submitted = result.status === 0;
  } catch {
    /* Unknown deployment outcome: read back; never replay. */
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  try {
    assessStage(await read(token), "complete", source);
    await grants(token);
    const downloaded = mkdtempSync(join(tmpdir(), "scheduled-activity-readback-"));
    try {
      rmSync(downloaded, { recursive: true });
      await downloader(token, downloaded);
      verifier(downloaded, source);
    } finally {
      rmSync(downloaded, { recursive: true, force: true });
    }
    assessStage(await read(token), "complete", source);
  } catch {
    throw Error("edge_outcome_unverified_no_replay");
  }
  return {
    state: "exact_edge_source_readback",
    submitted,
    closureSha256: source.closureSha256,
    defaultOff: true,
    providerRequests: 0,
  };
}
export async function rehearseTest({ token = savedCliToken(), fetcher = fetch } = {}) {
  const source = pinnedSources();
  const query = async (sql, readOnly = true) => {
    const response = await fetcher(
      `https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly ? "/read-only" : ""}`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(90000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql, read_only: readOnly }),
      },
    );
    if (!response.ok) {
      const problem = await response.json().catch(() => null);
      const code =
        typeof problem?.code === "string" && /^[A-Z0-9]{5}$/.test(problem.code)
          ? problem.code
          : "unknown";
      throw Error(
        `test_rollback_http_${response.status}_sqlstate_${code}_${String(problem?.message ?? "").slice(0, 160)}`,
      );
    }
    return response.json();
  };
  const testLedger =
    "select to_regclass('supabase_migrations.schema_migrations') is not null as present";
  const [beforeScope, beforeLedger] = await Promise.all([query(SCOPE_SQL), query(testLedger)]);
  if (
    beforeScope?.length !== 1 ||
    beforeScope[0].probe_table !== false ||
    beforeScope[0].event_table !== false ||
    beforeScope[0].probe_functions !== 0 ||
    beforeScope[0].flag_rows !== 0 ||
    beforeLedger?.length !== 1 ||
    beforeLedger[0].present !== false
  )
    throw Error("test_baseline_changed");
  const nested = migrationSql(source, true)
    .replace(/^begin;\n/, "")
    .replace(/\nrollback;$/, "");
  const exactTestSql =
    `begin;\ncreate schema if not exists supabase_migrations;\n` +
    `create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);\n` +
    nested +
    `\nselect '${VERSION}' as installed_version,g.* from (${GRANTS_SQL}) g;\nrollback;`;
  const rows = await query(exactTestSql, false);
  if (
    rows?.length !== 1 ||
    rows[0]?.installed_version !== VERSION ||
    rows[0].probe_rls !== true ||
    rows[0].event_rls !== true ||
    rows[0].anon_read !== false ||
    rows[0].client_read !== false ||
    rows[0].service_read !== false
  )
    throw Error("test_rollback_receipt_or_grants_changed");
  const [afterScope, afterLedger] = await Promise.all([query(SCOPE_SQL), query(testLedger)]);
  if (
    JSON.stringify(afterScope) !== JSON.stringify(beforeScope) ||
    JSON.stringify(afterLedger) !== JSON.stringify(beforeLedger)
  )
    throw Error("test_rollback_state_changed");
  return {
    state: "test_exact_sql_rolled_back",
    project: TEST_PROJECT,
    sourceSha256: source.sourceSha256,
    defaultOff: true,
    providerRequests: 0,
  };
}

export async function preflight({ token = savedCliToken(), read = readStage } = {}) {
  const source = pinnedSources();
  return assessStage(await read(token), "absent", source);
}
export async function readback({
  token = savedCliToken(),
  read = readStage,
  grants = verifyGrants,
  downloader = download,
  verifier = verifyDownloaded,
} = {}) {
  const source = pinnedSources();
  const result = assessStage(await read(token), "complete", source);
  await grants(token);
  const folder = mkdtempSync(join(tmpdir(), "scheduled-activity-readback-"));
  try {
    rmSync(folder, { recursive: true });
    await downloader(token, folder);
    verifier(folder, source);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  assessStage(await read(token), "complete", source);
  return { ...result, state: "exact_live_readback", sourceVerified: true };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode] = process.argv.slice(2);
    if (process.argv.length !== 3) throw Error("exact_release_mode_required");
    if (
      mode === "--test-rollback-only" &&
      process.env.NEW_DAWN_SCHEDULED_ALLOW_PROJECT === TEST_PROJECT
    )
      console.log(JSON.stringify(await rehearseTest()));
    else {
      if (process.env.NEW_DAWN_SCHEDULED_ALLOW_PROJECT !== PROJECT)
        throw Error("explicit_exact_project_required");
      if (mode === "--live-preflight") console.log(JSON.stringify(await preflight()));
      else if (
        mode === "--live-install-sql" &&
        process.env.NEW_DAWN_SCHEDULED_SOURCE_SHA ===
          PIN[`supabase/migrations/${VERSION}_${NAME}.sql`]
      )
        console.log(JSON.stringify(await installSql()));
      else if (
        mode === "--live-install-edge" &&
        process.env.NEW_DAWN_SCHEDULED_CLOSURE_SHA === pinnedSources().closureSha256
      )
        console.log(JSON.stringify(await installEdge()));
      else if (mode === "--live-readback") console.log(JSON.stringify(await readback()));
      else throw Error("exact_release_mode_or_sha_required");
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        state: "release_stopped",
        code: error.message,
        retryAllowed: false,
        providerRequests: 0,
      }),
    );
    process.exitCode = 1;
  }
}
