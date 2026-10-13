/** Approved destination and existing keys only. A local computer must be awake.
 * A lock is never cleared automatically: inspect its process before recovery. */
import { constants } from "node:fs";
import { open, mkdir, lstat, realpath, rename, unlink, readFile, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import {
  binding as liveBinding,
  createLiveRecordingPorts,
} from "./run-drummonds-recording-backup.mjs";
import { dailyRecordingCycle, recordingBackupHealth } from "./recording-backup-daily.mjs";
import { verifyDailyLease } from "./communication-backup-lock.mjs";
import { RecordingBackupError } from "./recording-backup-core.mjs";
const fail = (code) => {
  throw new RecordingBackupError(code);
};
// Inventory plus two complete metadata/reference passes and up to 400 new copies.
// The source adapter enforces this ceiling across the entire daily run.
export const dailySourceRequestBudget = 100000;
export async function privateDir(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const s = await lstat(path);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    s.uid !== process.getuid() ||
    (s.mode & 0o777) !== 0o700 ||
    (await realpath(path)) !== resolve(path)
  )
    fail("daily_directory_unverified");
}
export async function readPrivate(path) {
  let f;
  try {
    f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const s = await f.stat();
    if (
      !s.isFile() ||
      s.nlink !== 1 ||
      s.uid !== process.getuid() ||
      (s.mode & 0o777) !== 0o600 ||
      s.size > 32 * 1024 * 1024
    )
      fail("daily_file_unverified");
    return JSON.parse(await f.readFile("utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  } finally {
    await f?.close();
  }
}
export async function writePrivate(dir, name, value) {
  const path = join(dir, ".pending-" + randomUUID());
  let f;
  try {
    f = await open(path, "wx", 0o600);
    await f.writeFile(JSON.stringify(value, null, 2) + "\n");
    await f.sync();
    await f.close();
    f = null;
    await rename(path, join(dir, name));
    const parent = await open(dir, "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  } finally {
    await f?.close();
    await unlink(path).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
export async function runDailyBackup({
  directory,
  binding = liveBinding,
  createPorts = createLiveRecordingPorts,
  signal = AbortSignal.timeout(60 * 60 * 1000),
  onProgress,
  lockLease,
  cycleOptions = {},
  onInventory,
} = {}) {
  let lock,
    locked = false,
    ports,
    runDir,
    journalOwned = false;
  const startedAt = new Date().toISOString();
  try {
    await privateDir(directory);
    if (lockLease !== undefined) await verifyDailyLease(lockLease, directory);
    else {
      try {
        lock = await open(join(directory, "daily.lock"), "wx", 0o600);
        locked = true;
      } catch (e) {
        if (e.code === "EEXIST") fail("daily_already_locked");
        throw e;
      }
      await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt }));
      await lock.sync();
    }
    journalOwned = true;
    await writePrivate(directory, "last-attempt.json", {
      state: "in_progress",
      pid: process.pid,
      startedAt,
      backupComplete: false,
    });
    ports = await createPorts(signal, {
      requestBudget: dailySourceRequestBudget,
    });
    if (signal.aborted) fail("daily_cancelled");
    const listed = await ports.source.inventory();
    onInventory?.(listed);
    if (signal.aborted) fail("daily_cancelled");
    runDir = await mkdtemp(join(directory, "run-"));
    await writePrivate(runDir, "inventory.json", listed.inventory);
    await writePrivate(runDir, "reconciliation.json", listed.reconciliation);
    await writePrivate(directory, "last-attempt.json", {
      state: "in_progress",
      pid: process.pid,
      startedAt,
      runDirectory: runDir,
      runId: listed.inventory.runId,
      backupComplete: false,
    });
    const result = await dailyRecordingCycle(listed.inventory, binding, ports, {
      ...cycleOptions,
      signal,
      onProgress,
    });
    const reconciliation = listed.reconciliation;
    if (
      reconciliation?.contract !== "recording-source-reconciliation/1" ||
      reconciliation.tenantId !== binding.tenantId ||
      reconciliation.sourceProjectRef !== binding.sourceProjectRef ||
      reconciliation.objects !== result.objects ||
      reconciliation.totalBytes !== result.totalBytes ||
      ![
        reconciliation.recordingRows,
        reconciliation.rowsWithoutStoragePointer,
        reconciliation.unreferencedObjects,
      ].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      !Array.isArray(reconciliation.missingObjectReferences)
    )
      fail("daily_reconciliation_unverified");
    result.sourceReconciliation = {
      ...(reconciliation.sourceBucket
        ? {
            sourceBucket: reconciliation.sourceBucket,
            preparedReferences: reconciliation.preparedReferences,
          }
        : {}),
      recordingRows: reconciliation.recordingRows,
      rowsWithoutStoragePointer: reconciliation.rowsWithoutStoragePointer,
      unreferencedObjects: reconciliation.unreferencedObjects,
      missingObjectReferences: reconciliation.missingObjectReferences.length,
    };
    result.sourceUsage = ports.source.usage?.() ?? null;
    await writePrivate(runDir, "result.json", result);
    // Publish last success only after the immutable remote manifest has verified.
    await writePrivate(directory, "last-success.json", result);
    await writePrivate(directory, "last-attempt.json", {
      state: "succeeded",
      startedAt,
      finishedAt: new Date().toISOString(),
      runId: result.runId,
      runDirectory: runDir,
      backupComplete: false,
    });
    return result;
  } catch (e) {
    const code = e instanceof RecordingBackupError ? e.code : "daily_unconfirmed";
    if (journalOwned)
      await writePrivate(directory, "last-attempt.json", {
        state: "failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        runDirectory: runDir ?? null,
        code,
        sourceUsage: ports?.source.usage?.() ?? null,
        backupComplete: false,
      }).catch(() => {});
    fail(code);
  } finally {
    ports?.close?.();
    await lock?.close();
    if (locked) await unlink(join(directory, "daily.lock"));
  }
}
export async function readDailyHealth(directory, now = Date.now()) {
  await privateDir(directory);
  const [lastSuccess, lastAttempt] = await Promise.all([
    readPrivate(join(directory, "last-success.json")),
    readPrivate(join(directory, "last-attempt.json")),
  ]);
  return {
    ...recordingBackupHealth({ lastSuccess, lastAttempt, now }),
    checkedAt: new Date(now).toISOString(),
    latestAttemptState: lastAttempt?.state ?? null,
    latestFailureCode: lastAttempt?.state === "failed" ? lastAttempt.code : null,
    requiresAwakeComputer: true,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let timer;
  try {
    if (
      process.argv.length !== 3 ||
      !["--run-drummonds-daily", "--health"].includes(process.argv[2])
    )
      fail("daily_arguments_invalid");
    const directory = fileURLToPath(
      new URL("../../.verification-results/recording-daily/", import.meta.url),
    );
    if (process.argv[2] === "--health")
      console.log(JSON.stringify(await readDailyHealth(directory), null, 2));
    else {
      timer = setInterval(
        () =>
          console.log(
            JSON.stringify({
              state: "daily_backup_in_progress",
              backupComplete: false,
            }),
          ),
        30000,
      );
      console.log(
        JSON.stringify(
          await runDailyBackup({
            directory,
            onProgress: (p) =>
              console.log(
                JSON.stringify({
                  state: "daily_backup_verifying",
                  ...p,
                  backupComplete: false,
                }),
              ),
          }),
          null,
          2,
        ),
      );
    }
  } catch (e) {
    console.error(
      JSON.stringify({
        state: "daily_backup_unconfirmed",
        code: e instanceof RecordingBackupError ? e.code : "daily_unconfirmed",
        backupComplete: false,
      }),
    );
    process.exitCode = 1;
  } finally {
    clearInterval(timer);
  }
}
