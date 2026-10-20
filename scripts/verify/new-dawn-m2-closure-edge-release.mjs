/** Exact Edge-only release for the reviewed v5-compatible job-detail route. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import ts from "typescript";
import { savedCliToken } from "./learn-test-readiness.mjs";
import { PROJECT } from "./new-dawn-m2-live-preflight.mjs";
import { assessStage as assessOptionalStage, readStage,
  reviewedSource as reviewedOptionalSource } from
  "./new-dawn-m2-optional-facts-release.mjs";
import { reviewedEdgeBundle } from "./new-dawn-m2-closure-edge-prepare.mjs";
import { REVIEWED_EDGE_EZBR_SHA256, edgePin as reviewedClosureEdgePin,
  assessStage as assessClosureStage, readStage as readClosureStage } from
  "./new-dawn-m2-closure-release.mjs";

const ENDPOINT = "learn-commusoft-job-detail";
const EDGE_ID = "009b9fb6-8e3c-49b8-8a3e-95531ba370bd";
const PRIOR_SOURCE_SHA256 = "e913eb7ad77d6464ee36c74ae7868e5988d5e3ed2170982d581f84da8593b0dc";
const ESZIP_SHA256 = "248a4d308a6663e3107c66c49578a9355d7373ee5e4ac541fdd066da5de1d640";
const EZBR_BYTES = 123899;
const ESZIP_BYTES = 520266;
const CLI = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const sourcePaths = ["_shared/commusoft/exact_job_detail.ts",
  "_shared/commusoft/retry_after.ts", "learn-commusoft-job-detail/index.ts"];
const baseline = Object.freeze({ id: EDGE_ID, slug: ENDPOINT, version: 5,
  status: "ACTIVE", verify_jwt: false,
  ezbr_sha256: "eafe6d4310c3e6588c7e89f630890d5b14be2e18b6651062ba6d3d6549957bfa" });
const candidate = Object.freeze({ ...baseline, version: 6,
  ezbr_sha256: REVIEWED_EDGE_EZBR_SHA256 });

export function reviewedArtifact(path) {
  const root = resolve(".verification-results") + "/";
  const full = resolve(path);
  if (!full.startsWith(root) || !full.endsWith("/artifacts/learn-commusoft-job-detail.ezbr"))
    throw Error("private_exact_artifact_path_required");
  const bytes = readFileSync(full);
  if (bytes.length !== EZBR_BYTES || bytes.subarray(0, 4).toString() !== "EZBR" ||
    sha(bytes) !== REVIEWED_EDGE_EZBR_SHA256)
    throw Error("reviewed_ezbr_artifact_changed");
  const eszip = brotliDecompressSync(bytes.subarray(4), { maxOutputLength: ESZIP_BYTES });
  if (eszip.length !== ESZIP_BYTES || sha(eszip) !== ESZIP_SHA256)
    throw Error("reviewed_eszip_artifact_changed");
  reviewedEdgeBundle();
  return { bytes, ezbrSha256: REVIEWED_EDGE_EZBR_SHA256,
    ezbrBytes: EZBR_BYTES, eszipSha256: ESZIP_SHA256 };
}

export function transportRequest() {
  const params = new URLSearchParams({ verify_jwt: "false",
    entrypoint_path: `file:///work/supabase/functions/${ENDPOINT}/index.ts`,
    ezbr_sha256: REVIEWED_EDGE_EZBR_SHA256 });
  return {
    method: "PATCH",
    url: `https://api.supabase.com/v1/projects/${PROJECT}/functions/${ENDPOINT}?${params}`,
    contentType: "application/vnd.denoland.eszip",
  };
}

function exactEdge(snapshot, expected) {
  const matches = snapshot.functions?.filter(row => row?.slug === ENDPOINT);
  if (!Array.isArray(matches) || matches.length !== 1 ||
    Object.entries(expected).some(([key, value]) => matches[0][key] !== value))
    throw Error("exact_edge_runtime_changed");
}

export function assessBefore(snapshot) {
  assessOptionalStage(snapshot, true);
  exactEdge(snapshot, baseline);
  return { state: "exact_edge_v5_deploy_ready", project: PROJECT,
    currentVersion: 5, currentHash: baseline.ezbr_sha256,
    candidateHash: candidate.ezbr_sha256, activePermits: 0,
    broadFlagsEnabled: 0, providerRequests: 0 };
}

export function assessAfter(before, after) {
  if (after?.project?.id !== PROJECT || after.project.status !== "ACTIVE_HEALTHY")
    throw Error("production_project_unconfirmed");
  exactEdge(after, candidate);
  if (JSON.stringify(after.ledger) !== JSON.stringify(before.ledger) ||
    JSON.stringify(after.catalog) !== JSON.stringify(before.catalog))
    throw Error("edge_only_database_state_changed");
  const others = rows => rows.filter(row => row.slug !== ENDPOINT)
    .map(row => [row.id, row.slug, row.version, row.ezbr_sha256,
      row.status, row.verify_jwt]).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  if (JSON.stringify(others(after.functions)) !== JSON.stringify(others(before.functions)))
    throw Error("unrelated_edge_runtime_changed");
  if (after.catalog?.[0]?.active_permits !== 0 ||
    after.catalog?.[0]?.enabled_flags !== 0)
    throw Error("default_off_state_changed");
  return { state: "exact_edge_v6_metadata_readback", project: PROJECT,
    edgeVersion: 6, edgeSha256: REVIEWED_EDGE_EZBR_SHA256,
    databaseUnchanged: true, activePermits: 0, broadFlagsEnabled: 0,
    providerRequests: 0 };
}

export function downloadedClosure(root) {
  const folder = join(root, "supabase/functions", ENDPOINT);
  const entries = sourcePaths.map(path => ({
    path,
    source: readFileSync(join(folder, path.startsWith(ENDPOINT + "/")
      ? "index.ts" : "functions/" + path), "utf8"),
  }));
  return sha(JSON.stringify(entries));
}

// Supabase CLI exports the compiled ESZIP's TS as formatted JavaScript under
// work/supabase/functions/. Compare executable syntax, not formatting/types.
export function executableStructure(source) {
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    removeComments: true, verbatimModuleSyntax: false,
  } }).outputText;
  const file = ts.createSourceFile("module.js", js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function shape(node) {
    if (ts.isParenthesizedExpression(node)) return shape(node.expression);
    const children = [];
    ts.forEachChild(node, child => { children.push(shape(child)); });
    return [node.kind,
      ts.isIdentifier(node) || ts.isLiteralExpression(node) || ts.isTemplateLiteralToken(node)
        ? node.text : null,
      node.operator ?? null,
      ts.isVariableDeclarationList(node) ? node.flags & ts.NodeFlags.BlockScoped : null,
      children];
  }
  return JSON.stringify(shape(file));
}

export function verifyDownloadedCandidate(root) {
  const folder = join(root, "supabase/functions", ENDPOINT);
  const bundle = reviewedEdgeBundle();
  for (const file of bundle.files) {
    const downloaded = readFileSync(join(folder, file.path.startsWith(ENDPOINT + "/")
      ? "index.ts" : "work/supabase/functions/" + file.path), "utf8");
    if (executableStructure(downloaded) !== executableStructure(file.source))
      throw Error("downloaded_v6_executable_structure_changed:" + file.path);
  }
  return bundle.sha256;
}

export function verifyDownloadedClosure(root, expectedHash) {
  if (expectedHash === PRIOR_SOURCE_SHA256) {
    if (downloadedClosure(root) !== expectedHash)
      throw Error("downloaded_v5_source_closure_changed");
  } else if (expectedHash === reviewedEdgeBundle().sha256) {
    verifyDownloadedCandidate(root);
  } else throw Error("unreviewed_source_closure_requested");
  return expectedHash;
}

export function assessPost(snapshot) {
  if (snapshot?.project?.id !== PROJECT || snapshot.project.status !== "ACTIVE_HEALTHY")
    throw Error("production_project_unconfirmed");
  exactEdge(snapshot, candidate);
  const rows = snapshot.ledger;
  const quote = readFileSync(new URL(
    "../../supabase/migrations/20261107140000_new_dawn_commusoft_job_source_quote.sql",
    import.meta.url), "utf8");
  if (!Array.isArray(rows) || rows.length !== 2 ||
    String(rows[0]?.version) !== "20261107140000" ||
    rows[0]?.name !== "new_dawn_commusoft_job_source_quote" ||
    rows[0]?.statements?.length !== 1 || rows[0].statements[0] !== quote ||
    String(rows[1]?.version) !== "20261107150000" ||
    rows[1]?.name !== "new_dawn_commusoft_job_optional_source_facts" ||
    rows[1]?.statements?.length !== 1 ||
    rows[1].statements[0] !== reviewedOptionalSource().source)
    throw Error("v4_optional_ledger_changed");
  const catalog = snapshot.catalog?.[0];
  if (snapshot.catalog?.length !== 1 ||
    catalog?.function_sha256 !== "8eb34ddd828420ea84f695b5a893ff9f9e4d1786537f36921aa9408370026090" ||
    catalog?.permit_table !== true || catalog?.active_permits !== 0 ||
    catalog?.enabled_flags !== 0)
    throw Error("v4_optional_function_or_default_off_changed");
  return { state: "exact_edge_v6_metadata_readback", edgeVersion: 6,
    edgeSha256: REVIEWED_EDGE_EZBR_SHA256, optionalSqlVersion: "20261107150000",
    activePermits: 0, broadFlagsEnabled: 0, providerRequests: 0 };
}

async function download(project, token, root, runner = spawnSync) {
  if (project !== PROJECT) throw Error("exact_live_project_required");
  if (existsSync(root)) throw Error("fresh_private_download_required");
  mkdirSync(dirname(root), { recursive: true, mode: 0o700 });
  mkdirSync(root, { mode: 0o700 });
  const result = runner(CLI, ["functions", "download", ENDPOINT,
    "--project-ref", PROJECT, "--workdir", root], {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: "utf8",
    timeout: 90000, maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw Error("edge_source_download_unconfirmed");
  return root;
}

function privateRoot(out) {
  const base = resolve(".verification-results") + "/", full = resolve(out);
  if (!full.startsWith(base) || existsSync(full)) throw Error("fresh_private_output_required");
  return full;
}

export async function liveReadOnly({ artifactPath, out, token = savedCliToken(),
  read = readStage, downloader = download, artifactReader = reviewedArtifact,
  sourceVerifier = verifyDownloadedClosure } = {}) {
  artifactReader(artifactPath);
  const root = privateRoot(out);
  const before = await read(PROJECT, token);
  const stage = assessBefore(before);
  await downloader(PROJECT, token, join(root, "current"));
  sourceVerifier(join(root, "current"), PRIOR_SOURCE_SHA256);
  const stable = await read(PROJECT, token);
  assessBefore(stable);
  if (JSON.stringify(stable) !== JSON.stringify(before))
    throw Error("live_state_changed_during_source_readback");
  return { ...stage, currentSourceClosureSha256: PRIOR_SOURCE_SHA256,
    candidateSourceClosureSha256: reviewedEdgeBundle().sha256,
    request: transportRequest(), output: root, productionChanged: false };
}

export async function livePostReadOnly({ artifactPath, out, token = savedCliToken(),
  read = readStage, downloader = download, artifactReader = reviewedArtifact,
  sourceVerifier = verifyDownloadedClosure } = {}) {
  artifactReader(artifactPath);
  const root = privateRoot(out);
  const before = await read(PROJECT, token);
  const stage = assessPost(before);
  await downloader(PROJECT, token, join(root, "current"));
  sourceVerifier(join(root, "current"), reviewedEdgeBundle().sha256);
  const stable = await read(PROJECT, token);
  assessPost(stable);
  if (JSON.stringify(stable) !== JSON.stringify(before))
    throw Error("live_v6_state_changed_during_source_readback");
  return { ...stage, state: "exact_edge_v6_source_readback",
    sourceClosureSha256: reviewedEdgeBundle().sha256,
    output: root, productionChanged: false };
}

/** Independent source verification after the v5 closure SQL has replaced finish(). */
export async function livePostClosureReadOnly({ artifactPath, out, token = savedCliToken(),
  read = readClosureStage, downloader = download, artifactReader = reviewedArtifact,
  sourceVerifier = verifyDownloadedClosure } = {}) {
  artifactReader(artifactPath);
  const root = privateRoot(out);
  const pin = reviewedClosureEdgePin(6, REVIEWED_EDGE_EZBR_SHA256);
  const before = await read(PROJECT, token);
  const stage = assessClosureStage(before, true, pin);
  await downloader(PROJECT, token, join(root, "current"));
  sourceVerifier(join(root, "current"), reviewedEdgeBundle().sha256);
  const stable = await read(PROJECT, token);
  assessClosureStage(stable, true, pin);
  if (JSON.stringify(stable) !== JSON.stringify(before))
    throw Error("live_v6_closure_state_changed_during_source_readback");
  return { state: "exact_edge_v6_post_closure_source_readback",
    edgeVersion: stage.edgeVersion, edgeSha256: stage.edgeSha256,
    closureSqlVersion: stage.version, closureSqlSha256: stage.sourceSha256,
    activePermits: stage.activePermits, broadFlagsEnabled: stage.broadFlagsEnabled,
    sourceClosureSha256: reviewedEdgeBundle().sha256,
    output: root, productionChanged: false, providerRequests: 0 };
}

export async function deployLive({ artifactPath, out, token = savedCliToken(),
  read = readStage, downloader = download, patcher = fetch,
  artifactReader = reviewedArtifact, sourceVerifier = verifyDownloadedClosure } = {}) {
  const artifact = artifactReader(artifactPath);
  const root = privateRoot(out);
  const before = await read(PROJECT, token);
  assessBefore(before);
  await downloader(PROJECT, token, join(root, "before"));
  sourceVerifier(join(root, "before"), PRIOR_SOURCE_SHA256);
  const immediate = await read(PROJECT, token);
  assessBefore(immediate);
  if (JSON.stringify(immediate) !== JSON.stringify(before))
    throw Error("live_state_changed_before_edge_patch");
  const req = transportRequest();
  let acknowledged = false;
  try {
    const response = await patcher(req.url, {
      method: req.method, redirect: "error", signal: AbortSignal.timeout(90000),
      headers: { Authorization: `Bearer ${token}`,
        "Content-Type": req.contentType },
      body: artifact.bytes,
    });
    acknowledged = response.ok;
    await response.body?.cancel().catch(() => {});
  } catch { /* Never replay uncertain deployment. */ }
  let after;
  try { after = await read(PROJECT, token); }
  catch { throw Error("edge_deploy_outcome_unverified_no_replay"); }
  try { assessAfter(before, after); }
  catch { throw Error("edge_deploy_outcome_unverified_no_replay"); }
  try {
    await downloader(PROJECT, token, join(root, "after"));
    sourceVerifier(join(root, "after"), reviewedEdgeBundle().sha256);
  } catch { throw Error("edge_source_readback_unverified_no_replay"); }
  const stable = await read(PROJECT, token);
  try { assessAfter(before, stable); }
  catch { throw Error("edge_deploy_outcome_unverified_no_replay"); }
  return { state: "exact_edge_v6_source_readback", edgeVersion: 6,
    edgeSha256: REVIEWED_EDGE_EZBR_SHA256,
    sourceClosureSha256: reviewedEdgeBundle().sha256,
    acknowledged, databaseUnchanged: true, output: root,
    productionChanged: true, providerRequests: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, artifactArg, outArg] = process.argv.slice(2);
    if (process.argv.length !== 5 ||
      !artifactArg?.startsWith("--artifact=") || !outArg?.startsWith("--out="))
      throw Error("exact_artifact_and_private_output_required");
    const artifactPath = artifactArg.slice(11), out = outArg.slice(6);
    if (mode === "--dry-run") {
      reviewedArtifact(artifactPath);
      console.log(JSON.stringify({ state: "exact_edge_artifact_dry_run",
        request: transportRequest(), sourceClosureSha256: reviewedEdgeBundle().sha256,
        productionChanged: false, providerRequests: 0 }));
    } else {
      if (process.env.NEW_DAWN_M2_ALLOW_PROJECT !== PROJECT)
        throw Error("explicit_exact_live_project_required");
      if (mode === "--live-read-only")
        console.log(JSON.stringify(await liveReadOnly({ artifactPath, out })));
      else if (mode === "--live-v6-readback")
        console.log(JSON.stringify(await livePostReadOnly({ artifactPath, out })));
      else if (mode === "--live-v6-closure-readback")
        console.log(JSON.stringify(await livePostClosureReadOnly({ artifactPath, out })));
      else if (mode === "--live-deploy-exact" &&
        process.env.NEW_DAWN_M2_EDGE_DEPLOY_ALLOW_SHA === REVIEWED_EDGE_EZBR_SHA256)
        console.log(JSON.stringify(await deployLive({ artifactPath, out })));
      else throw Error("explicit_exact_edge_release_scope_required");
    }
  } catch (error) {
    console.error(JSON.stringify({ state: "edge_release_stopped",
      code: error instanceof Error ? error.message : "unknown", retryAllowed: false,
      providerRequests: 0 }));
    process.exitCode = 1;
  }
}
