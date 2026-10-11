/** Install the recovered operator endpoint in TEST. No grants, secrets or schedules. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { deployPinnedTestRuntime, EMAIL_RUNTIME_DATABASE } from "./learn-test-email-runtime-deploy.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";

export const CONTROLPLANE_ENDPOINTS = [{ name: "openfolk-control-plane", verifyJwt: false }];
// Current reviewed source candidate. The original hosted v1 checksum is retained
// in learn-controlplane-hosted-2026-10-10.json; this first-install runner still
// refuses replacing that installed endpoint. A replacement needs its own release.
export const CONTROLPLANE_SHA = "55530404e70a3eaf74a12587155d02ebf93f7fce05b3c3ee31283b38db8b3304";
export const controlPlaneBundle = () => edgeRuntimeBundle(CONTROLPLANE_ENDPOINTS);
export function deployControlPlane(args) {
  if (Object.keys(args.replaceVersions ?? {}).length) throw Error("First installation only; review replacements separately");
  return deployPinnedTestRuntime(args, {
    bundle: controlPlaneBundle, endpoints: CONTROLPLANE_ENDPOINTS,
    bundleSha: CONTROLPLANE_SHA, databaseFingerprint: EMAIL_RUNTIME_DATABASE,
    version: "learn-controlplane-deploy/1", stagePrefix: "learn-controlplane-",
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).join(" ") !== "--deploy --existing-cli-login" ||
      process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT) throw Error("Explicit TEST installation required");
    const prefix = ".verification-results/controlplane-edge-deploy";
    const result = await deployControlPlane({ allowProjectRef: TEST_PROJECT, token: savedCliToken(),
      persistJournal: async journal => {
        const fd = openSync(prefix + "-journal.json", "wx", 0o600);
        try { writeSync(fd, JSON.stringify(journal, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
      }, onProgress: p => console.log(JSON.stringify(p)),
    });
    writeFileSync(prefix + "-result.json", JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify(result, null, 2));
    if (result.state !== "deployed_needs_http_acceptance") process.exitCode = 1;
  } catch {
    console.error("Control-plane installation unconfirmed; inspect retained journal and TEST inventory before any further attempt.");
    process.exitCode = 1;
  }
}
