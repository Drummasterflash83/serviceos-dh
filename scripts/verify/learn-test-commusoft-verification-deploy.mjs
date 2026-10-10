/** Deploy only the pinned Commusoft verification endpoint to the verified TEST project. */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, posix } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readConnectionSetupCatalog } from "./learn-commusoft-setup-catalog.mjs";
import { installedConnectionSetup } from "./learn-test-commusoft-setup-release.mjs";
import { connectionFingerprint } from "./learn-test-commusoft-setup-release.mjs";
import { catalogFingerprint } from "./learn-test-launch-rehearsal.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
export const VERIFICATION_ENDPOINT_FILES = [
  "learn-commusoft-verify/index.ts",
  "_shared/commusoft/verification_http.ts",
  "_shared/commusoft/verification_contract.ts",
  "_shared/commusoft/verify_connection.ts",
  "_shared/commusoft/read_page.ts",
];
export const VERIFICATION_ENDPOINT_SHA =
  "a889d50abce56116c26ecc9a8ca54198bdfde3accdd1964a1cd3a98816dd1a60";
export function verificationEndpointBundle() {
  const files = VERIFICATION_ENDPOINT_FILES.map((path) => ({
    path,
    source: readFileSync(new URL("../../supabase/functions/" + path, import.meta.url), "utf8"),
  }));
  for (const f of files)
    for (const m of f.source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const path = posix.normalize(posix.join(posix.dirname(f.path), m[1]));
      if (!VERIFICATION_ENDPOINT_FILES.includes(path))
        throw Error("Verification dependency omitted: " + path);
    }
  const sha256 = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  if (sha256 !== VERIFICATION_ENDPOINT_SHA) throw Error("Reviewed verification bundle differs");
  return { files, sha256 };
}
export function withoutVerificationEndpoint(c) {
  const prior = structuredClone(c);
  prior.base.functions = prior.base.functions.filter((f) => f.slug !== "learn-commusoft-verify");
  prior.readinessCatalogSha256 = catalogFingerprint(prior.base);
  return prior;
}
export async function deployVerification({
  allowProjectRef,
  token,
  fetcher = fetch,
  runCli = spawnSync,
  beforeDeploy = async () => {},
}) {
  if (allowProjectRef !== TEST_PROJECT) throw Error("Explicit TEST verification target required");
  const bundle = verificationEndpointBundle(),
    args = { allowProjectRef, token, fetcher },
    before = await readConnectionSetupCatalog(args);
  if (
    !installedConnectionSetup(before) ||
    before.base.functions.some((f) => f.slug === "learn-commusoft-verify")
  )
    throw Error("Exact TEST connection schema and absent verification endpoint required");
  await beforeDeploy(before);
  const stage = mkdtempSync(join(tmpdir(), "learn-commusoft-verify-"));
  let status = null;
  try {
    for (const f of bundle.files) {
      mkdirSync(dirname(join(stage, "supabase/functions", f.path)), { recursive: true });
      writeFileSync(join(stage, "supabase/functions", f.path), f.source);
    }
    writeFileSync(
      join(stage, "supabase/config.toml"),
      `project_id = "${TEST_PROJECT}"\n[functions.learn-commusoft-verify]\nverify_jwt = true\n`,
    );
    const result = runCli(
      "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase",
      [
        "functions",
        "deploy",
        "learn-commusoft-verify",
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
    after = await readConnectionSetupCatalog(args);
  } catch {}
  return inspectVerificationDeployment({ before, after, status });
}
export function inspectVerificationDeployment({ before, after, status }) {
  const bundle = verificationEndpointBundle();
  const endpoints = after?.base.functions.filter((f) => f.slug === "learn-commusoft-verify") ?? [],
    endpoint = endpoints[0];
  const prior = after ? withoutVerificationEndpoint(after) : null;
  const preserved =
    !!prior &&
    installedConnectionSetup(prior) &&
    connectionFingerprint(prior) === connectionFingerprint(before);
  const verified =
    status === 0 &&
    endpoints.length === 1 &&
    endpoint.status === "ACTIVE" &&
    endpoint.version === 1 &&
    endpoint.verify_jwt === true &&
    preserved;
  return {
    version: "learn-test-commusoft-verification-deploy/1",
    projectRef: TEST_PROJECT,
    observedAt: new Date().toISOString(),
    state: verified ? "deployed_needs_http_acceptance" : "requires_inspection",
    writeAttempted: true,
    cliExitStatus: status,
    sourceBundleSha256: bundle.sha256,
    files: VERIFICATION_ENDPOINT_FILES,
    priorSchemaAndEndpointsPreserved: preserved,
    endpoint: endpoint ?? null,
    limitations: [
      "Only learn-commusoft-verify was submitted; no prune, secret change, schedule, approval, provider operation or production change.",
      "A deployment response is not runtime acceptance; uncertain results are inspected without automatic resubmission.",
    ],
  };
}
