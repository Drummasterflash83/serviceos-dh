import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, chmod, stat, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { runRecordingBackup } from "./recording-backup-runner.mjs";
import { fixture, context, time } from "./test-support/s3-fixture.mjs";
async function setup() {
  const f = fixture();
  const directory = await mkdtemp(join(await realpath(tmpdir()), "recording-runner-test-"));
  const objects = [2, 3].map((n) => ({
    ...f.entry,
    objectId: `00000000-0000-4000-8000-00000000000${n}`,
    sourceKey: `${context.tenantId}/PRIVATE/${n}.wav`,
  }));
  f.source.metadata = async (e) => structuredClone(objects.find((x) => x.objectId === e.objectId));
  const inventory = {
    contract: "recording-inventory/1",
    runId: "00000000-0000-4000-8000-000000000010",
    tenantId: context.tenantId,
    sourceProjectRef: context.sourceProjectRef,
    observedAt: new Date(time).toISOString(),
    listingComplete: true,
    sourceSnapshot: "non_atomic",
    objects,
  };
  const raw = JSON.stringify(inventory);
  await writeFile(join(directory, "inventory.json"), raw, { mode: 0o600 });
  const args = {
    directory,
    inventoryFileSha256: createHash("sha256").update(raw).digest("hex"),
    binding: context,
    createPorts: async () => ({ ...f, close() {} }),
    mode: "copy",
    maxObjects: 1,
  };
  return {
    f,
    args,
    directory,
    cleanup: async () => {
      f.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
test("disk checkpoint resumes across separate invocations and finalizes only after all exact versions verify", async () => {
  const t = await setup();
  try {
    const one = await runRecordingBackup(t.args);
    assert.equal(one.nextIndex, 1);
    assert.equal(one.backupComplete, false);
    const saved = JSON.parse(await readFile(join(t.directory, "checkpoint.json"), "utf8"));
    assert.equal(saved.nextIndex, 1);
    assert.equal((await stat(join(t.directory, "checkpoint.json"))).mode & 0o777, 0o600);
    await assert.rejects(runRecordingBackup({ ...t.args, mode: "finalize" }), {
      code: "runner_copy_pass_incomplete",
    });
    const two = await runRecordingBackup(t.args);
    assert.equal(two.nextIndex, 2);
    const puts = t.f.calls.filter((c) => c.method === "PUT").length;
    const again = await runRecordingBackup(t.args);
    assert.equal(again.objectsVerifiedThisBatch, 0);
    assert.equal(t.f.calls.filter((c) => c.method === "PUT").length, puts);
    const done = await runRecordingBackup({ ...t.args, mode: "finalize" });
    assert.equal(done.state, "inventory_verified");
    assert.equal(done.objects, 2);
    assert.equal(done.backupComplete, false);
    assert.equal(done.playback, "not_verified");
    assert.ok(!JSON.stringify(done).includes("PRIVATE"));
    assert.equal(
      JSON.parse(await readFile(join(t.directory, "last-result.json"), "utf8")).state,
      "inventory_verified",
    );
    const recovered = await runRecordingBackup({ ...t.args, mode: "finalize" });
    assert.equal(recovered.recovered, true);
    await assert.rejects(stat(join(t.directory, "runner.lock")), { code: "ENOENT" });
  } finally {
    await t.cleanup();
  }
});
test("lost local checkpoint recovers immutable receipts without duplicate uploads", async () => {
  const t = await setup();
  try {
    await runRecordingBackup(t.args);
    await rm(join(t.directory, "checkpoint.json"));
    const puts = t.f.calls.filter((c) => c.method === "PUT").length;
    const resumed = await runRecordingBackup(t.args);
    assert.equal(resumed.recoveredObjects, 1);
    assert.equal(t.f.calls.filter((c) => c.method === "PUT").length, puts);
  } finally {
    await t.cleanup();
  }
});
test("hash mismatch, broad permissions, symlink and existing locks refuse before credential loading", async () => {
  const t = await setup();
  try {
    let loaded = 0;
    const args = {
      ...t.args,
      createPorts: async () => {
        loaded++;
        return t.f;
      },
    };
    await assert.rejects(runRecordingBackup({ ...args, inventoryFileSha256: "a".repeat(64) }), {
      code: "runner_inventory_hash_mismatch",
    });
    await chmod(join(t.directory, "inventory.json"), 0o644);
    await assert.rejects(runRecordingBackup(args), { code: "runner_file_unverified" });
    await chmod(join(t.directory, "inventory.json"), 0o600);
    await symlink(join(t.directory, "inventory.json"), join(t.directory, "checkpoint.json"));
    await assert.rejects(runRecordingBackup(args), { code: "runner_file_unavailable" });
    await rm(join(t.directory, "checkpoint.json"));
    await writeFile(join(t.directory, "runner.lock"), "existing", { mode: 0o600 });
    await assert.rejects(runRecordingBackup(args), { code: "runner_already_locked" });
    assert.equal(await readFile(join(t.directory, "runner.lock"), "utf8"), "existing");
    assert.equal(loaded, 0);
    assert.equal(t.f.calls.length, 0);
  } finally {
    await t.cleanup();
  }
});
test("corrupt destination fails finalization even with a completed disk checkpoint", async () => {
  const t = await setup();
  try {
    await runRecordingBackup({ ...t.args, maxObjects: 2 });
    t.f.corrupt = true;
    await assert.rejects(runRecordingBackup({ ...t.args, mode: "finalize" }));
    assert.equal(
      JSON.parse(await readFile(join(t.directory, "last-result.json"), "utf8")).state,
      "copy_pass_finished",
    );
    const attempt = JSON.parse(await readFile(join(t.directory, "last-attempt.json"), "utf8"));
    assert.equal(attempt.state, "failed");
    assert.equal(attempt.mode, "finalize");
    assert.equal(attempt.backupComplete, false);
    await assert.rejects(stat(join(t.directory, "runner.lock")), { code: "ENOENT" });
  } finally {
    await t.cleanup();
  }
});
