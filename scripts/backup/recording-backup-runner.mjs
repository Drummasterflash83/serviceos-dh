/** Private disk progress is advisory; only the immutable S3 manifest proves
 * inventory coverage. No credentials or recording bytes are persisted here. */
import { constants } from "node:fs";
import { open, lstat, realpath, rename, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { copyRecordingBatch } from "./recording-backup-batch.mjs";
import {
  finalizeRecordingInventory,
  recordingContext,
  RecordingBackupError,
} from "./recording-backup-core.mjs";
const fail = (code) => {
  throw new RecordingBackupError(code);
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const safeStat = (stat, directory = false) =>
  stat.uid === process.getuid() &&
  (directory
    ? stat.isDirectory() && (stat.mode & 0o777) === 0o700
    : stat.isFile() && stat.nlink === 1 && (stat.mode & 0o777) === 0o600);
async function readPrivate(path, optional = false) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!safeStat(stat) || stat.size > 32 * 1024 * 1024) fail("runner_file_unverified");
    return await file.readFile();
  } catch (e) {
    if (optional && e.code === "ENOENT") return null;
    if (e instanceof RecordingBackupError) throw e;
    fail("runner_file_unavailable");
  } finally {
    await file?.close();
  }
}
async function syncDirectory(directory) {
  const file = await open(directory, "r");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}
async function savePrivate(directory, name, value) {
  const temporary = join(directory, `.pending-${randomUUID()}`);
  let file;
  try {
    file = await open(temporary, "wx", 0o600);
    await file.writeFile(JSON.stringify(value) + "\n");
    await file.sync();
    await file.close();
    file = null;
    await rename(temporary, join(directory, name));
    await syncDirectory(directory);
  } finally {
    await file?.close();
    await unlink(temporary).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
/** One bounded copy batch or a deliberate whole-inventory finalization. The
 * caller owns scheduling and must never infer completion from nextIndex alone. */
export async function runRecordingBackup({
  directory,
  inventoryFileSha256,
  binding,
  createPorts,
  mode,
  maxObjects = 25,
  maxBytes = 32 * 1024 * 1024,
  signal,
}) {
  let lock,
    ports,
    locked = false;
  const startedAt = new Date().toISOString();
  try {
    const context = recordingContext(binding);
    if (
      !["copy", "finalize"].includes(mode) ||
      typeof createPorts !== "function" ||
      typeof directory !== "string" ||
      !/^[a-f0-9]{64}$/.test(inventoryFileSha256 ?? "")
    )
      fail("runner_options_invalid");
    // Reject symlinks in the supplied directory path rather than following them.
    directory = resolve(directory);
    if ((await realpath(directory)) !== directory || !safeStat(await lstat(directory), true))
      fail("runner_directory_unverified");
    try {
      lock = await open(join(directory, "runner.lock"), "wx", 0o600);
      locked = true;
    } catch (e) {
      if (e.code === "EEXIST") fail("runner_already_locked");
      throw e;
    }
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await lock.sync();
    await syncDirectory(directory);
    const raw = await readPrivate(join(directory, "inventory.json"));
    if (sha(raw) !== inventoryFileSha256) fail("runner_inventory_hash_mismatch");
    const inventory = JSON.parse(raw);
    const checkpointBytes = await readPrivate(join(directory, "checkpoint.json"), true);
    const checkpoint = checkpointBytes ? JSON.parse(checkpointBytes) : undefined;
    if (signal?.aborted) fail("runner_cancelled");
    if (mode === "finalize" && (!checkpoint || checkpoint.nextIndex !== inventory.objects?.length))
      fail("runner_copy_pass_incomplete");
    await savePrivate(directory, "last-attempt.json", {
      state: "in_progress",
      mode,
      startedAt,
      backupComplete: false,
    });
    ports = await createPorts();
    // Also validates checkpoint inventory/destination on finalize, without copying:
    // a complete checkpoint makes copyRecordingBatch perform zero provider calls.
    const batch = await copyRecordingBatch(inventory, context, ports, {
      checkpoint,
      saveCheckpoint: (value) => savePrivate(directory, "checkpoint.json", value),
      maxObjects,
      maxBytes,
      signal,
    });
    let result = batch;
    if (mode === "finalize") {
      if (signal?.aborted) fail("runner_cancelled");
      const final = await finalizeRecordingInventory(inventory, context, ports);
      result = {
        state: final.state,
        runId: inventory.runId,
        inventorySha256: final.manifest.inventorySha256,
        recovered: final.recovered,
        objects: final.manifest.objects.length,
        totalBytes: final.manifest.totalBytes,
        verifiedAt: final.manifest.verifiedAt,
        coverage: final.manifest.coverage,
        playback: final.manifest.playback,
        databaseRestore: final.manifest.databaseRestore,
        backupComplete: false,
        nextStep: "isolated_playback_and_database_restore",
      };
    }
    await savePrivate(directory, "last-result.json", result);
    await savePrivate(directory, "last-attempt.json", {
      state: "succeeded",
      mode,
      startedAt,
      finishedAt: new Date().toISOString(),
      resultState: result.state,
      backupComplete: false,
    });
    return result;
  } catch (e) {
    const code = e instanceof RecordingBackupError ? e.code : "runner_unconfirmed";
    if (locked)
      await savePrivate(directory, "last-attempt.json", {
        state: "failed",
        mode,
        startedAt,
        finishedAt: new Date().toISOString(),
        code,
        backupComplete: false,
      }).catch(() => {});
    fail(code);
  } finally {
    ports?.close?.();
    await lock?.close();
    if (locked) {
      await unlink(join(directory, "runner.lock"));
      await syncDirectory(directory);
    }
  }
}
