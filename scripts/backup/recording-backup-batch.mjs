/** Bounded runner for a privately persisted inventory. A checkpoint is progress,
 * not coverage: finalizeRecordingInventory must verify all receipts separately. */
import { createHash } from "node:crypto";
import { backupRecording, recordingContext, recordingIdentity, RecordingBackupError } from "./recording-backup-core.mjs";

const requireValue = (ok, code) => { if (!ok) throw new RecordingBackupError(code); };
export async function copyRecordingBatch(input, binding, ports, options = {}) {
  const context = recordingContext(binding), now = ports.now ?? Date.now;
  requireValue(input?.contract === "recording-inventory/1" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.runId ?? "") &&
    input.tenantId === context.tenantId && input.sourceProjectRef === context.sourceProjectRef &&
    input.listingComplete === true && input.sourceSnapshot === "non_atomic" &&
    Number.isFinite(Date.parse(input.observedAt)) && Date.parse(input.observedAt) <= now() &&
    Array.isArray(input.objects) && input.objects.length > 0 && input.objects.length <= 10000,
  "batch_inventory_unverified");
  const objects = input.objects.map(recordingIdentity).sort((a,b) => a.objectId.localeCompare(b.objectId));
  requireValue(objects.every(e => e.tenantId === context.tenantId &&
    e.sourceKey.startsWith(`${context.tenantId}/`)) &&
    new Set(objects.map(e => e.objectId)).size === objects.length &&
    new Set(objects.map(e => e.sourceKey)).size === objects.length, "batch_inventory_unverified");
  const inventory = { contract: input.contract, runId: input.runId, tenantId: context.tenantId,
    sourceProjectRef: context.sourceProjectRef, observedAt: input.observedAt,
    listingComplete: true, sourceSnapshot: "non_atomic", objects };
  const inventorySha256 = createHash("sha256").update(JSON.stringify(inventory)).digest("hex");
  const { maxObjects = 25, maxBytes = 32 * 1024 * 1024, checkpoint, saveCheckpoint, signal } = options;
  requireValue(Number.isSafeInteger(maxObjects) && maxObjects > 0 && maxObjects <= 100 &&
    Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 256 * 1024 * 1024 &&
    typeof saveCheckpoint === "function", "batch_options_invalid");
  let nextIndex = 0;
  if (checkpoint !== undefined) {
    requireValue(checkpoint?.contract === "recording-batch-checkpoint/1" &&
      checkpoint.runId === inventory.runId && checkpoint.inventorySha256 === inventorySha256 &&
      JSON.stringify(recordingContext(checkpoint.destination)) === JSON.stringify(context) &&
      Number.isSafeInteger(checkpoint.nextIndex) && checkpoint.nextIndex >= 0 &&
      checkpoint.nextIndex <= objects.length, "batch_checkpoint_conflict");
    nextIndex = checkpoint.nextIndex;
  }
  const startIndex = nextIndex;
  let bytesVerified = 0, recoveredObjects = 0;
  while (nextIndex < objects.length && nextIndex - startIndex < maxObjects) {
    requireValue(!signal?.aborted, "batch_cancelled");
    const entry = objects[nextIndex];
    if (bytesVerified + entry.size > maxBytes) {
      requireValue(nextIndex > startIndex, "batch_item_exceeds_byte_budget");
      break;
    }
    const result = await backupRecording(entry, context, ports);
    const candidate = { contract: "recording-batch-checkpoint/1", runId: inventory.runId,
      inventorySha256, destination: context, nextIndex: nextIndex + 1 };
    try { await saveCheckpoint(structuredClone(candidate)); }
    catch { throw new RecordingBackupError("batch_checkpoint_unconfirmed"); }
    nextIndex++;
    bytesVerified += entry.size;
    if (result.recovered) recoveredObjects++;
  }
  return { state: nextIndex === objects.length ? "copy_pass_finished" : "batch_verified",
    runId: inventory.runId, inventorySha256, nextIndex, objectsInInventory: objects.length,
    objectsVerifiedThisBatch: nextIndex - startIndex, bytesVerifiedThisBatch: bytesVerified,
    recoveredObjects, backupComplete: false, nextStep: nextIndex === objects.length
      ? "verify_whole_inventory_manifest" : "resume_from_private_checkpoint" };
}
