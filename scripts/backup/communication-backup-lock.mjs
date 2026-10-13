/** A process-local capability backed by the original daily.lock. */
import { open, lstat, realpath, mkdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { binding } from "./drummonds-recording-backup-access.mjs";
import { RecordingBackupError } from "./recording-backup-core.mjs";
const leases = new WeakMap();
const check = (v, c) => {
  if (!v) throw new RecordingBackupError(c);
};
export async function verifyDailyLease(lease, directory) {
  const bound = leases.get(lease);
  check(bound?.directory === resolve(directory), "daily_lease_invalid");
  const current = await lstat(join(directory, "daily.lock"));
  check(
    current.isFile() &&
      !current.isSymbolicLink() &&
      current.dev === bound.dev &&
      current.ino === bound.ino,
    "daily_lease_changed",
  );
}
export async function withDailyLease(directory, work) {
  directory = resolve(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  check(
    info.isDirectory() &&
      !info.isSymbolicLink() &&
      info.uid === process.getuid() &&
      (info.mode & 0o777) === 0o700 &&
      (await realpath(directory)) === directory,
    "daily_directory_unverified",
  );
  let file, lease;
  try {
    try {
      file = await open(join(directory, "daily.lock"), "wx", 0o600);
    } catch (e) {
      if (e.code === "EEXIST") throw new RecordingBackupError("daily_already_locked");
      throw e;
    }
    await file.writeFile(
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        scope: "communication-backup",
      }),
    );
    await file.sync();
    const stat = await file.stat();
    lease = Object.freeze({});
    leases.set(lease, { directory, dev: stat.dev, ino: stat.ino });
    return await work(lease);
  } finally {
    if (file) {
      try {
        if (lease) await verifyDailyLease(lease, directory);
        await unlink(join(directory, "daily.lock"));
      } finally {
        if (lease) leases.delete(lease);
        await file.close();
      }
    }
  }
}

// Both production manual entry points and the daily supervisor use this path.
// Generic protocol fixtures on other destinations retain their own local locks.
export const productionCommunicationLockDirectory = fileURLToPath(
  new URL("../../.verification-results/recording-daily/", import.meta.url),
);
export async function withProductionCommunicationLease(context, lease, work) {
  if (context.accountId !== binding.accountId || context.bucket !== binding.bucket)
    return work(undefined);
  if (lease !== undefined) {
    await verifyDailyLease(lease, productionCommunicationLockDirectory);
    return work(lease);
  }
  return withDailyLease(productionCommunicationLockDirectory, work);
}
