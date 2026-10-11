/** Deliberate one-file restore rehearsal. Reads AWS only; never accesses the
 * production database, Supabase credentials, or the Writer Keychain item. */
import { mkdir, lstat, realpath, mkdtemp, open, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { binding, loadRecordingCredential } from "./drummonds-recording-backup-access.mjs";
import { createRecordingS3 } from "./recording-backup-s3.mjs";
import { restoreRecordingFromManifest, RecordingBackupError } from "./recording-backup-core.mjs";
import { checkRecordingPlayback } from "./recording-playback-check.mjs";
const uuid = (v) =>
  typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const fail = (code) => {
  throw new RecordingBackupError(code);
};
export function parseRestoreArgs(args) {
  if (
    args.length !== 3 ||
    !["--restore-drummonds", "--check-drummonds"].includes(args[0]) ||
    !uuid(args[1]) ||
    !uuid(args[2])
  )
    fail("restore_arguments_invalid");
  return {
    runId: args[1],
    objectId: args[2],
    removeAudioAfterCheck: args[0] === "--check-drummonds",
  };
}
export async function runRecordingRestore({
  runId,
  objectId,
  binding: context,
  ports,
  evidenceRoot,
  decode = checkRecordingPlayback,
  removeAudioAfterCheck = false,
}) {
  let restored, directory;
  const started = Date.now();
  try {
    if (!uuid(runId) || !uuid(objectId)) fail("restore_arguments_invalid");
    evidenceRoot = resolve(evidenceRoot);
    await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
    const st = await lstat(evidenceRoot);
    if (
      (await realpath(evidenceRoot)) !== evidenceRoot ||
      !st.isDirectory() ||
      st.uid !== process.getuid() ||
      (st.mode & 0o777) !== 0o700
    )
      fail("restore_evidence_directory_unverified");
    const manifest = await ports.journal.loadManifest(runId);
    if (removeAudioAfterCheck) {
      const candidate = manifest?.objects?.find((r) => r?.source?.objectId === objectId);
      if (
        !Number.isSafeInteger(candidate?.source?.size) ||
        candidate.source.size <= 0 ||
        candidate.source.size > 8 * 1024 * 1024
      )
        fail("restore_check_selection_outside_limit");
    }
    restored = await restoreRecordingFromManifest(manifest, runId, objectId, context, ports);
    let playback;
    try {
      playback = await decode(restored);
    } catch (e) {
      playback = {
        state: "unconfirmed",
        code: e instanceof RecordingBackupError ? e.code : "playback_check_failed",
        listening: "not_verified",
      };
    }
    const rehearsalId = randomUUID();
    if (removeAudioAfterCheck) await rm(restored.directory, { recursive: true, force: true });
    const summary = {
      state: "restored_and_verified",
      rehearsalId,
      sourceInventoryRunId: runId,
      checkedAt: new Date().toISOString(),
      temporaryAudioRemoved: removeAudioAfterCheck,
      bytes: restored.bytes,
      recordingReferenceCount: restored.recordingIds.length,
      playback,
      databaseRestore: "not_verified",
      backupComplete: false,
      elapsedMs: Date.now() - started,
      privateEvidenceSaved: true,
    };
    directory = await mkdtemp(join(evidenceRoot, "recording-restore-"));
    const file = await open(join(directory, "evidence.json"), "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify({ summary, restored }, null, 2) + "\n");
      await file.sync();
    } finally {
      await file.close();
    }
    const dir = await open(directory, "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
    const parent = await open(evidenceRoot, "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
    restored = null;
    directory = null;
    return summary;
  } catch (e) {
    if (e instanceof RecordingBackupError) throw e;
    fail("restore_rehearsal_unconfirmed");
  } finally {
    if (restored) await rm(restored.directory, { recursive: true, force: true });
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let transport;
  try {
    const args = parseRestoreArgs(process.argv.slice(2));
    const credential = await loadRecordingCredential("Restore");
    transport = createRecordingS3(binding, {
      credentials: async () => ({
        accessKeyId: credential.accessKeyId,
        secretAccessKey: credential.secretAccessKey,
      }),
      expectedPrincipalArn: credential.principalArn,
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
    const summary = await runRecordingRestore({
      ...args,
      binding,
      ports: transport,
      evidenceRoot: fileURLToPath(new URL("../../.verification-results/", import.meta.url)),
    });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.playback.state !== "decoded") process.exitCode = 1;
  } catch (e) {
    console.error(
      JSON.stringify({
        state: "restore_unconfirmed",
        code: e instanceof RecordingBackupError ? e.code : "restore_failed",
        backupComplete: false,
      }),
    );
    process.exitCode = 1;
  } finally {
    transport?.close();
  }
}
