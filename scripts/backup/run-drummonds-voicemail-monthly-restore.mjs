/** Monthly AWS-only voicemail rehearsal; existing phone restore stays independent. */
import { constants } from "node:fs";
import { open, mkdir, lstat, realpath, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { binding, loadRecordingCredential } from "./drummonds-recording-backup-access.mjs";
import { createRecordingS3 } from "./recording-backup-s3.mjs";
import { RecordingBackupError } from "./recording-backup-core.mjs";
import { withDailyLease } from "./communication-backup-lock.mjs";
import { checkMonthlyPair, monthlyRestoreHealth } from "./voicemail-monthly-restore.mjs";
const fail = (code) => {
  throw new RecordingBackupError(code);
};
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
    fail("monthly_directory_unverified");
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
      fail("monthly_file_unverified");
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

export async function createMonthlyRestorePorts(signal, load = loadRecordingCredential) {
  const key = await load("Restore");
  return createRecordingS3(binding, {
    credentials: async () => ({
      accessKeyId: key.accessKeyId,
      secretAccessKey: key.secretAccessKey,
    }),
    expectedPrincipalArn: key.principalArn,
    signal,
  });
}
export async function runMonthlyVoicemail({
  root,
  healthOnly = false,
  createRestorePorts = createMonthlyRestorePorts,
  context = binding,
  now = Date.now,
  decode,
} = {}) {
  root = resolve(root);
  const directory = join(root, "voicemail-monthly-restore");
  await privateDir(directory);
  const state = {
    readSuccess: () => readPrivate(join(directory, "last-success.json")),
    writeSuccess: (value) => writePrivate(directory, "last-success.json", value),
    writeAttempt: (value) => writePrivate(directory, "last-attempt.json", value),
  };
  if (healthOnly)
    return monthlyRestoreHealth(
      await state.readSuccess(),
      await readPrivate(join(directory, "last-attempt.json")),
      now(),
    );
  // Own lock is acquired before credential loading. Immutable AWS versions allow
  // safe read-only overlap with the independent daily copy runner.
  return withDailyLease(directory, async () => {
    const aggregate = await readPrivate(join(root, "communication-daily", "last-success.json"));
    return checkMonthlyPair({
      aggregate,
      context,
      state,
      createRestorePorts,
      now,
      ...(decode ? { decode } : {}),
    });
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3 || !["--check-drummonds", "--health"].includes(process.argv[2]))
      fail("monthly_arguments_invalid");
    const root = fileURLToPath(new URL("../../.verification-results/", import.meta.url));
    const result = await runMonthlyVoicemail({ root, healthOnly: process.argv[2] === "--health" });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "sample_restore_verified") process.exitCode = 1;
  } catch (e) {
    console.error(
      JSON.stringify({
        state: "failed",
        code: e instanceof RecordingBackupError ? e.code : "monthly_restore_unconfirmed",
      }),
    );
    process.exitCode = 1;
  }
}
