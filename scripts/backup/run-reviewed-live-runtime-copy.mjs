/** Manually invoked only after approval of the exact runtime-source review.
 * No schedule; no source-provider, database or application writes. */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabaseS3 } from "./recording-backup-s3.mjs";
import { loadDatabaseCredential } from "./serviceos-database-backup-access.mjs";
import { copyReviewedLiveRuntimeSource, reviewedLiveRuntimeSource,
  reviewedLiveRuntimeSource1705, reviewedLiveRuntimeSource1828,
  reviewedLiveRuntimeSource1911 } from "./copy-reviewed-live-runtime-source.mjs";

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
  const selection = process.argv.slice(2).join(" ");
  if (!["--copy-approved-exact-package", "--copy-approved-exact-package-1705",
    "--copy-approved-exact-package-1828", "--copy-approved-exact-package-1911"].includes(selection)) {
    throw Error("runtime_exact_copy_requires_separate_approval");
  }
  const fresh = selection === "--copy-approved-exact-package-1705";
  const latest = selection === "--copy-approved-exact-package-1828";
  const newest = selection === "--copy-approved-exact-package-1911";
  const attempt = randomUUID();
  let writer, restore;
  try {
    writer = await port("Writer");
    restore = await port("Restore");
    const result = await copyReviewedLiveRuntimeSource({
      sourcePath: privatePath(newest ? "build01-live-edge-source-2026-10-16-1911.age" : latest
        ? "build01-live-edge-source-2026-10-16-1828.age"
        : fresh ? "build01-live-edge-source-2026-10-16-1705.age"
          : "build01-live-edge-source-2026-10-16-0630.age"),
      downloadPath: privatePath(`build01-live-edge-source-restore-${attempt}.age`),
      writer, restore, reviewed: newest ? reviewedLiveRuntimeSource1911
        : latest ? reviewedLiveRuntimeSource1828
        : fresh ? reviewedLiveRuntimeSource1705 : reviewedLiveRuntimeSource,
    });
    const receipt = {
      ...result,
      attempt,
      source: newest ? "reviewed LIVE Edge source package after Email retry; 103 functions and 728 files"
        : latest ? "reviewed LIVE Edge source package; 103 functions and 728 files"
        : fresh ? "reviewed LIVE Edge source package; 103 functions and 727 files"
          : "reviewed LIVE Edge source package; 102 functions and 721 files",
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
