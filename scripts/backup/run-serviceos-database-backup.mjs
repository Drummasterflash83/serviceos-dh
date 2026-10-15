/** Supervised explicitly pinned snapshots. Never creates keys/resources or schedules.
 * Real execution requires the separate destination/copy and CLI authorisations. */
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants } from "node:fs";
import { mkdir, open, lstat, realpath, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { createRecoveryEscrow } from "./onepassword-database-recovery.mjs";
import { loadDatabaseCredential } from "./serviceos-database-backup-access.mjs";
import { createDatabaseS3 } from "./recording-backup-s3.mjs";
import { uploadDatabasePackage, downloadDatabasePackage } from "./database-backup-transfer.mjs";
import { RecordingBackupError } from "./recording-backup-core.mjs";
import { databaseBackupBinding } from "./database-backup-template.mjs";
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const PRIVATE = join(REPO, ".verification-results");
const SOURCE = join(PRIVATE, "production-database-complete-capture-small-full-2026-10-12");
const AGE = "/private/tmp/serviceos-age-1.3.2/age";
const ARCHIVE = {
  bytes: 197303039,
  sha256: "bdb6be1f2cb934247949d6443305550888e6b4e62f5c55dac419a432616bd3db",
};
const need = (ok, code) => {
  if (!ok) throw new RecordingBackupError(code);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function readRecoveryMaterial(escrow) {
  // A failed desktop authorisation is a completed human decision for this run.
  // Automatic retries can open repeated Touch ID prompts while the operator is
  // away. A later, explicit recovery-only run may read the escrow once again.
  return escrow.read();
}
export function parseDatabaseBackupArgs(args) {
  const resume = args[0] === "--restore-downloaded-checkpoint";
  const checkpoint = resume || ["--prepare-checkpoint", "--copy-and-restore-checkpoint"].includes(args[0]);
  need(args.length === (resume ? 5 : checkpoint ? 4 : 3)
    && (checkpoint || ["--prepare-initial", "--copy-and-restore-initial"].includes(args[0]))
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(args[1])
    && (!checkpoint || /^\.verification-results\/production-release-checkpoint-[0-9]{8}-[a-z0-9-]+$/.test(args[3]))
    && (!resume || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(args[4])),
    "database_runner_arguments_invalid");
  return { mode: args[0], runId: args[1], bindingPath: resolve(args[2]),
    ...(checkpoint ? {sourcePath: resolve(REPO,args[3])} : {}),
    ...(resume ? { priorAttempt: args[4] } : {}) };
}

async function privateDirectory(path) {
  const st = await lstat(path);
  need(
    st.isDirectory() &&
      st.uid === process.getuid() &&
      (st.mode & 0o777) === 0o700 &&
      (await realpath(path)) === resolve(path),
    "database_runner_directory_invalid",
  );
}
async function privateJson(path) {
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await f.stat();
    need(
      st.isFile() &&
        st.uid === process.getuid() &&
        (st.mode & 0o077) === 0 &&
        st.size > 0 &&
        st.size < 1024 * 1024,
      "database_runner_metadata_invalid",
    );
    return JSON.parse(await f.readFile("utf8"));
  } finally {
    await f.close();
  }
}
async function saveNew(path, value) {
  const f = await open(path, "wx", 0o600);
  try {
    await f.writeFile(JSON.stringify(value, null, 2) + "\n");
    await f.sync();
  } finally {
    await f.close();
  }
}
function pythonStage(name, data) {
  return new Promise((resolveResult, reject) => {
    const child = spawn("python3", ["-B", join(REPO, "scripts/backup", name)], {
      cwd: REPO,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks = [];
    let length = 0,
      failed = false;
    // An interactive stop must reach Python so its RestoreSandbox context can
    // remove the exact isolated database container before this process exits.
    const interrupt = () => {
      failed = true;
      child.kill("SIGINT");
    };
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    // SIGINT lets Python unwind the disposable container context before exiting.
    const timeout = setTimeout(
      () => {
        failed = true;
        child.kill("SIGINT");
      },
      20 * 60 * 1000,
    );
    child.stdout.on("data", (b) => {
      length += b.length;
      if (length > 1024 * 1024) {
        failed = true;
        child.kill("SIGINT");
      } else chunks.push(b);
    });
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => {
      failed = true;
    });
    child.once("error", () => {
      failed = true;
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
      try {
        need(!failed && code === 0, "database_python_stage_unconfirmed");
        resolveResult(JSON.parse(Buffer.concat(chunks).toString("utf8").trim().split("\n").at(-1)));
      } catch {
        reject(new RecordingBackupError("database_python_stage_unconfirmed"));
      }
    });
    child.stdin.end(JSON.stringify(data));
  });
}
async function transport(role) {
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
function verifiedRecovery(result) {
  need(
    result?.state === "encrypted_package_database_and_vault_restored" &&
      result.containerRemoved === true &&
      result.originalPackageFilesUnchanged === true &&
      result.allPhysicalTablesCovered === true &&
      result.tableCatalogMatched === true &&
      result.extensionVersionsMatched === true &&
      [
        result.vaultSecretsVerified,
        result.nativeDataComparison?.rows,
        result.networkSupplementComparison?.rows,
        result.recordingRelationships?.recordings,
      ].every((n) => Number.isSafeInteger(n) && n >= 0),
    "database_independent_restore_unverified",
  );
  return {
    nativeRows: result.nativeDataComparison.rows,
    operationalRows: result.networkSupplementComparison.rows,
    recordingRelationships: result.recordingRelationships.recordings,
    vaultSecretsVerified: result.vaultSecretsVerified,
    containerRemoved: true,
  };
}
async function checkedPreparation(directory, expectedArchive) {
  const d = await privateJson(join(directory, "descriptor.json"));
  const preparation = await privateJson(join(directory, "preparation.json"));
  need(
    preparation.contract === "database-package-preparation/1" &&
      (preparation.state === "package_encrypted_and_decrypt_checked" &&
        preparation.localDatabaseRestoreVerified === true ||
       preparation.state === "package_encrypted_source_evidence_verified_restore_pending" &&
        preparation.sourceDatabaseRestoreVerified === true &&
        preparation.localDatabaseRestoreVerified === false &&
        preparation.recoveryKeysRead === false ||
       preparation.state === "package_encrypted_native_evidence_verified_vault_pending" &&
        d.format === "serviceos-database-package/2" &&
        preparation.sourceDatabaseRestoreVerified === false &&
        preparation.sourceNativeRestoreVerified === true &&
        preparation.localDatabaseRestoreVerified === false &&
        preparation.recoveryKeysRead === false) &&
      preparation.snapshotAt === d.snapshotAt &&
      same(preparation.descriptor, d) &&
      preparation.archive.bytes === expectedArchive.bytes &&
      preparation.archive.sha256 === expectedArchive.sha256,
    "database_initial_package_not_verified",
  );
  return d;
}
/** Package an already restored snapshot with the pinned public age recipient. */
export async function preparePublicDatabaseBackup({
  source, directory, revision, recipient, expectedArchive,
  formatVersion = "serviceos-database-package/1",
}) {
  need(/^[a-f0-9]{40}$/.test(revision ?? "") && /^age1[0-9a-z]{58}$/.test(recipient ?? ""),
    "database_public_preparation_binding_invalid");
  need(["serviceos-database-package/1", "serviceos-database-package/2"].includes(formatVersion),
    "database_public_preparation_binding_invalid");
  await privateDirectory(source);
  await mkdir(directory, { mode: 0o700 });
  const result = await pythonStage("prepare_public_database_package.py", {
    source, directory, agePath: AGE, revision, ageRecipient: recipient,
    formatVersion,
  });
  need(["package_encrypted_source_evidence_verified_restore_pending",
    "package_encrypted_native_evidence_verified_vault_pending"].includes(result.state) &&
    result.recoveryKeysRead === false, "database_public_preparation_unconfirmed");
  const d = await checkedPreparation(directory, expectedArchive);
  need(d.recipient === recipient && d.format === formatVersion, "database_recipient_changed");
  return { state: result.state, encryptedBytes: d.bytes, recoveryKeyRead: false };
}
/** Routine storage verification. No recovery key or database restore is used. */
export async function copyPreparedDatabaseBackup({
  directory,
  expectedArchive = ARCHIVE,
  openWriter = () => transport("Writer"),
  openRestore = () => transport("Restore"),
  now = Date.now,
}) {
  expectedArchive = structuredClone(expectedArchive);
  need(Number.isSafeInteger(expectedArchive.bytes) && expectedArchive.bytes > 0 &&
    expectedArchive.bytes <= 1024 ** 3 && /^[a-f0-9]{64}$/.test(expectedArchive.sha256 ?? ""),
  "database_expected_archive_invalid");
  await privateDirectory(directory);
  const lockPath = join(directory, "active.lock");
  const lock = await open(lockPath, "wx", 0o600);
  const attempt = randomUUID();
  let writer, reader, stage = "preflight";
  try {
    const d = await checkedPreparation(directory, expectedArchive);
    stage = "copy";
    writer = await openWriter();
    const copied = await uploadDatabasePackage(join(directory, "snapshot.age"), d, writer, { now });
    writer.close(); writer = undefined;
    await saveNew(join(directory, `receipt-${attempt}.json`), copied.receipt);
    stage = "download";
    reader = await openRestore();
    await downloadDatabasePackage(copied.receipt, join(directory, `download-${attempt}.age`), reader, { now });
    reader.close(); reader = undefined;
    const verified = {
      state: "encrypted_offsite_copy_and_download_verified_restore_pending",
      attempt, snapshotAt: d.snapshotAt, encryptedBytes: d.bytes,
      encryptedSha256: d.sha256, independentStorageVerified: true,
      recoveryKeyRead: false, databaseRestoreVerified: false,
      dailyOperationVerified: false, fullServiceRecoveryVerified: false,
      productionWrites: false,
    };
    await saveNew(join(directory, `copy-verified-${attempt}.json`), verified);
    return verified;
  } catch (error) {
    await saveNew(join(directory, `failed-${attempt}.json`), {
      state: "database_offsite_copy_not_verified", stage,
      code: error instanceof RecordingBackupError ? error.code : "database_runner_unconfirmed",
      restoreInspectionRequired: false,
    });
    throw new RecordingBackupError("database_offsite_copy_not_verified");
  } finally {
    writer?.close(); reader?.close();
    await lock.close();
    await unlink(lockPath);
  }
}
export async function runPreparedDatabaseBackup({
  directory,
  escrow,
  openWriter = () => transport("Writer"),
  openRestore = () => transport("Restore"),
  recover = (data) => pythonStage("restore_database_package.py", data),
  now = Date.now,
  expectedArchive = ARCHIVE,
}) {
  expectedArchive = structuredClone(expectedArchive);
  need(Number.isSafeInteger(expectedArchive.bytes) && expectedArchive.bytes > 0
    && expectedArchive.bytes <= 1024 ** 3 && /^[a-f0-9]{64}$/.test(expectedArchive.sha256 ?? ""),
    "database_expected_archive_invalid");
  await privateDirectory(directory);
  const lockPath = join(directory, "active.lock");
  const lock = await open(lockPath, "wx", 0o600);
  let writer,
    reader,
    stage = "preflight",
    completed = false;
  const attempt = randomUUID();
  try {
    const d = await checkedPreparation(directory, expectedArchive);
    await saveNew(join(directory, `attempt-${attempt}.json`), {
      state: "started",
      at: new Date(now()).toISOString(),
      keyStoreItem: escrow.binding,
      sourceArchive: expectedArchive,
      sourceSnapshotAt: d.snapshotAt,
    });
    stage = "copy";
    writer = await openWriter();
    const copied = await uploadDatabasePackage(join(directory, "snapshot.age"), d, writer, { now });
    writer.close();
    writer = undefined;
    await saveNew(join(directory, `receipt-${attempt}.json`), copied.receipt);
    stage = "download";
    reader = await openRestore();
    const downloaded = join(directory, `download-${attempt}.age`);
    await downloadDatabasePackage(copied.receipt, downloaded, reader, { now });
    reader.close();
    reader = undefined;
    // The public recipient suffices for copy/download. Unlock the recovery key
    // once, only after the independently downloaded bytes have been verified.
    stage = "escrow-readback";
    const saved = await readRecoveryMaterial(escrow);
    need(saved.ageRecipient === d.recipient, "database_recipient_changed");
    stage = "restore";
    const result = await recover({
      encryptedPath: downloaded,
      destination: join(directory, `restore-${attempt}`),
      descriptor: d,
      ageIdentity: saved.ageIdentity,
      rootKey: saved.vaultRootKey,
      agePath: AGE,
    });
    const recovery = verifiedRecovery(result);
    const receipt = {
      state: "independent_database_snapshot_verified",
      attempt,
      snapshotAt: d.snapshotAt,
      encryptedBytes: d.bytes,
      independentStorageVerified: true,
      keyEscrowReadbackVerified: true,
      recovery,
      dailyOperationVerified: false,
      fullServiceRecoveryVerified: false,
      productionWrites: false,
    };
    await saveNew(join(directory, `verified-${attempt}.json`), receipt);
    completed = true;
    return receipt;
  } catch (error) {
    await saveNew(join(directory, `failed-${attempt}.json`), {
      state: "database_backup_not_verified",
      stage,
      code: error instanceof RecordingBackupError ? error.code : "database_runner_unconfirmed",
      restoreInspectionRequired: stage === "restore",
    });
    throw new RecordingBackupError("database_backup_not_verified");
  } finally {
    writer?.close();
    reader?.close();
    await lock.close();
    // A failed/uncertain DB subprocess requires explicit cleanup inspection.
    // Upload/download failures cannot have started a DB and may retry safely.
    if (completed || stage !== "restore") await unlink(lockPath);
  }
}
/** Resume only a completed, hash-checked Restore download whose later CLI read
 * failed. The prior transfer receipt and failure stage are immutable inputs; no
 * second S3 transfer or source export is performed. */
export async function restoreDownloadedDatabaseBackup({
  directory,
  priorAttempt,
  publicCopy = false,
  escrow,
  recover = (data) => pythonStage("restore_database_package.py", data),
  expectedArchive = ARCHIVE,
}) {
  need(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(priorAttempt), "database_prior_attempt_invalid");
  await privateDirectory(directory);
  const lockPath = join(directory, "active.lock");
  const lock = await open(lockPath, "wx", 0o600);
  const attempt = randomUUID();
  let stage = "preflight", completed = false;
  try {
    const d = await checkedPreparation(directory, expectedArchive);
    if (publicCopy) {
      const copy = await privateJson(join(directory, `copy-verified-${priorAttempt}.json`));
      need(copy.state === "encrypted_offsite_copy_and_download_verified_restore_pending" &&
        copy.attempt === priorAttempt && copy.snapshotAt === d.snapshotAt &&
        copy.encryptedBytes === d.bytes && copy.encryptedSha256 === d.sha256 &&
        copy.independentStorageVerified === true && copy.recoveryKeyRead === false &&
        copy.databaseRestoreVerified === false,
      "database_prior_download_not_confirmed");
    } else {
      const failure = await privateJson(join(directory, `failed-${priorAttempt}.json`));
      need(failure.state === "database_backup_not_verified" &&
        failure.stage === "escrow-readback" && failure.restoreInspectionRequired === false,
      "database_prior_download_not_confirmed");
    }
    const receipt = await privateJson(join(directory, `receipt-${priorAttempt}.json`));
    need(receipt.contract === "database-backup-receipt/1" &&
      same(receipt.destination, databaseBackupBinding) &&
      Object.keys(receipt.descriptor ?? {}).length === Object.keys(d).length &&
      Object.entries(d).every(([key, value]) => receipt.descriptor[key] === value) &&
      receipt.object?.size === d.bytes && receipt.object?.sha256 === d.sha256 &&
      receipt.object?.key?.startsWith(databaseBackupBinding.prefix + "objects/") &&
      receipt.object.key.endsWith("/" + d.sha256) &&
      typeof receipt.object?.versionId === "string" && receipt.object.versionId.length > 0 &&
      receipt.object.encryption === "AES256" && receipt.object.retentionMode === "GOVERNANCE" &&
      Date.parse(receipt.object.retainUntil) >= Date.parse(receipt.object.createdAt) + 30 * 86400000 - 1000,
    "database_prior_receipt_unverified");
    const downloaded = join(directory, `download-${priorAttempt}.age`);
    const file = await open(downloaded, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      need(stat.isFile() && stat.uid === process.getuid() &&
        (stat.mode & 0o077) === 0 && stat.size === d.bytes,
      "database_prior_download_invalid");
      const hash = createHash("sha256");
      for await (const part of file.createReadStream({ start: 0, autoClose: false })) hash.update(part);
      need(hash.digest("hex") === d.sha256, "database_prior_download_hash_mismatch");
      const magic = Buffer.alloc(22);
      await file.read(magic, 0, magic.length, 0);
      need(magic.toString() === "age-encryption.org/v1\n", "database_package_not_age");
    } finally {
      await file.close();
    }
    stage = "escrow-readback";
    const material = await readRecoveryMaterial(escrow);
    need(material.ageRecipient === d.recipient, "database_recipient_changed");
    stage = "restore";
    const result = await recover({
      encryptedPath: downloaded,
      destination: join(directory, `restore-${attempt}`),
      descriptor: d,
      ageIdentity: material.ageIdentity,
      rootKey: material.vaultRootKey,
      agePath: AGE,
    });
    const recovery = verifiedRecovery(result);
    const verified = {
      state: "independent_database_snapshot_verified",
      attempt,
      sourceReceiptAttempt: priorAttempt,
      snapshotAt: d.snapshotAt,
      encryptedBytes: d.bytes,
      independentStorageVerified: true,
      keyEscrowReadbackVerified: true,
      recovery,
      dailyOperationVerified: false,
      fullServiceRecoveryVerified: false,
      productionWrites: false,
    };
    await saveNew(join(directory, `verified-${attempt}.json`), verified);
    completed = true;
    return verified;
  } catch (error) {
    await saveNew(join(directory, `failed-${attempt}.json`), {
      state: "database_backup_not_verified",
      stage,
      code: error instanceof RecordingBackupError ? error.code : "database_runner_unconfirmed",
      restoreInspectionRequired: stage === "restore",
    });
    throw new RecordingBackupError("database_backup_not_verified");
  } finally {
    await lock.close();
    if (completed || stage !== "restore") await unlink(lockPath);
  }
}
async function main(args) {
  const parsed = parseDatabaseBackupArgs(args);
  need(parsed.bindingPath.startsWith(PRIVATE + "/"), "database_binding_outside_private_directory");
  need(
    (await realpath(parsed.bindingPath)) === parsed.bindingPath,
    "database_binding_symlink_rejected",
  );
  await privateDirectory(PRIVATE);
  const execute = promisify(execFile);
  const status = await execute("git", ["status", "--porcelain"], { cwd: REPO });
  need(status.stdout.trim() === "", "database_runner_requires_committed_checkpoint");
  const escrow = createRecoveryEscrow(await privateJson(parsed.bindingPath));
  const directory = join(PRIVATE, "database-backup-" + parsed.runId);
  const source = parsed.sourcePath ?? SOURCE;
  await privateDirectory(source);
  const exported = await privateJson(join(source, "report.json"));
  need(exported.project === "tgbnakbxwcqjeimygroz" && exported.state === "export_complete_restore_unverified"
    && exported.productionDataWrites === false, "database_source_export_unverified");
  const expectedArchive = parsed.sourcePath ? exported.archive : ARCHIVE;
  if (["--prepare-initial", "--prepare-checkpoint"].includes(parsed.mode)) {
    await mkdir(directory, { mode: 0o700 });
    const material = await readRecoveryMaterial(escrow);
    const { stdout } = await execute("git", ["rev-parse", "HEAD"], { cwd: REPO });
    const result = await pythonStage("prepare_database_package.py", {
      source,
      directory,
      agePath: AGE,
      revision: stdout.trim(),
      ageIdentity: material.ageIdentity,
      ageRecipient: material.ageRecipient,
      rootKey: material.vaultRootKey,
    });
    need(
      result.state === "package_encrypted_and_decrypt_checked",
      "database_preparation_unconfirmed",
    );
    return { state: result.state, runId: parsed.runId, uploaded: false };
  }
  if (parsed.mode === "--restore-downloaded-checkpoint")
    return restoreDownloadedDatabaseBackup({
      directory, priorAttempt: parsed.priorAttempt, escrow, expectedArchive,
    });
  return runPreparedDatabaseBackup({ directory, escrow, expectedArchive });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await main(process.argv.slice(2))));
  } catch {
    console.error(JSON.stringify({ state: "database_backup_not_verified", secretsPrinted: false }));
    process.exitCode = 1;
  }
}
