/** Recovery-only proof for the exact, independently downloaded age ciphertext.
 * Reads one bound 1Password escrow item; plaintext stays in process memory.
 * Compares every recovered value to current LIVE Edge digest metadata.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, lstatSync, realpathSync } from "node:fs";
import { createRecoveryEscrow } from "./onepassword-database-recovery.mjs";
import { savedCliToken } from "../verify/learn-test-readiness.mjs";
import { REQUIRED_NAMES, OPTIONAL_NAMES } from "./edge-runtime-seal.mjs";

const project = "tgbnakbxwcqjeimygroz";
const expected = {
  bytes: 5094,
  sha256: "6842129fb664e513bd7fa078b7e5080e3b7f44ee3fce7f7aa764d87cce2105aa",
  sourceManifestSha256: "4008cc502a41f5948cfea8e2d06fa3be26ff4f4f7828839f707724b7c49f1488",
};
const bindingPath = ".verification-results/database-backup-onepassword-binding.json";
const downloadedPath = ".verification-results/build01-edge-secret-packages/restore-904b226c-1584-4bca-bfdf-8f627eb0cd57.age";
const agePath = "/private/tmp/serviceos-age-1.3.2/age";
const ageSha256 = "4012dfc2725883beafb710894af4f599b7a94f8c8e0f51f02cc96ab8df33915e";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function privateBytes(path, maxBytes) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() ||
      (stat.mode & 0o077) !== 0 || stat.size < 1 || stat.size > maxBytes ||
      realpathSync(path) !== `${process.cwd()}/${path}`)
    throw Error("recovery_private_file_invalid");
  return readFileSync(path);
}
async function main() {
  if (process.argv.slice(2).join(" ") !== "--approved-exact-copy")
    throw Error("recovery_exact_copy_required");
  const encrypted = privateBytes(downloadedPath, 2 * 1024 * 1024);
  if (encrypted.length !== expected.bytes || sha(encrypted) !== expected.sha256 ||
      encrypted.subarray(0, 22).toString() !== "age-encryption.org/v1\n" ||
      sha(readFileSync(agePath)) !== ageSha256)
    throw Error("recovery_ciphertext_changed");
  const binding = JSON.parse(privateBytes(bindingPath, 4096).toString("utf8"));
  const material = await createRecoveryEscrow(binding).read();
  const publicRecipient = JSON.parse(readFileSync(
    "infrastructure/database-backup/public-recipient.json", "utf8"));
  if (publicRecipient.project !== project || material.ageRecipient !== publicRecipient.recipient)
    throw Error("recovery_recipient_changed");
  const input = Buffer.from(material.ageIdentity + "\n");
  material.ageIdentity = "";
  material.vaultRootKey = "";
  let plain;
  try {
    const result = spawnSync(agePath,
      ["--decrypt", "--identity", "-", "--output", "-", downloadedPath],
      { input, encoding: null, timeout: 30000, maxBuffer: 1024 * 1024 });
    if (result.status !== 0 || !Buffer.isBuffer(result.stdout))
      throw Error("recovery_decryption_unconfirmed");
    plain = result.stdout;
    const recovered = JSON.parse(plain.toString("utf8"));
    const names = Object.keys(recovered.selected ?? {}).sort();
    if (recovered.format !== "serviceos-build01-edge-credential-package/1" ||
        recovered.project !== project ||
        recovered.sourceManifestSha256 !== expected.sourceManifestSha256 ||
        recovered.recipient !== material.ageRecipient ||
        names.length !== REQUIRED_NAMES.length + OPTIONAL_NAMES.length ||
        REQUIRED_NAMES.some(name => !names.includes(name)) ||
        OPTIONAL_NAMES.some(name => !names.includes(name)))
      throw Error("recovery_package_scope_changed");
    const response = await fetch(`https://api.supabase.com/v1/projects/${project}/secrets`, {
      headers: { Authorization: `Bearer ${savedCliToken()}` }, redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error(`recovery_digest_read_http_${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length > 200) throw Error("recovery_digest_shape_changed");
    const digests = new Map(rows.map(row => [row.name, row.value]));
    for (const name of names) {
      const item = recovered.selected[name];
      if (!item || typeof item.value !== "string" || item.value.length < 1 ||
          item.activeSha256 !== digests.get(name) || sha(item.value) !== digests.get(name))
        throw Error("recovery_active_digest_mismatch");
    }
    return { state: "independent_edge_credential_restore_verified",
      project, encryptedBytes: expected.bytes, encryptedSha256: expected.sha256,
      selectedCount: names.length, activeDigestMatches: names.length,
      independentRestoreDownloadUsed: true, recoveryIdentityMatched: true,
      plaintextFileCreated: false, credentialValuesReturned: false,
      providerRequests: 0, productionDataWrites: false,
      authenticatedProviderRestartVerified: false,
      observedAt: new Date().toISOString() };
  } finally { input.fill(0); plain?.fill(0); }
}

try { console.log(JSON.stringify(await main())); }
catch (error) {
  console.error(JSON.stringify({ state: "edge_credential_restore_unverified",
    code: error.message === "onepassword_operation_unconfirmed" ? error.message
      : "edge_credential_restore_unverified", credentialValuesReturned: false }));
  process.exitCode = 1;
}
