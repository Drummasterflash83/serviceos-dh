import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyRecordingCycle, recordingBackupHealth } from "./recording-backup-daily.mjs";
import { fixture, context, time } from "./test-support/s3-fixture.mjs";
const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const inventory = (f, n = 10) => ({
  contract: "recording-inventory/1",
  runId: id(n),
  tenantId: context.tenantId,
  sourceProjectRef: context.sourceProjectRef,
  observedAt: new Date(time).toISOString(),
  listingComplete: true,
  sourceSnapshot: "non_atomic",
  objects: [{ ...f.entry, sourceKey: context.tenantId + "/call.wav" }],
});
test("two daily inventories reuse audio once but verify it again before fresh manifest", async () => {
  const f = fixture();
  let reads = 0;
  f.source.read = async () => {
    reads++;
    return (await import("node:stream")).Readable.from([f.bytes]);
  };
  const first = inventory(f);
  f.source.metadata = async () => structuredClone(first.objects[0]);
  try {
    const a = await dailyRecordingCycle(first, context, f);
    assert.equal(a.newObjectsCopied, 1);
    const b = await dailyRecordingCycle(inventory(f, 11), context, f);
    assert.equal(b.newObjectsCopied, 0);
    assert.equal(b.existingReceipts, 1);
    assert.equal(reads, 1);
    assert.equal(b.backupComplete, false);
    assert.equal(
      f.calls.filter((c) => c.method === "PUT" && decodeURIComponent(c.path).includes("/objects/"))
        .length,
      1,
    );
  } finally {
    f.close();
  }
});
test("existing receipt is not proof: corrupted retained bytes prevent new manifest", async () => {
  const f = fixture(),
    input = inventory(f);
  f.source.metadata = async () => structuredClone(input.objects[0]);
  try {
    await dailyRecordingCycle(input, context, f);
    const puts = f.calls.filter((c) => c.method === "PUT").length;
    f.corrupt = true;
    await assert.rejects(dailyRecordingCycle(inventory(f, 11), context, f));
    assert.equal(f.calls.filter((c) => c.method === "PUT").length, puts);
  } finally {
    f.close();
  }
});
test("new-data limits, foreign scope and cancellation prevent writes", async () => {
  const f = fixture(),
    input = inventory(f);
  f.source.metadata = async () => structuredClone(input.objects[0]);
  try {
    await assert.rejects(dailyRecordingCycle(input, context, f, { maxNewBytes: 1 }), {
      code: "daily_new_data_limit",
    });
    await assert.rejects(dailyRecordingCycle({ ...input, tenantId: id(99) }, context, f), {
      code: "daily_inventory_unverified",
    });
    await assert.rejects(dailyRecordingCycle(input, context, f, { signal: AbortSignal.abort() }), {
      code: "daily_cancelled",
    });
    assert.equal(f.calls.filter((c) => c.method === "PUT").length, 0);
  } finally {
    f.close();
  }
});
test("changed source never turns previous copies into current coverage", async () => {
  const f = fixture(),
    input = inventory(f);
  f.source.metadata = async () => structuredClone(input.objects[0]);
  try {
    await dailyRecordingCycle(input, context, f);
    f.source.metadata = async () => ({ ...input.objects[0], sourceVersion: "changed" });
    await assert.rejects(dailyRecordingCycle(inventory(f, 11), context, f), {
      code: "source_changed",
    });
  } finally {
    f.close();
  }
});
test("monitor differentiates overdue, failed, missing and verified observed inventory", () => {
  const now = time + 3600000,
    success = {
      state: "inventory_verified",
      coverage: "verified_inventory_only",
      inventoryObservedAt: new Date(time).toISOString(),
      verifiedAt: new Date(time + 1000).toISOString(),
      objects: 1,
      totalBytes: 20,
    };
  assert.equal(recordingBackupHealth({ now }).reason, "no_verified_inventory");
  assert.equal(
    recordingBackupHealth({ now, lastSuccess: success }).status,
    "observed_inventory_verified",
  );
  assert.equal(
    recordingBackupHealth({ now: time + 31 * 3600000, lastSuccess: success }).reason,
    "inventory_overdue",
  );
  assert.equal(
    recordingBackupHealth({
      now,
      lastSuccess: success,
      lastAttempt: { state: "failed", startedAt: new Date(time + 2000).toISOString() },
    }).reason,
    "latest_run_failed",
  );
  assert.equal(recordingBackupHealth({ now, lastSuccess: success }).backupComplete, false);
});
test("failure drains all receipt readers and never publishes partial coverage", async () => {
  const f = fixture(),
    input = inventory(f);
  input.objects = Array.from({ length: 9 }, (_, n) => ({
    ...input.objects[0],
    objectId: id(n + 100),
    sourceKey: context.tenantId + "/" + n + ".wav",
  }));
  let active = 0,
    peak = 0;
  f.journal.load = async () => {
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise((r) => setTimeout(r, 10));
      throw Error("synthetic failure");
    } finally {
      active--;
    }
  };
  try {
    await assert.rejects(dailyRecordingCycle(input, context, f));
    assert.equal(active, 0);
    assert.equal(peak, 4);
    assert.equal(f.calls.filter((c) => c.method === "PUT").length, 0);
  } finally {
    f.close();
  }
});
