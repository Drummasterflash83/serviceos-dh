/** Manually invoked only after approval of the exact runtime-source review.
 * No schedule; no source-provider, database or application writes. */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabaseS3 } from "./recording-backup-s3.mjs";
import { loadDatabaseCredential } from "./serviceos-database-backup-access.mjs";
import { copyReviewedLiveRuntimeSource } from "./copy-reviewed-live-runtime-source.mjs";

const privatePath = (name) => fileURLToPath(new URL(`../../.verification-results/${name}`, import.meta.url));

async function port(role) {
  const credential = await loadDatabaseCredential(role);
  return createDatabaseS3({
    credentials: async () => ({
      accessKeyId: credential.accessKeyId,
      secretAccessKey: credential.secretAccessKey,
    }),
    expectedPrincipalArn: credential.principalArn,
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
}

async function main() {
  if (process.argv.slice(2).join(" ") !== "--copy-approved-exact-package") {
    throw Error("runtime_exact_copy_requires_separate_approval");
  }
  const attempt = randomUUID();
  let writer, restore;
  try {
    writer = await port("Writer");
    restore = await port("Restore");
    const result = await copyReviewedLiveRuntimeSource({
      sourcePath: privatePath("build01-live-edge-source-2026-10-16-0630.age"),
      downloadPath: privatePath(`build01-live-edge-source-restore-${attempt}.age`),
      writer, restore,
    });
    const receipt = {
      ...result,
      attempt,
      source: "reviewed LIVE Edge source package; 102 functions and 721 files",
      escrowDecryptionVerified: false,
    };
    await writeFile(privatePath(`build01-live-edge-source-offsite-${attempt}.json`),
      JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ state: result.state, attempt, bytes: result.bytes,
      sha256: result.sha256, objectKey: result.object.key,
      independentRestoreDownloadVerified: true, applicationRecoveryVerified: false }));
  } finally {
    writer?.close();
    restore?.close();
  }
}

main().catch((error) => {
  const code = typeof error?.code === "string" && /^[a-z0-9_]+$/.test(error.code)
    ? error.code : "runtime_offsite_copy_unverified";
  console.error(JSON.stringify({ state: "runtime_offsite_copy_unverified", code }));
  process.exitCode = 1;
});
