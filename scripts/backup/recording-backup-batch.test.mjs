import { test } from "node:test";
import assert from "node:assert/strict";
import { copyRecordingBatch } from "./recording-backup-batch.mjs";
import { finalizeRecordingInventory } from "./recording-backup-core.mjs";
import { fixture as sdkFixture, context, time } from "./test-support/s3-fixture.mjs";
const fixture = () => {
  const f = sdkFixture();
  f.entry.sourceKey = `${context.tenantId}/PRIVATE/call.wav`;
  return f;
};
const inventory = (f) => ({ contract: "recording-inventory/1",
  runId: "00000000-0000-4000-8000-000000000010", tenantId: context.tenantId,
  sourceProjectRef: context.sourceProjectRef, observedAt: new Date(time).toISOString(),
  listingComplete: true, sourceSnapshot: "non_atomic", objects: [f.entry] });
test("actual SDK copy resumes after lost checkpoint acknowledgement without repeating audio upload", async () => {
  const f = fixture();
  try {
    const input = inventory(f);
    await assert.rejects(copyRecordingBatch(input, context, f, { saveCheckpoint: async () => {
      throw Error("PRIVATE journal unavailable");
    }}), { code: "batch_checkpoint_unconfirmed" });
    assert.equal(f.calls.filter(c => c.method === "PUT").length, 2);
    let checkpoint;
    const result = await copyRecordingBatch(input, context, f, { saveCheckpoint: async c => { checkpoint = c; } });
    assert.equal(result.recoveredObjects, 1);
    assert.equal(result.backupComplete, false);
    assert.equal(result.state, "copy_pass_finished");
    assert.equal(f.calls.filter(c => c.method === "PUT").length, 2);
    const done = await copyRecordingBatch(input, context, f, { checkpoint, saveCheckpoint: async () => {} });
    assert.equal(done.objectsVerifiedThisBatch, 0);
    const final = await finalizeRecordingInventory(input, context, f);
    assert.equal(final.manifest.inventorySha256, checkpoint.inventorySha256);
    assert.equal(final.manifest.objects.length, 1);
  } finally { f.close(); }
});
test("inventory scope, bounds and aborted batches refuse before network work", async () => {
  const f = fixture();
  try {
    const input = inventory(f), opts = { saveCheckpoint: async () => {} };
    await assert.rejects(copyRecordingBatch({ ...input, sourceProjectRef: "x".repeat(20) }, context, f, opts),
      { code: "batch_inventory_unverified" });
    await assert.rejects(copyRecordingBatch(input, context, f, { ...opts, maxBytes: 1 }),
      { code: "batch_item_exceeds_byte_budget" });
    await assert.rejects(copyRecordingBatch(input, context, f, { ...opts, signal: AbortSignal.abort() }),
      { code: "batch_cancelled" });
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});
test("a checkpoint cannot silently switch inventory or destination", async () => {
  const f = fixture();
  try {
    let checkpoint;
    await copyRecordingBatch(inventory(f), context, f, { saveCheckpoint: async c => { checkpoint = c; } });
    const calls = f.calls.length;
    await assert.rejects(copyRecordingBatch({ ...inventory(f), objects: [{ ...f.entry, size: 0 }] }, context, f,
      { checkpoint, saveCheckpoint: async () => {} }), { code: "batch_checkpoint_conflict" });
    await assert.rejects(copyRecordingBatch(inventory(f), { ...context, bucket: "another-bucket" }, f,
      { checkpoint, saveCheckpoint: async () => {} }), { code: "batch_checkpoint_conflict" });
    assert.equal(f.calls.length, calls);
  } finally { f.close(); }
});
test("successive object and byte bounded batches retain all three objects before finalization", async () => {
  const f = fixture();
  try {
    const input = inventory(f);
    input.objects = [2,4,5].map(n => ({ ...f.entry,
      objectId: `00000000-0000-4000-8000-00000000000${n}`,
      sourceKey: `${context.tenantId}/PRIVATE/${n}.wav` }));
    f.source.metadata = async entry => structuredClone(input.objects.find(e => e.objectId === entry.objectId));
    let checkpoint;
    const saveCheckpoint = async c => { checkpoint = c; };
    const one = await copyRecordingBatch(input, context, f, { maxObjects: 1, saveCheckpoint });
    assert.equal(one.nextIndex, 1);
    assert.equal(one.state, "batch_verified");
    const two = await copyRecordingBatch(input, context, f,
      { checkpoint, maxBytes: f.bytes.length, saveCheckpoint });
    assert.equal(two.nextIndex, 2);
    assert.equal(two.objectsVerifiedThisBatch, 1);
    const three = await copyRecordingBatch(input, context, f, { checkpoint, saveCheckpoint });
    assert.equal(three.nextIndex, 3);
    assert.equal(three.state, "copy_pass_finished");
    assert.equal(three.backupComplete, false);
    const verified = await finalizeRecordingInventory(input, context, f);
    assert.equal(verified.manifest.objects.length, 3);
    assert.equal(verified.manifest.totalBytes, 3 * f.bytes.length);
  } finally { f.close(); }
});
