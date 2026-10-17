/** Bind one fresh daily database restore to a later independent recording backup.
 * Reads only the scoped Restore identity; downloads and decodes one bounded file.
 * The detailed database rows and selected object stay in ignored private storage.
 */
import { createHash } from "node:crypto";
import { readFile, lstat, open, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { binding, loadRecordingCredential } from "./drummonds-recording-backup-access.mjs";
import { createRecordingS3 } from "./recording-backup-s3.mjs";
import { restoreRecordingFromManifest, RecordingBackupError } from "./recording-backup-core.mjs";
import { checkRecordingPlayback } from "./recording-playback-check.mjs";
import { reconcileArchivedRecordingCoverage } from "./recording-database-recovery.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const [mode, sourceArg] = process.argv.slice(2);
const need = (ok, code) => { if (!ok) throw new RecordingBackupError(code); };
async function privateJson(path) {
  const st = await lstat(path);
  need(st.isFile() && !st.isSymbolicLink() && st.uid === process.getuid() &&
    (st.mode & 0o077) === 0 && st.size > 0 && st.size < 32 * 1024 * 1024,
  "current_audio_private_input_invalid");
  return JSON.parse(await readFile(path, "utf8"));
}
async function saveNew(path, value) {
  const f = await open(path, "wx", 0o600);
  try { await f.writeFile(JSON.stringify(value, null, 2) + "\n"); await f.sync(); }
  finally { await f.close(); }
}
let ports, restored;
try {
  need(mode === "--current-daily" && process.argv.length === 4 &&
    /^\.verification-results\/production-database-daily-20\d{6}-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(sourceArg ?? ""),
  "current_audio_mode_invalid");
  const source = resolve(repo, sourceArg);
  need(source.startsWith(join(repo, ".verification-results") + "/"),
    "current_audio_source_scope_invalid");
  const exported = await privateJson(join(source, "report.json"));
  const restoredDb = await privateJson(join(source, "restore-native-comparison-report.json"));
  const snapshot = await privateJson(join(source, "restored-recording-links.json"));
  const success = await privateJson(join(repo, ".verification-results/recording-daily/last-success.json"));
  const attempt = await privateJson(join(repo, ".verification-results/recording-daily/last-attempt.json"));
  need(exported.project === "tgbnakbxwcqjeimygroz" &&
    exported.state === "export_complete_restore_unverified" &&
    restoredDb.state === "native_archive_restored_full_recovery_unverified" &&
    restoredDb.sourceArchive?.sha256 === exported.archive?.sha256 &&
    restoredDb.containerRemoved === true &&
    restoredDb.allInventoriedPhysicalTablesCaptured === true &&
    restoredDb.nativeDataComparison?.state === "all_archived_copy_rows_and_sequences_match" &&
    restoredDb.networkSupplementComparison?.state === "all_archived_copy_rows_and_sequences_match" &&
    restoredDb.tableCatalogMatched === true &&
    restoredDb.extensionVersionsMatched === true &&
    restoredDb.recordingLinksExported === true &&
    restoredDb.sourceSnapshot?.observedAt === snapshot.databaseSnapshotAt,
  "current_audio_database_restore_unverified");
  need(success.state === "inventory_verified" && attempt.state === "succeeded" &&
    attempt.runId === success.runId &&
    Date.parse(success.inventoryObservedAt) >= Date.parse(snapshot.databaseSnapshotAt),
  "current_audio_later_backup_unverified");
  const credential = await loadRecordingCredential("Restore");
  ports = createRecordingS3(binding, { credentials: async () => credential,
    expectedPrincipalArn: credential.principalArn, signal: AbortSignal.timeout(180000) });
  const manifest = await ports.journal.loadManifest(success.runId);
  need(manifest.inventoryObservedAt === success.inventoryObservedAt &&
    manifest.inventorySha256 === success.inventorySha256,
  "current_audio_manifest_changed");
  const coverage = reconcileArchivedRecordingCoverage(snapshot, manifest, binding);
  const candidate = [...snapshot.rows]
    .filter(row => row.callCount > 0 && row.transcriptCount > 0 &&
      row.storageBytes > 0 && row.storageBytes <= 8 * 1024 * 1024)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  need(candidate, "current_audio_sample_unavailable");
  restored = await restoreRecordingFromManifest(
    manifest, success.runId, candidate.objectId, binding, ports);
  need(restored.recordingIds.includes(candidate.id) &&
    restored.source.sourceKey === candidate.storagePath &&
    restored.bytes === candidate.storageBytes,
  "current_audio_sample_reference_conflict");
  const playback = await checkRecordingPlayback(restored);
  need(playback.state === "decoded", "current_audio_sample_decode_failed");
  const directory = restored.directory;
  const result = {
    version: "learn-build01-current-database-audio/1",
    state: "archived_references_covered_and_sample_decoded",
    checkedAt: new Date().toISOString(),
    databaseArchiveSha256: exported.archive.sha256,
    databaseSnapshotAt: snapshot.databaseSnapshotAt,
    fileInventoryObservedAt: success.inventoryObservedAt,
    fileBackupRunId: success.runId,
    databaseLinksSha256: createHash("sha256").update(
      await readFile(join(source, "restored-recording-links.json"))).digest("hex"),
    coverage,
    sample: { bytes: restored.bytes, sha256: restored.sha256,
      linkedCalls: candidate.callCount, linkedTranscripts: candidate.transcriptCount,
      recordedDurationSeconds: candidate.durationSeconds,
      decodedDurationSeconds: playback.durationSeconds },
    sourceProviderRequests: 0, writerIdentityUsed: false,
    productionWrites: false, listening: "not_verified",
    limitations: "The later file inventory is non-atomic with the database point. Every archived recording reference/version is covered; one downloaded file was decoded. This does not recheck every file byte, prove source capture completeness or restore the whole application."
  };
  await rm(directory, { recursive: true, force: true }); restored = null;
  try { await lstat(directory); throw new RecordingBackupError("current_audio_temp_cleanup_unverified"); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  await saveNew(join(source, "current-audio-coverage-report.json"), result);
  console.log(JSON.stringify({ ...result, sample: { ...result.sample } }));
} catch (error) {
  console.error(JSON.stringify({ state: "current_audio_coverage_unverified",
    code: error instanceof RecordingBackupError ? error.code : "current_audio_run_unconfirmed" }));
  process.exitCode = 1;
} finally {
  if (restored) await rm(restored.directory, { recursive: true, force: true });
  ports?.close();
}
