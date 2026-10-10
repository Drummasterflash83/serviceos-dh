/** Deploy only the pinned Commusoft worker to the verified TEST project. */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, posix } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { readCommusoftCatalog } from "./learn-commusoft-catalog.mjs";
import { installedCommusoftWithTrigger } from "./learn-test-commusoft-runtime.mjs";
import { commusoftFingerprint } from "./learn-test-commusoft-release.mjs";
import { catalogFingerprint } from "./learn-test-launch-rehearsal.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
export const COMMUSOFT_ENDPOINT_FILES = [
  "learn-commusoft-worker/index.ts",
  "_shared/commusoft/worker.ts",
  "_shared/commusoft/read_page.ts",
  "_shared/commusoft/bound_page.ts",
  "_shared/commusoft/stored_scope.ts",
  "_shared/commusoft/permit_server.ts",
  "_shared/commusoft/page_store.ts",
  "_shared/slack/slack_worker_http.ts",
];
export const COMMUSOFT_ENDPOINT_SHA =
  "e614d5008825d4c562dbf5572a7b5ec1ae51ba940a5c4a470298351976c6043e";
export function commusoftEndpointBundle() {
  const files = COMMUSOFT_ENDPOINT_FILES.map((path) => ({
    path,
    source: readFileSync(new URL("../../supabase/functions/" + path, import.meta.url), "utf8"),
  }));
  for (const f of files)
    for (const m of f.source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const path = posix.normalize(posix.join(posix.dirname(f.path), m[1]));
      if (!COMMUSOFT_ENDPOINT_FILES.includes(path))
        throw Error("Worker dependency omitted: " + path);
    }
  const sha256 = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  if (sha256 !== COMMUSOFT_ENDPOINT_SHA) throw Error("Reviewed Commusoft worker bundle differs");
  return { files, sha256 };
}
export function withoutCommusoftEndpoint(c) {
  const prior = structuredClone(c);
  prior.base.functions = prior.base.functions.filter((f) => f.slug !== "learn-commusoft-worker");
  prior.readinessCatalogSha256 = catalogFingerprint(prior.base);
  return prior;
}
export async function deployCommusoft({
  allowProjectRef,
  token,
  fetcher = fetch,
  runCli = spawnSync,
}) {
  const bundle = commusoftEndpointBundle(),
    args = { allowProjectRef, token, fetcher },
    before = await readCommusoftCatalog(args);
  if (
    !installedCommusoftWithTrigger(before) ||
    before.base.functions.some((f) => f.slug === "learn-commusoft-worker")
  )
    throw Error("Exact TEST schema/trigger refresh and absent worker required");
  const stage = mkdtempSync(join(tmpdir(), "learn-commusoft-worker-"));
  let status = null;
  try {
    for (const f of bundle.files) {
      mkdirSync(dirname(join(stage, "supabase/functions", f.path)), { recursive: true });
      writeFileSync(join(stage, "supabase/functions", f.path), f.source);
    }
    writeFileSync(
      join(stage, "supabase/config.toml"),
      `project_id = "${TEST_PROJECT}"\n[functions.learn-commusoft-worker]\nverify_jwt = true\n`,
    );
    const result = runCli(
      "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase",
      [
        "functions",
        "deploy",
        "learn-commusoft-worker",
        "--project-ref",
        TEST_PROJECT,
        "--use-api",
        "--workdir",
        stage,
      ],
      {
        env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 2097152,
      },
    );
    status = result.status;
  } catch {
    /* Inspect even if the deployment acknowledgement was lost. */
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  let after = null;
  try {
    after = await readCommusoftCatalog(args);
  } catch {}
  const endpoints = after?.base.functions.filter((f) => f.slug === "learn-commusoft-worker") ?? [],
    endpoint = endpoints[0];
  const prior = after ? withoutCommusoftEndpoint(after) : null;
  const preserved =
    !!prior &&
    installedCommusoftWithTrigger(prior) &&
    commusoftFingerprint(prior) === commusoftFingerprint(before);
  const verified =
    status === 0 &&
    endpoints.length === 1 &&
    endpoint.status === "ACTIVE" &&
    endpoint.version === 1 &&
    endpoint.verify_jwt === true &&
    preserved;
  return {
    version: "learn-test-commusoft-deploy/1",
    projectRef: TEST_PROJECT,
    observedAt: new Date().toISOString(),
    state: verified ? "deployed_needs_http_acceptance" : "requires_inspection",
    writeAttempted: true,
    cliExitStatus: status,
    sourceBundleSha256: bundle.sha256,
    files: COMMUSOFT_ENDPOINT_FILES,
    priorSchemaAndEndpointsPreserved: preserved,
    endpoint: endpoint ?? null,
    limitations: [
      "Only learn-commusoft-worker was submitted; no prune, secret change, schedule, approval, provider operation or production change.",
      "A deployment response is not runtime acceptance; uncertain results are inspected without automatic resubmission.",
    ],
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (
      process.argv.slice(2).join(" ") !== "--deploy --existing-cli-login" ||
      process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
    )
      throw Error("Explicit TEST worker deployment required");
    const r = await deployCommusoft({ allowProjectRef: TEST_PROJECT, token: savedCliToken() });
    console.log(JSON.stringify(r, null, 2));
    if (r.state !== "deployed_needs_http_acceptance") process.exitCode = 1;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
