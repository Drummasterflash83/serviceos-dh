/** Supervised initial snapshot only. Never creates keys/resources or schedules.
 * Real execution requires the separate destination/copy and CLI authorisations. */
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants } from "node:fs";
import { mkdir, open, lstat, realpath, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { createRecoveryEscrow } from "./onepassword-database-recovery.mjs";
import { loadDatabaseCredential } from "./serviceos-database-backup-access.mjs";
import { createDatabaseS3 } from "./recording-backup-s3.mjs";
import { uploadDatabasePackage, downloadDatabasePackage } from "./database-backup-transfer.mjs";
import { RecordingBackupError } from "./recording-backup-core.mjs";
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
export function parseDatabaseBackupArgs(args) {
  need(
    args.length === 3 &&
      ["--prepare-initial", "--copy-and-restore-initial"].includes(args[0]) &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(args[1]),
    "database_runner_arguments_invalid",
  );
  return { mode: args[0], runId: args[1], bindingPath: resolve(args[2]) };
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
export async function runPreparedDatabaseBackup({
  directory,
  escrow,
  openWriter = () => transport("Writer"),
  openRestore = () => transport("Restore"),
  recover = (data) => pythonStage("restore_database_package.py", data),
  now = Date.now,
}) {
  await privateDirectory(directory);
  const lockPath = join(directory, "active.lock");
  const lock = await open(lockPath, "wx", 0o600);
  let writer,
    reader,
    stage = "preflight",
    completed = false;
  const attempt = randomUUID();
  try {
    const d = await privateJson(join(directory, "descriptor.json"));
    const preparation = await privateJson(join(directory, "preparation.json"));
    need(
      preparation.contract === "database-package-preparation/1" &&
        preparation.state === "package_encrypted_and_decrypt_checked" &&
        preparation.snapshotAt === d.snapshotAt &&
        preparation.localDatabaseRestoreVerified === true &&
        same(preparation.descriptor, d) &&
        preparation.archive.bytes === ARCHIVE.bytes &&
        preparation.archive.sha256 === ARCHIVE.sha256,
      "database_initial_package_not_verified",
    );
    const material = await escrow.read();
    need(material.ageRecipient === d.recipient, "database_recipient_changed");
    await saveNew(join(directory, `attempt-${attempt}.json`), {
      state: "started",
      at: new Date(now()).toISOString(),
      keyStoreItem: escrow.binding,
      sourceArchive: ARCHIVE,
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
    // Read back from the separate secret store again after independent download.
    const saved = await escrow.read();
    need(same(saved, material), "database_recovery_material_changed");
    stage = "restore";
    const result = await recover({
      encryptedPath: downloaded,
      destination: join(directory, `restore-${attempt}`),
      descriptor: d,
      ageIdentity: saved.ageIdentity,
      rootKey: saved.vaultRootKey,
      agePath: AGE,
    });
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
    const recovery = {
      nativeRows: result.nativeDataComparison.rows,
      operationalRows: result.networkSupplementComparison.rows,
      recordingRelationships: result.recordingRelationships.recordings,
      vaultSecretsVerified: result.vaultSecretsVerified,
      containerRemoved: true,
    };
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
  if (parsed.mode === "--prepare-initial") {
    await mkdir(directory, { mode: 0o700 });
    const material = await escrow.read();
    const { stdout } = await execute("git", ["rev-parse", "HEAD"], { cwd: REPO });
    const result = await pythonStage("prepare_database_package.py", {
      source: SOURCE,
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
  return runPreparedDatabaseBackup({ directory, escrow });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await main(process.argv.slice(2))));
  } catch {
    console.error(JSON.stringify({ state: "database_backup_not_verified", secretsPrinted: false }));
    process.exitCode = 1;
  }
}
