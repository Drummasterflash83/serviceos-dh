/** One approved age ciphertext to the existing private London bucket.
 * Writer creates the immutable version; Restore independently downloads it.
 * No plaintext, private recovery key, provider call or production data write.
 */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabaseS3 } from "./recording-backup-s3.mjs";
import { loadDatabaseCredential } from "./serviceos-database-backup-access.mjs";
import { copyReviewedLiveRuntimeSource, reviewedBuild01EdgeCredentialPackage }
  from "./copy-reviewed-live-runtime-source.mjs";

if (process.argv.slice(2).join(" ") !== "--copy-approved-exact-package")
  throw Error("Exact approved encrypted credential package required");

const privatePath = name => fileURLToPath(new URL(`../../.verification-results/${name}`, import.meta.url));
async function port(role) {
  const credential = await loadDatabaseCredential(role);
  return createDatabaseS3({
    credentials: async () => ({ accessKeyId: credential.accessKeyId,
      secretAccessKey: credential.secretAccessKey }),
    expectedPrincipalArn: credential.principalArn,
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
}

let writer, restore;
try {
  writer = await port("Writer");
  restore = await port("Restore");
  const attempt = randomUUID();
  const result = await copyReviewedLiveRuntimeSource({
    sourcePath: privatePath("build01-edge-secret-packages/edge-credentials-f8caa937-2a55-493c-88bd-5cf2256853ab.age"),
    downloadPath: privatePath(`build01-edge-secret-packages/restore-${attempt}.age`),
    writer, restore, reviewed: reviewedBuild01EdgeCredentialPackage,
  });
  const receipt = { ...result, attempt, selectedCount: 11,
    sourceManifestSha256: "4008cc502a41f5948cfea8e2d06fa3be26ff4f4f7828839f707724b7c49f1488",
    providerRequests: 0, recoveryPrivateKeyUsed: false,
    credentialValuesReturned: false, authenticatedProviderRestartVerified: false };
  await writeFile(privatePath(`build01-edge-secret-packages/offsite-${attempt}.json`),
    JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ state: result.state, attempt, bytes: result.bytes,
    sha256: result.sha256, objectKey: result.object.key,
    independentRestoreDownloadVerified: true, authenticatedProviderRestartVerified: false }));
} catch (error) {
  const code = typeof error?.code === "string" && /^[a-z0-9_]+$/.test(error.code)
    ? error.code : "edge_credential_offsite_copy_unverified";
  console.error(JSON.stringify({ state: "edge_credential_offsite_copy_unverified", code }));
  process.exitCode = 1;
} finally {
  writer?.close();
  restore?.close();
}
