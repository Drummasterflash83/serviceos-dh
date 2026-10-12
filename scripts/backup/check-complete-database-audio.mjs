/** Join the retained complete database snapshot to a later verified AWS manifest.
 * Only the scoped Restore identity is used; no production/provider requests. */
import { readFile, open, lstat, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { binding, loadRecordingCredential } from "./drummonds-recording-backup-access.mjs";
import { createRecordingS3 } from "./recording-backup-s3.mjs";
import { restoreRecordingFromManifest, RecordingBackupError } from "./recording-backup-core.mjs";
import { checkRecordingPlayback } from "./recording-playback-check.mjs";
import { reconcileArchivedRecordingCoverage } from "./recording-database-recovery.mjs";
const root = ".verification-results/full-database-recording-links-2026-10-12";
const archiveSha = "bdb6be1f2cb934247949d6443305550888e6b4e62f5c55dac419a432616bd3db";
const need = (ok, code) => {
  if (!ok) throw new RecordingBackupError(code);
};
async function readPrivate(path) {
  const st = await lstat(path);
  need(
    st.isFile() &&
      !st.isSymbolicLink() &&
      st.uid === process.getuid() &&
      (st.mode & 0o077) === 0 &&
      st.size < 32 * 1024 * 1024,
    "private_recovery_file_invalid",
  );
  return JSON.parse(await readFile(path, "utf8"));
}
async function saveNew(name, value) {
  const f = await open(root + "/" + name, "wx", 0o600);
  try {
    await f.writeFile(JSON.stringify(value, null, 2) + "\n");
    await f.sync();
  } finally {
    await f.close();
  }
}
let ports,
  restored,
  started = false;
try {
  need(
    process.argv.slice(2).join(" ") === "--check-complete-archive",
    "complete_audio_arguments_invalid",
  );
  const prior = await readPrivate(root + "/restore-native-comparison-report.json");
  const snapshot = await readPrivate(root + "/restored-recording-links.json");
  const success = await readPrivate(".verification-results/recording-daily/last-success.json");
  const attempt = await readPrivate(".verification-results/recording-daily/last-attempt.json");
  need(
    prior.sourceArchive?.sha256 === archiveSha &&
      prior.containerRemoved === true &&
      prior.recordingLinksExported === true &&
      prior.allInventoriedPhysicalTablesCaptured === true &&
      prior.nativeDataComparison?.state === "all_archived_copy_rows_and_sequences_match" &&
      prior.networkSupplementComparison?.state === "all_archived_copy_rows_and_sequences_match" &&
      prior.tableCatalogMatched === true &&
      prior.extensionVersionsMatched === true &&
      prior.sourceSnapshot?.observedAt === snapshot.databaseSnapshotAt,
    "complete_database_restore_unverified",
  );
  need(
    success.state === "inventory_verified" &&
      attempt.state === "succeeded" &&
      attempt.runId === success.runId &&
      Date.parse(success.inventoryObservedAt) >= Date.parse(snapshot.databaseSnapshotAt),
    "fresh_file_backup_required",
  );
  await saveNew("combined-later-audio-started.json", {
    at: new Date().toISOString(),
    fileRunId: success.runId,
  });
  started = true;
  const credential = await loadRecordingCredential("Restore");
  ports = createRecordingS3(binding, {
    credentials: async () => credential,
    expectedPrincipalArn: credential.principalArn,
    signal: AbortSignal.timeout(180000),
  });
  const manifest = await ports.journal.loadManifest(success.runId);
  need(
    manifest.inventoryObservedAt === success.inventoryObservedAt &&
      manifest.inventorySha256 === success.inventorySha256,
    "file_inventory_checkpoint_changed",
  );
  const coverage = reconcileArchivedRecordingCoverage(snapshot, manifest, binding);
  // Prefer a recording absent from the earlier database snapshot to exercise the
  // newly needed file. Fall back explicitly only if no bounded sample qualifies.
  const older = await readPrivate(
    ".verification-results/production-database-export-2026-10-12/restored-recording-links.json",
  );
  const oldIds = new Set(older.rows.map((r) => r.id));
  const eligible = snapshot.rows
    .filter((r) => r.callCount > 0 && r.storageBytes > 0 && r.storageBytes <= 8 * 1024 * 1024)
    .sort((a, b) => a.id.localeCompare(b.id));
  const candidate = eligible.find((r) => !oldIds.has(r.id)) ?? eligible[0];
  need(candidate, "complete_archive_sample_unavailable");
  restored = await restoreRecordingFromManifest(
    manifest,
    success.runId,
    candidate.objectId,
    binding,
    ports,
  );
  need(
    restored.recordingIds.includes(candidate.id) &&
      restored.source.sourceKey === candidate.storagePath &&
      restored.bytes === candidate.storageBytes,
    "archive_sample_reference_conflict",
  );
  const playback = await checkRecordingPlayback(restored);
  need(playback.state === "decoded", "archive_sample_decode_failed");
  const directory = restored.directory;
  await rm(directory, { recursive: true, force: true });
  restored = null;
  let removed = false;
  try {
    await lstat(directory);
  } catch (e) {
    if (e.code === "ENOENT") removed = true;
    else throw e;
  }
  need(removed, "temporary_audio_removal_unconfirmed");
  const report = {
    contract: "complete-database-later-audio-recovery/1",
    state: "archived_references_covered_and_sample_decoded",
    checkedAt: new Date().toISOString(),
    sourceArchiveSha256: archiveSha,
    fileInventoryRunId: success.runId,
    coverage,
    sample: {
      bytes: candidate.storageBytes,
      recordedDurationSeconds: candidate.durationSeconds,
      decodedDurationSeconds: playback.durationSeconds,
      absentFromEarlierDatabase: !oldIds.has(candidate.id),
      linkedCalls: candidate.callCount,
      linkedTranscripts: candidate.transcriptCount,
      listening: "not_verified",
    },
    databaseLinksSha256: createHash("sha256")
      .update(await readFile(root + "/restored-recording-links.json"))
      .digest("hex"),
    temporaryAudioRemoved: true,
    sourceProviderRequests: 0,
    writerIdentityUsed: false,
    productionWrites: false,
    fullServiceRecoveryVerified: false,
  };
  await saveNew("combined-later-audio-report.json", report);
  console.log(JSON.stringify(report));
} catch (e) {
  const report = {
    state: "complete_database_audio_unverified",
    code: e instanceof RecordingBackupError ? e.code : "recovery_unconfirmed",
  };
  if (started) await saveNew("combined-later-audio-failure.json", report).catch(() => {});
  console.error(JSON.stringify(report));
  process.exitCode = 1;
} finally {
  if (restored) await rm(restored.directory, { recursive: true, force: true });
  ports?.close();
}
