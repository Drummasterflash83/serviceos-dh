/** Relate a restored database snapshot to a separately verified file manifest.
 * This checks references and versions, not every object's current AWS bytes.
 */
import { recordingIdentity, recordingContext, RecordingBackupError } from './recording-backup-core.mjs';
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const fail = code => { throw new RecordingBackupError(code); };
export function reconcileRestoredRecordings(snapshot, manifest, binding) {
  const context = recordingContext(binding);
  if (snapshot?.tenantId !== context.tenantId || snapshot?.sourceProjectRef !== context.sourceProjectRef
    || !Number.isFinite(Date.parse(snapshot?.databaseSnapshotAt))
    || !Array.isArray(snapshot?.rows) || !snapshot.rows.length || snapshot.rows.length > 10000
    || !Array.isArray(manifest?.objects) || !manifest.objects.length || manifest.objects.length > 10000)
    fail('database_recording_snapshot_unverified');
  const objects = new Map(), keys = new Set(), recordingIds = new Set();
  for (const receipt of manifest.objects) {
    const entry = recordingIdentity(receipt.source);
    if (entry.tenantId !== context.tenantId || !entry.sourceKey.startsWith(context.tenantId + '/')
      || objects.has(entry.objectId) || keys.has(entry.sourceKey)) fail('backup_object_identity_conflict');
    for (const id of entry.recordingIds) {
      if (recordingIds.has(id)) fail('backup_recording_identity_conflict');
      recordingIds.add(id);
    }
    objects.set(entry.objectId, entry); keys.add(entry.sourceKey);
  }
  const actualIds = new Set(), referencedObjects = new Set();
  for (const row of snapshot.rows) {
    if (!uuid(row.id) || actualIds.has(row.id) || row.tenantId !== context.tenantId
      || !uuid(row.objectId) || typeof row.storagePath !== 'string'
      || !row.storagePath.startsWith(context.tenantId + '/')
      || !Number.isSafeInteger(row.storageBytes) || row.storageBytes < 0
      || typeof row.storageVersion !== 'string' || !row.storageVersion.length)
      fail('restored_recording_identity_unverified');
    actualIds.add(row.id);
    const entry = objects.get(row.objectId);
    if (!entry || entry.sourceKey !== row.storagePath || entry.size !== row.storageBytes
      || !entry.recordingIds.includes(row.id)) fail('restored_recording_backup_mismatch');
    let version;
    try { version = JSON.parse(entry.sourceVersion); } catch { fail('backup_source_version_invalid'); }
    if (!Array.isArray(version) || version.length !== 3 || version[0] !== row.storageVersion)
      fail('restored_storage_version_mismatch');
    referencedObjects.add(row.objectId);
  }
  if (actualIds.size !== recordingIds.size || [...recordingIds].some(id => !actualIds.has(id)))
    fail('backup_recording_relationship_differs');
  return { state: 'all_recording_references_matched', recordingRows: actualIds.size,
    referencedObjects: referencedObjects.size, manifestObjects: objects.size,
    retainedUnreferencedObjects: objects.size - referencedObjects.size,
    databaseSnapshotAt: snapshot.databaseSnapshotAt,
    fileInventoryObservedAt: manifest.inventoryObservedAt,
    atomicDatabaseFileSnapshot: false, allObjectBytesRechecked: false };
}
