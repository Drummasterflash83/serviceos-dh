/** Read-only LIVE Commusoft coexistence preflight and private rollback source capture.
 * No SQL install, Edge deploy, feature change, endpoint invocation or provider GET.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, lstatSync, chmodSync,
  writeFileSync, copyFileSync } from "node:fs";
import { resolve, join, relative, dirname, posix } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { savedCliToken } from "./learn-test-readiness.mjs";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";

export const PROJECT = "tgbnakbxwcqjeimygroz";
export const TENANT = "00000000-0000-0000-0000-000000000001";
export const ENDPOINTS = Object.freeze([
  { name: "learn-commusoft-worker", id: "d0db77c9-c88c-49ff-b055-aceef8b59933",
    version: 10, hash: "dffe6f5a274bf51291198914a8dc2d1f52bc4f9f4fcaadd57c9f9200ef015511", jwt: true },
  { name: "learn-commusoft-job-detail", id: "009b9fb6-8e3c-49b8-8a3e-95531ba370bd",
    version: 1, hash: "444cc2289b56b9d1d7ed89df3cb49f317c46a906fc1900e5ce8a33733be9defd", jwt: false },
  { name: "learn-commusoft-opportunity-probe", id: "cf8d9ce2-0e45-4d8c-a795-4ee4793ab143",
    version: 1, hash: "461e4ba334290f545dd4dbaeccb0db28b815bba7a46917f0ad8bdc3a38544eeb", jwt: false },
]);
export const MIGRATIONS = Object.freeze([
  "20261106150000", "20261106160000", "20261106180000",
]);
export const FLAGS = Object.freeze([
  "new_dawn.m2_commusoft_coexistence", "new_dawn.exact_job_detail",
  "new_dawn.m5_opportunities_probe", "learn.inputs.commusoft.users.enabled",
]);
const CANDIDATE_SOURCE_SHA256 = "882fdf3879ff8df4e321ab9555802609f5805df61354cf7e8d1764730ff5a277";
const MIGRATION_SOURCE_SHA256 = Object.freeze({
  "20261106150000": "a984a2fc235699d3d92ea4980191cb786bc94740e481b3c1ffa8c9004f41848b",
  "20261106160000": "6a9eaac74785cefb1ca53351dfc77f55adce112af97cd721d71cb6789935c953",
  "20261106180000": "e1e631ff7c6f2142120e32ffe9132b22cf9bba9301481204f23ab22a3759067f",
});

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const CLI = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const MIGRATION_QUERY = `select version::text from supabase_migrations.schema_migrations
 where version::text in ('20261106150000','20261106160000','20261106180000') order by version`;
const FLAG_QUERY = `select flag from public.feature_flags where tenant_id='${TENANT}'::uuid
 and flag in ('new_dawn.m2_commusoft_coexistence','new_dawn.exact_job_detail',
 'new_dawn.m5_opportunities_probe','learn.inputs.commusoft.users.enabled') order by flag`;
const QUEUE_QUERY = `select exists(select 1 from public.platform_jobs where tenant_id='${TENANT}'::uuid
 and job_type='commusoft.source_sync' and status in ('queued','running','retrying') limit 1) as active_import`;
const LEASE_QUERY = `select
 (select count(*)=5 from information_schema.columns where table_schema='public'
  and table_name='learn_business_input_request_gates' and column_name in
  ('lease_owner_kind','lease_owner_id','lease_expires_at','manual_waiter_id','manual_waiter_expires_at')) as columns_present,
 to_regprocedure('public.learn_commusoft_shared_lease_acquire(text,text,text)') is not null as acquire_present,
 to_regprocedure('public.learn_commusoft_yield_job(uuid,uuid,text,integer,timestamptz)') is not null as yield_present,
 to_regprocedure('public.new_dawn_commusoft_coexistence_enabled(uuid)') is not null as switch_present`;

function namedEndpoints(rows) {
  if (!Array.isArray(rows)) throw Error("runtime_inventory_invalid");
  return ENDPOINTS.map(pin => {
    const matches = rows.filter(row => row?.slug === pin.name);
    if (matches.length !== 1) throw Error("runtime_endpoint_missing_or_duplicate:" + pin.name);
    const row = matches[0];
    return { name: row.slug, id: row.id, version: row.version,
      hash: row.ezbr_sha256, jwt: row.verify_jwt, status: row.status,
      updatedAt: row.updated_at };
  });
}

export function assessM2Preflight({ project, functions, migrations, flags, queue }) {
  if (project?.id !== PROJECT || project?.status !== "ACTIVE_HEALTHY")
    throw Error("production_project_unconfirmed");
  const endpoints = namedEndpoints(functions);
  for (let i = 0; i < ENDPOINTS.length; i++) {
    const actual = endpoints[i], pin = ENDPOINTS[i];
    if (Object.keys(pin).some(key => actual[key] !== pin[key]) || actual.status !== "ACTIVE")
      throw Error("runtime_version_or_hash_drift:" + pin.name);
  }
  if (!Array.isArray(migrations) || migrations.some(row => !MIGRATIONS.includes(String(row?.version))) ||
    migrations.length !== 0) throw Error("m2_sql_already_installed_or_unknown");
  if (!Array.isArray(flags) || flags.some(row => !FLAGS.includes(row?.flag)) || flags.length !== 0)
    throw Error("m2_flag_already_present_or_unknown");
  if (!Array.isArray(queue) || queue.length !== 1 || typeof queue[0]?.active_import !== "boolean")
    throw Error("source_queue_unconfirmed");
  return { endpoints, activeImport: queue[0].active_import,
    migrationsPresent: [], flagsPresent: [] };
}

export function assessM2Postrelease({ project, functions, migrations, flags, queue, lease }) {
  if (project?.id !== PROJECT || project?.status !== "ACTIVE_HEALTHY")
    throw Error("production_project_unconfirmed");
  const endpoints = namedEndpoints(functions);
  for (let i = 0; i < ENDPOINTS.length; i++) {
    const actual = endpoints[i], pin = ENDPOINTS[i];
    if (actual.id !== pin.id || actual.version <= pin.version || actual.hash === pin.hash ||
      !/^[a-f\d]{64}$/.test(actual.hash ?? "") || actual.jwt !== pin.jwt || actual.status !== "ACTIVE")
      throw Error("runtime_postrelease_unconfirmed:" + pin.name);
  }
  if (!Array.isArray(migrations) || migrations.length !== MIGRATIONS.length ||
    migrations.some((row, i) => String(row?.version) !== MIGRATIONS[i]))
    throw Error("m2_sql_postrelease_unconfirmed");
  if (!Array.isArray(flags) || flags.length !== 0) throw Error("m2_flags_not_absent");
  if (!Array.isArray(queue) || queue.length !== 1 || typeof queue[0]?.active_import !== "boolean")
    throw Error("source_queue_unconfirmed");
  if (!Array.isArray(lease) || lease.length !== 1 ||
    ["columns_present", "acquire_present", "yield_present", "switch_present"]
      .some(key => lease[0]?.[key] !== true)) throw Error("lease_schema_unconfirmed");
  return { state: "installed_default_off_readback", endpoints,
    migrations: MIGRATIONS, activeImport: queue[0].active_import,
    flagsPresent: [], providerRequests: 0 };
}

export function assessM2WorkerFirst({ project, functions, migrations, flags, queue, health },
  now = Date.now(), expectedMigrations = []) {
  if (project?.id !== PROJECT || project?.status !== "ACTIVE_HEALTHY")
    throw Error("production_project_unconfirmed");
  const endpoints = namedEndpoints(functions), worker = endpoints[0], pin = ENDPOINTS[0];
  if (worker.id !== pin.id || worker.version <= pin.version || worker.hash === pin.hash ||
    !/^[a-f\d]{64}$/.test(worker.hash ?? "") || worker.jwt !== true || worker.status !== "ACTIVE" ||
    !Number.isSafeInteger(worker.updatedAt) || worker.updatedAt <= 0 || worker.updatedAt > now)
    throw Error("worker_first_runtime_unconfirmed");
  for (let i = 1; i < ENDPOINTS.length; i++) {
    const actual = endpoints[i], old = ENDPOINTS[i];
    if (Object.keys(old).some(key => actual[key] !== old[key]) || actual.status !== "ACTIVE")
      throw Error("manual_route_changed_before_sql:" + old.name);
  }
  if (!Array.isArray(migrations) || migrations.length !== expectedMigrations.length ||
    migrations.some((row, i) => String(row?.version) !== expectedMigrations[i]) ||
    !Array.isArray(flags) || flags.length !== 0)
    throw Error("m2_sql_or_flag_changed_before_worker_gate");
  if (!Array.isArray(queue) || queue.length !== 1 || typeof queue[0]?.active_import !== "boolean")
    throw Error("source_queue_unconfirmed");
  const row = health?.[0];
  if (!Array.isArray(health) || health.length !== 1 ||
    ["pre_activation_running", "recent_retrying", "recent_dead_letter", "completed_since"]
      .some(key => !Number.isSafeInteger(Number(row?.[key])) || Number(row[key]) < 0))
    throw Error("source_health_unconfirmed");
  const elapsedMs = now - worker.updatedAt;
  return { state: elapsedMs >= 180000 && Number(row.pre_activation_running) === 0 &&
      Number(row.recent_retrying) === 0 && Number(row.recent_dead_letter) === 0 &&
      Number(row.completed_since) > 0
      ? "worker_first_sql_ready" : "worker_first_wait_or_inspect",
    updatedAt: new Date(worker.updatedAt).toISOString(), elapsedMs,
    sourceHealth: { preActivationRunning: Number(row.pre_activation_running),
      recentRetrying: Number(row.recent_retrying), recentDeadLetter: Number(row.recent_dead_letter),
      completedSince: Number(row.completed_since) },
    activeImport: queue[0].active_import, migrationsPresent: expectedMigrations, flagsPresent: [],
    providerRequests: 0 };
}

async function json(url, token, query) {
  const response = await fetch(url, { method: query ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(query ? { "Content-Type": "application/json" } : {}) },
    ...(query ? { body: JSON.stringify({ query }) } : {}),
    redirect: "error", signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw Error(`management_read_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 2 * 1024 * 1024) throw Error("management_read_oversized");
  return JSON.parse(bytes.toString("utf8"));
}

function sourceFiles(dir, root) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const file = join(dir, name), st = lstatSync(file);
    if (st.isSymbolicLink()) throw Error("downloaded_source_symlink");
    if (st.isDirectory()) out.push(...sourceFiles(file, root));
    else if (st.isFile()) {
      if (st.size > 5 * 1024 * 1024) throw Error("downloaded_source_file_oversized");
      chmodSync(file, 0o600);
      out.push({ path: relative(root, file), bytes: st.size, sha256: sha(readFileSync(file)) });
    } else throw Error("downloaded_source_nonfile");
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function verifyEntrypoint(path) {
  const source = readFileSync(path, "utf8");
  if (source.length < 50 || source.length > 1024 * 1024 || !source.includes("Deno.serve"))
    throw Error("downloaded_entrypoint_unverified");
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (parsed.parseDiagnostics.length) throw Error("downloaded_entrypoint_parse_failed");
}

function normalizedSourcePath(endpoint, sourcePath) {
  const prefix = `supabase/functions/${endpoint.name}/`;
  if (sourcePath === prefix + "index.ts") return `${endpoint.name}/index.ts`;
  const marker = "/_shared/";
  const at = sourcePath.indexOf(marker);
  if (at >= 0 && sourcePath.startsWith(prefix) && sourcePath.endsWith(".ts")) {
    const suffix = sourcePath.slice(at + marker.length);
    if (!/^[a-zA-Z0-9_./-]+$/.test(suffix) || suffix.split("/").includes(".."))
      throw Error("downloaded_source_path_unsafe");
    return `_shared/${suffix}`;
  }
  return null;
}

/** The CLI download nests shared imports; make an isolated, import-complete stage. */
export function normalizeRollbackSource(downloadRoot, target, endpoint, files) {
  const stage = join(target, "rollback-stage", "supabase", "functions");
  mkdirSync(stage, { recursive: true, mode: 0o700 });
  const mapped = new Map();
  for (const file of files) {
    const path = normalizedSourcePath(endpoint, file.path);
    if (!path) {
      if (file.path === "supabase/.temp/cli-latest") continue;
      throw Error("downloaded_source_path_unexpected:" + file.path);
    }
    if (mapped.has(path)) throw Error("downloaded_source_path_duplicate:" + path);
    const from = join(downloadRoot, file.path), to = join(stage, path);
    mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
    copyFileSync(from, to);
    chmodSync(to, 0o600);
    mapped.set(path, readFileSync(to, "utf8"));
  }
  if (!mapped.has(`${endpoint.name}/index.ts`)) throw Error("downloaded_entrypoint_missing");
  const visited = new Set();
  function visit(path) {
    if (visited.has(path)) return;
    const source = mapped.get(path);
    if (source === undefined) throw Error("downloaded_import_missing:" + path);
    visited.add(path);
    const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if (parsed.parseDiagnostics.length) throw Error("downloaded_import_parse_failed:" + path);
    function dependency(node) {
      if (!ts.isStringLiteral(node)) throw Error("downloaded_dynamic_import_unverified:" + path);
      const spec = node.text;
      if (spec.startsWith(".")) {
        const next = posix.normalize(posix.join(posix.dirname(path), spec));
        if (next.startsWith("../") || next.startsWith("/")) throw Error("downloaded_import_escaped:" + path);
        visit(next);
      } else if (!/^(https:\/\/|npm:|jsr:|node:)/.test(spec))
        throw Error("downloaded_external_import_unverified:" + path);
    }
    function walk(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
        dependency(node.moduleSpecifier);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
        dependency(node.arguments[0]);
      ts.forEachChild(node, walk);
    }
    walk(parsed);
  }
  visit(`${endpoint.name}/index.ts`);
  if (visited.size !== mapped.size) throw Error("downloaded_source_unreferenced_files");
  const manifest = [...mapped].sort(([a], [b]) => a.localeCompare(b))
    .map(([path, source]) => ({ path, bytes: Buffer.byteLength(source), sha256: sha(source) }));
  return { directory: relative(target, join(target, "rollback-stage")), files: manifest,
    closureSha256: sha(JSON.stringify(manifest)) };
}

export async function captureM2Preflight(out, { token = savedCliToken(), cli = CLI } = {}) {
  const root = resolve(".verification-results"), target = resolve(out);
  if (!target.startsWith(root + "/") || existsSync(target))
    throw Error("fresh_private_output_required");
  const base = `https://api.supabase.com/v1/projects/${PROJECT}`;
  const snapshot = async () => assessM2Preflight({
    project: await json(base, token),
    functions: await json(base + "/functions", token),
    migrations: await json(base + "/database/query/read-only", token, MIGRATION_QUERY),
    flags: await json(base + "/database/query/read-only", token, FLAG_QUERY),
    queue: await json(base + "/database/query/read-only", token, QUEUE_QUERY),
  });
  const before = await snapshot();
  const candidate = edgeRuntimeBundle(ENDPOINTS.map(e => ({ name: e.name, verifyJwt: e.jwt })));
  if (candidate.sha256 !== CANDIDATE_SOURCE_SHA256) throw Error("candidate_source_changed");
  const sqlSources = MIGRATIONS.map(version => {
    const matches = readdirSync("supabase/migrations").filter(name => name.startsWith(version + "_"));
    if (matches.length !== 1) throw Error("migration_version_collision:" + version);
    const path = join("supabase/migrations", matches[0]);
    const sourceSha256 = sha(readFileSync(path));
    if (sourceSha256 !== MIGRATION_SOURCE_SHA256[version])
      throw Error("migration_source_changed:" + version);
    return { version, path, sha256: sourceSha256 };
  });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(target, { recursive: false, mode: 0o700 });
  const report = { version: "new-dawn-m2-live-preflight/1", project: PROJECT,
    observedAt: new Date().toISOString(), state: "capturing_source", before,
    candidate: { sourceClosureSha256: candidate.sha256, files: candidate.files.length, sqlSources },
    rollbackSources: [], productionChanged: false, providerRequests: 0,
    limitations: ["Downloaded source plus stable metadata is not an exact prior executable bundle.",
      "No deployment, SQL installation, feature change, endpoint invocation or provider read occurs."] };
  const save = () => writeFileSync(join(target, "manifest.private.json"), JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 });
  save();
  try {
    for (const endpoint of before.endpoints) {
      const workdir = join(target, endpoint.name);
      mkdirSync(workdir, { mode: 0o700 });
      const downloaded = spawnSync(cli, ["functions", "download", endpoint.name,
        "--project-ref", PROJECT, "--workdir", workdir], {
        env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
        encoding: "utf8", timeout: 90000, maxBuffer: 1024 * 1024,
      });
      if (downloaded.status !== 0) throw Error("runtime_source_download_unconfirmed:" + endpoint.name);
      const entry = join(workdir, "supabase/functions", endpoint.name, "index.ts");
      if (!existsSync(entry)) throw Error("runtime_entrypoint_missing:" + endpoint.name);
      verifyEntrypoint(entry);
      const files = sourceFiles(workdir, workdir);
      if (!files.length || files.reduce((n, file) => n + file.bytes, 0) > 10 * 1024 * 1024)
        throw Error("runtime_source_closure_unverified:" + endpoint.name);
      const normalized = normalizeRollbackSource(workdir, join(target, endpoint.name), endpoint, files);
      report.rollbackSources.push({ ...endpoint, downloadedDirectory: relative(target, workdir),
        ...normalized, directory: `${endpoint.name}/${normalized.directory}` });
      save();
    }
    const after = await snapshot();
    if (JSON.stringify(after) !== JSON.stringify(before)) throw Error("live_metadata_changed_during_capture");
    report.after = after;
    report.state = "read_only_preflight_and_rollback_sources_verified";
    report.completedAt = new Date().toISOString();
    save();
    return { state: report.state, manifest: join(target, "manifest.private.json"),
      activeImport: before.activeImport, rollbackVersions: report.rollbackSources.map(e => `${e.name}:v${e.version}`),
      candidateSourceClosureSha256: candidate.sha256, productionChanged: false, providerRequests: 0 };
  } catch (error) {
    report.state = "source_or_metadata_unverified";
    report.failureCode = error instanceof Error ? error.message : "unknown";
    save();
    throw Error(report.failureCode);
  }
}

export async function readM2Postrelease({ token = savedCliToken() } = {}) {
  const base = `https://api.supabase.com/v1/projects/${PROJECT}`;
  return assessM2Postrelease({
    project: await json(base, token),
    functions: await json(base + "/functions", token),
    migrations: await json(base + "/database/query/read-only", token, MIGRATION_QUERY),
    flags: await json(base + "/database/query/read-only", token, FLAG_QUERY),
    queue: await json(base + "/database/query/read-only", token, QUEUE_QUERY),
    lease: await json(base + "/database/query/read-only", token, LEASE_QUERY),
  });
}

export async function readM2WorkerFirst({ token = savedCliToken() } = {}) {
  const base = `https://api.supabase.com/v1/projects/${PROJECT}`;
  const project = await json(base, token), functions = await json(base + "/functions", token);
  const worker = namedEndpoints(functions)[0];
  if (!Number.isSafeInteger(worker.updatedAt) || worker.updatedAt <= 0)
    throw Error("worker_activation_time_unconfirmed");
  const activation = new Date(worker.updatedAt).toISOString();
  const healthQuery = `select
 count(*) filter(where status='running' and claimed_at<'${activation}'::timestamptz) as pre_activation_running,
 count(*) filter(where status='retrying' and last_attempt_at>='${activation}'::timestamptz) as recent_retrying,
 count(*) filter(where status='dead_letter' and last_attempt_at>='${activation}'::timestamptz) as recent_dead_letter,
 count(*) filter(where status='succeeded' and completed_at>='${activation}'::timestamptz) as completed_since
 from public.platform_jobs where tenant_id='${TENANT}'::uuid and job_type='commusoft.source_sync'`;
  return assessM2WorkerFirst({ project, functions,
    migrations: await json(base + "/database/query/read-only", token, MIGRATION_QUERY),
    flags: await json(base + "/database/query/read-only", token, FLAG_QUERY),
    queue: await json(base + "/database/query/read-only", token, QUEUE_QUERY),
    health: await json(base + "/database/query/read-only", token, healthQuery) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.NEW_DAWN_M2_ALLOW_PROJECT !== PROJECT)
      throw Error("explicit_live_read_only_scope_required");
    if (process.argv.length === 5 && process.argv[2] === "--live-read-only" &&
      process.argv[3] === "--out")
      console.log(JSON.stringify(await captureM2Preflight(process.argv[4])));
    else if (process.argv.length === 3 && process.argv[2] === "--post-release-read-only")
      console.log(JSON.stringify(await readM2Postrelease()));
    else if (process.argv.length === 3 && process.argv[2] === "--worker-first-read-only") {
      const result = await readM2WorkerFirst();
      console.log(JSON.stringify(result));
      if (result.state !== "worker_first_sql_ready") process.exitCode = 2;
    }
    else throw Error("explicit_live_read_only_scope_required");
  } catch (error) {
    console.error(JSON.stringify({ state: "preflight_unverified",
      code: error instanceof Error ? error.message : "unknown", productionChanged: false }));
    process.exitCode = 1;
  }
}
