/** Read-only AWS restore joined to private metadata from the offline database.
 * No source provider access, Writer key, account creation or data publication.
 */
import { readFile, writeFile, open, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { binding, loadRecordingCredential } from './drummonds-recording-backup-access.mjs';
import { createRecordingS3 } from './recording-backup-s3.mjs';
import { restoreRecordingFromManifest, RecordingBackupError } from './recording-backup-core.mjs';
import { checkRecordingPlayback } from './recording-playback-check.mjs';
import { reconcileRestoredRecordings } from './recording-database-recovery.mjs';

const root = '.verification-results/production-database-export-2026-10-12';
const runId = '2bec8c68-0ef0-4610-ad6c-8d5156f392ed';
let ports, restored;
const summary = { version: 'combined-database-audio-recovery/1',
  state: 'unverified', sourceProviderRequests: 0, backupComplete: false,
  fileInventoryRunId: runId, listening: 'not_verified' };
try {
  if (process.argv.slice(2).join(' ') !== '--check-existing-restored-database')
    throw new RecordingBackupError('combined_restore_arguments_invalid');
  const marker = await open(root + '/combined-audio-v2-started', 'wx', 0o600); await marker.close();
  const raw = await readFile(root + '/restored-recording-links.json');
  const snapshot = JSON.parse(raw);
  summary.databaseLinksSha256 = createHash('sha256').update(raw).digest('hex');
  // Resume the completed offline database stage, without silently swapping
  // metadata or creating another database merely to retry the audio check.
  const prior = JSON.parse(await readFile(root + '/combined-audio-failure.json'));
  if (prior.failure !== 'combined_restore_sample_unavailable'
    || prior.databaseLinksSha256 !== summary.databaseLinksSha256)
    throw new RecordingBackupError('combined_restore_checkpoint_changed');
  const credential = await loadRecordingCredential('Restore');
  ports = createRecordingS3(binding, { credentials: async () => credential,
    expectedPrincipalArn: credential.principalArn, signal: AbortSignal.timeout(180000) });
  const manifest = await ports.journal.loadManifest(runId);
  summary.references = reconcileRestoredRecordings(snapshot, manifest, binding);
  const candidate = [...snapshot.rows].sort((a, b) => a.objectId.localeCompare(b.objectId))
    .find(row => row.callCount > 0 && row.transcriptCount > 0 && row.storageBytes > 0
      && row.storageBytes <= 8 * 1024 * 1024);
  if (!candidate) throw new RecordingBackupError('combined_restore_sample_unavailable');
  // This validates the entire manifest's contract/digest and the selected S3
  // version, encryption, retention and downloaded bytes before decoding.
  restored = await restoreRecordingFromManifest(manifest, runId, candidate.objectId, binding, ports);
  if (!restored.recordingIds.includes(candidate.id) || restored.source.sourceKey !== candidate.storagePath
    || restored.bytes !== candidate.storageBytes)
    throw new RecordingBackupError('combined_restore_sample_reference_conflict');
  const playback = await checkRecordingPlayback(restored);
  if (playback.state !== 'decoded') throw new RecordingBackupError('combined_restore_decode_failed');
  summary.sample = { bytes: restored.bytes, sha256: restored.sha256,
    recordingReferenceCount: restored.recordingIds.length, linkedCallCount: candidate.callCount,
    linkedTranscriptCount: candidate.transcriptCount, recordedDurationSeconds: candidate.durationSeconds,
    decodedDurationSeconds: playback.durationSeconds,
    durationDifferenceSeconds: Number.isFinite(candidate.durationSeconds)
      ? Math.abs(playback.durationSeconds - candidate.durationSeconds) : null, playback };
  summary.databaseStageResumedFromVerifiedMetadata = true;
  await writeFile(root + '/combined-audio-private-selection.json', JSON.stringify({
    recordingId: candidate.id, objectId: candidate.objectId,
    storagePath: candidate.storagePath, manifestRunId: runId, sha256: restored.sha256,
  }, null, 2), { flag: 'wx', mode: 0o600 });
  await rm(restored.directory, { recursive: true, force: true }); restored = null;
  summary.temporaryAudioRemoved = true;
  summary.state = 'references_matched_and_one_linked_backup_recording_decoded';
  summary.checkedAt = new Date().toISOString();
  await writeFile(root + '/combined-audio-report.json', JSON.stringify(summary, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(summary));
} catch (error) {
  summary.failure = error instanceof RecordingBackupError ? error.code : 'combined_restore_unconfirmed';
  await writeFile(root + '/combined-audio-v2-failure.json', JSON.stringify(summary, null, 2), { flag: 'wx', mode: 0o600 }).catch(() => {});
  console.error(JSON.stringify({ state: 'combined_restore_unconfirmed', code: summary.failure }));
  process.exitCode = 1;
} finally {
  if (restored) await rm(restored.directory, { recursive: true, force: true });
  ports?.close();
}
