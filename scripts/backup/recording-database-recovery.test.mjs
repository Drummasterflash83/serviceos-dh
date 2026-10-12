import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileRestoredRecordings } from './recording-database-recovery.mjs';
import { binding } from './drummonds-recording-backup-access.mjs';
const id = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
function fixture() {
  const rows = [1,2].map(n => ({ id:id(n),tenantId:binding.tenantId,objectId:id(n+10),
    storagePath:`${binding.tenantId}/synthetic-${n}.wav`,storageBytes:100+n,storageVersion:'v1' }));
  const manifest = { inventoryObservedAt:'2026-10-11T10:00:00Z', objects:rows.map(r=>({source:{
    tenantId:r.tenantId,objectId:r.objectId,sourceKey:r.storagePath,size:r.storageBytes,
    sourceVersion:JSON.stringify(['v1','etag','2026-10-11T10:00:00Z']),recordingIds:[r.id]}})) };
  return { snapshot:{tenantId:binding.tenantId,sourceProjectRef:binding.sourceProjectRef,
    databaseSnapshotAt:'2026-10-12T00:00:00Z',rows}, manifest };
}
test('matches two distinct snapshots without claiming atomicity or all-byte verification',()=>{
  const {snapshot,manifest}=fixture();
  manifest.objects.push({source:{...manifest.objects[0].source,objectId:id(99),
    sourceKey:`${binding.tenantId}/unreferenced.wav`,recordingIds:[]}});
  const result=reconcileRestoredRecordings(snapshot,manifest,binding);
  assert.equal(result.recordingRows,2);assert.equal(result.retainedUnreferencedObjects,1);
  assert.equal(result.atomicDatabaseFileSnapshot,false);assert.equal(result.allObjectBytesRechecked,false);
});
test('rejects a valid recording id paired with the other recording file',()=>{
  const {snapshot,manifest}=fixture();
  Object.assign(snapshot.rows[0],{objectId:snapshot.rows[1].objectId,storagePath:snapshot.rows[1].storagePath,storageBytes:snapshot.rows[1].storageBytes});
  assert.throws(()=>reconcileRestoredRecordings(snapshot,manifest,binding),/restored_recording_backup_mismatch/);
});
test('rejects changed version, size, tenant and duplicate identities',()=>{
  for(const mutate of [f=>f.snapshot.rows[0].storageVersion='v2',f=>f.snapshot.rows[0].storageBytes++,
    f=>f.snapshot.rows[0].tenantId=id(50),f=>f.snapshot.rows.push({...f.snapshot.rows[0]})]){
    const f=fixture();mutate(f);assert.throws(()=>reconcileRestoredRecordings(f.snapshot,f.manifest,binding));
  }
});
test('refuses coverage claims if backup contains recording references missing from restored DB',()=>{
  const f=fixture();f.snapshot.rows.pop();
  assert.throws(()=>reconcileRestoredRecordings(f.snapshot,f.manifest,binding),/backup_recording_relationship_differs/);
});
test('rejects one recording claimed by two backup objects',()=>{
  const f=fixture();f.manifest.objects[1].source.recordingIds.push(f.snapshot.rows[0].id);
  assert.throws(()=>reconcileRestoredRecordings(f.snapshot,f.manifest,binding),/backup_recording_identity_conflict/);
});
