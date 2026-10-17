/** One escrow read for current off-site database/Vault and Edge source recovery.
 * All service writes are confined to disposable offline containers.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRecoveryEscrow } from "./onepassword-database-recovery.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const privateRoot = join(repo, ".verification-results");
const download = join(privateRoot, "build01-scheduled-database-20261017");
const offsiteSource = join(privateRoot,
  "build01-live-edge-source-restore-2f75feeb-21d2-4288-bde4-dc8f85e6c9e8.age");
const binding = join(privateRoot, "database-backup-onepassword-binding.json");
const restored = join(download, "offsite-restored");
const age = "/private/tmp/serviceos-age-1.3.2/age";
const exactDbSha = "40009f3659aa3be728d1a01a8ed614408a3c43afacdfb9668be0941043b0abf1";
const exactSourceSha = "dcfcbb300d0239f379f744e55e989fb1a4bcd2b85ab67f1c8b3fa5a940f55473";
const need = (ok, code) => { if (!ok) throw Error(code); };

async function privateFile(path, max) {
  const value = await lstat(path);
  need(value.isFile() && !value.isSymbolicLink() &&
    value.uid === process.getuid() && (value.mode & 0o077) === 0 &&
    value.size > 0 && value.size <= max,
  "offsite_recovery_private_input_invalid");
  return value;
}
async function fileSha256(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const hash = createHash("sha256");
    for await (const part of handle.createReadStream({ start: 0, autoClose: false }))
      hash.update(part);
    return hash.digest("hex");
  } finally { await handle.close(); }
}
function python(name, args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-B", join(repo, "scripts/backup", name), ...args], {
      cwd: repo, stdio: ["pipe", "pipe", "ignore"],
      env: { HOME: process.env.HOME, PATH: "/usr/bin:/bin", LANG: "C" },
    });
    const chunks = [];
    let length = 0;
    const interrupt = () => child.kill("SIGINT");
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    const timer = setTimeout(interrupt, timeoutMs);
    child.stdout.on("data", part => {
      length += part.length;
      if (length > 2 * 1024 * 1024) interrupt();
      else chunks.push(part);
    });
    child.once("error", () => reject(Error("offsite_recovery_child_unconfirmed")));
    child.once("close", code => {
      clearTimeout(timer);
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
      try {
        const lines = Buffer.concat(chunks).toString("utf8").trim().split("\n");
        const result = JSON.parse(lines.at(-1));
        need(code === 0, "offsite_recovery_child_failed");
        resolve(result);
      } catch { reject(Error("offsite_recovery_child_unconfirmed")); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

async function main() {
  const mode = process.argv.slice(2).join(" ");
  need(["--exact-2026-10-17", "--preflight-only"].includes(mode),
    "offsite_recovery_exact_mode_required");
  await privateFile(binding, 1_000_000);
  await privateFile(join(download, "download-verified.json"), 1_000_000);
  const encrypted = join(download, "snapshot.age");
  const dbStat = await privateFile(encrypted, 2 * 1024 ** 3);
  const sourceStat = await privateFile(offsiteSource, 64 * 1024 * 1024);
  const proof = JSON.parse(await readFile(join(download, "download-verified.json"), "utf8"));
  const sourceProof = JSON.parse(await readFile(join(repo,
    "docs/operations/evidence/learn-build01-runtime-2322-offsite-copy-2026-10-17.json"), "utf8"));
  const publicRecipient = JSON.parse(await readFile(join(repo,
    "infrastructure/database-backup/public-recipient.json"), "utf8"));
  need(proof.state === "independently_downloaded_ciphertext_verified" &&
    proof.githubRunId === 39015198972 && proof.trigger === "schedule" &&
    proof.descriptor?.format === "serviceos-database-package/2" &&
    proof.descriptor?.project === "tgbnakbxwcqjeimygroz" &&
    proof.descriptor?.bytes === dbStat.size &&
    proof.descriptor?.sha256 === exactDbSha &&
    proof.recoveryKeyRead === false && proof.productionWrites === false &&
    sourceProof.ciphertextBytes === sourceStat.size &&
    sourceProof.ciphertextSha256 === exactSourceSha &&
    sourceProof.separateRestoreIdentityVersionReadbackVerified === true &&
    publicRecipient.recipient === proof.descriptor.recipient &&
    await fileSha256(encrypted) === exactDbSha &&
    await fileSha256(offsiteSource) === exactSourceSha,
  "offsite_recovery_preflight_unverified");
  if (mode === "--preflight-only") {
    console.log(JSON.stringify({ state: "offsite_recovery_inputs_ready",
      githubRunId: 39015198972, encryptedDatabaseBytes: dbStat.size,
      encryptedDatabaseSha256: exactDbSha, encryptedSourceBytes: sourceStat.size,
      encryptedSourceSha256: exactSourceSha, recoveryKeyRead: false,
      productionWrites: false }));
    return;
  }
  const escrowBinding = JSON.parse(await readFile(binding, "utf8"));
  const material = await createRecoveryEscrow(escrowBinding).read();
  need(material.ageRecipient === proof.descriptor.recipient,
    "offsite_recovery_recipient_changed");
  const sourceInput = material.ageIdentity + "\n";
  let dbInput = JSON.stringify({ encryptedPath: encrypted, destination: restored,
    descriptor: proof.descriptor, ageIdentity: material.ageIdentity,
    rootKey: material.vaultRootKey, agePath: age });
  const sourcePromise = python("verify_live_runtime_package.py",
    ["--encrypted", offsiteSource, "--age", age, "--package", "current"],
    sourceInput, 3 * 60 * 1000);
  const databasePromise = python("restore_database_package.py", [],
    dbInput, 35 * 60 * 1000);
  material.ageIdentity = ""; material.vaultRootKey = ""; dbInput = "";
  const [sourceOutcome, databaseOutcome] = await Promise.allSettled([
    sourcePromise, databasePromise]);
  need(sourceOutcome.status === "fulfilled" &&
    sourceOutcome.value.state === "decrypted_live_edge_source_verified" &&
    sourceOutcome.value.functions === 103 &&
    sourceOutcome.value.sourceFiles === 728 &&
    sourceOutcome.value.encryptedSha256 === exactSourceSha,
  "offsite_source_decryption_unverified");
  need(databaseOutcome.status === "fulfilled" &&
    databaseOutcome.value.state === "encrypted_package_database_and_vault_restored" &&
    databaseOutcome.value.containerRemoved === true &&
    databaseOutcome.value.originalPackageFilesUnchanged === true &&
    databaseOutcome.value.allPhysicalTablesCovered === true &&
    Number.isInteger(databaseOutcome.value.vaultSecretsVerified),
  "offsite_database_vault_restore_unverified");
  const service = await python("rehearse_build01_auth_service_recovery.py",
    ["--with-reviewed-v107-edge-and-existing-user-reset", "--offsite-recovered-dir",
      ".verification-results/build01-scheduled-database-20261017/offsite-restored"],
    "", 35 * 60 * 1000);
  need(service.state === "isolated_auth_api_and_operator_boundary_verified" &&
    service.databaseSourceKind === "independent_scheduled_offsite_ciphertext" &&
    service.existingUserDisposableResetVerified === true &&
    service.existingUserCurrentEdgeReadVerified === true &&
    service.authContainerRemoved === true &&
    service.restContainerRemoved === true &&
    service.edgeContainerRemoved === true &&
    service.gatewayContainerRemoved === true &&
    service.databaseContainerRemoved === true,
  "offsite_service_recovery_unverified");
  console.log(JSON.stringify({ state: "offsite_database_vault_source_and_service_verified",
    githubRunId: 39015198972, encryptedDatabaseSha256: exactDbSha,
    encryptedSourceSha256: exactSourceSha,
    sourceFunctions: 103, sourceFiles: 728,
    vaultSecretsVerified: databaseOutcome.value.vaultSecretsVerified,
    preservedUserFreshLogin: true, currentEdgeTenantRead: true,
    allDisposableContainersRemoved: true, productionWrites: false,
    recoveryKeyPersisted: false,
    fullFrontendOrCaptureRestartVerified: false }));
}

try { await main(); }
catch { console.error(JSON.stringify({ state: "offsite_combined_recovery_unverified",
  secretsPrinted: false })); process.exitCode = 1; }
