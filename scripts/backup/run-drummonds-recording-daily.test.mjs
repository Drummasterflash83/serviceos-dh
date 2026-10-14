import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, readFile, writeFile, chmod, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDailyBackup, readDailyHealth } from "./run-drummonds-recording-daily.mjs";
import { fixture, context, time } from "./test-support/s3-fixture.mjs";
import { RecordingBackupError } from "./recording-backup-core.mjs";
const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
function ports() {
  const f = fixture();
  f.entry.sourceKey = context.tenantId + "/call.wav";
  let n = 10;
  f.source.inventory = async () => ({
    inventory: {
      contract: "recording-inventory/1",
      runId: id(n++),
      tenantId: context.tenantId,
      sourceProjectRef: context.sourceProjectRef,
      observedAt: new Date(time).toISOString(),
      listingComplete: true,
      sourceSnapshot: "non_atomic",
      objects: [f.entry],
    },
    reconciliation: {
      contract: "recording-source-reconciliation/1",
      tenantId: context.tenantId,
      sourceProjectRef: context.sourceProjectRef,
      objects: 1,
      totalBytes: f.entry.size,
      recordingRows: 1,
      rowsWithoutStoragePointer: 0,
      unreferencedObjects: 0,
      missingObjectReferences: [],
    },
  });
  return f;
}
test("a changing inventory is completely reobserved with the same ports before any copy", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "daily-arrivals-"))),
    f = ports();
  const stable = f.source.inventory;
  let attempts = 0,
    opened = 0;
  f.source.usage = () => ({ requests: attempts, maxRequests: 100000 });
  f.source.inventory = async () => {
    attempts++;
    if (attempts < 3) {
      assert.equal(f.calls.length, 0);
      throw new RecordingBackupError("source_inventory_changed");
    }
    return stable();
  };
  try {
    const result = await runDailyBackup({
      directory,
      binding: context,
      createPorts: async () => {
        opened++;
        return f;
      },
    });
    assert.equal(opened, 1);
    assert.equal(attempts, 3);
    assert.equal(result.state, "inventory_verified");
    assert.deepEqual(
      result.inventoryAttempts.map((a) => a.state),
      ["failed", "failed", "stable"],
    );
    assert.deepEqual(result.sourceUsage, { requests: 3, maxRequests: 100000 });
    const journal = JSON.parse(await readFile(join(directory, "last-attempt.json"), "utf8"));
    assert.equal(journal.state, "succeeded");
    assert.equal(journal.inventoryAttempts.length, 3);
    await assert.rejects(stat(join(directory, "daily.lock")), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("three unstable scans stop without copying or replacing the previous verified result", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "daily-arrivals-"))),
    f = ports();
  try {
    await runDailyBackup({ directory, binding: context, createPorts: async () => f });
    const success = await readFile(join(directory, "last-success.json"), "utf8"),
      calls = f.calls.length;
    let scans = 0;
    f.source.inventory = async () => {
      scans++;
      throw new RecordingBackupError("source_inventory_changed");
    };
    await assert.rejects(
      runDailyBackup({ directory, binding: context, createPorts: async () => f }),
      { code: "source_inventory_changed" },
    );
    assert.equal(scans, 3);
    assert.equal(f.calls.length, calls);
    assert.equal(await readFile(join(directory, "last-success.json"), "utf8"), success);
    const journal = JSON.parse(await readFile(join(directory, "last-attempt.json"), "utf8"));
    assert.equal(journal.state, "failed");
    assert.equal(journal.inventoryAttempts.length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("source identity/access failures and exhausted shared budgets never restart inventory", async () => {
  for (const code of [
    "source_changed",
    "source_request_unconfirmed",
    "communication_request_limit",
  ]) {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "daily-arrivals-"))),
      f = ports();
    let scans = 0;
    f.source.inventory = async () => {
      scans++;
      throw new RecordingBackupError(scans === 1 ? "source_inventory_changed" : code);
    };
    try {
      await assert.rejects(
        runDailyBackup({ directory, binding: context, createPorts: async () => f }),
        { code },
      );
      assert.equal(scans, 2);
      assert.equal(f.calls.length, 0);
      await assert.rejects(stat(join(directory, "last-success.json")), { code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
test("cancellation between inventories stops under the same lock before another read", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "daily-arrivals-"))),
    f = ports(),
    controller = new AbortController();
  let scans = 0;
  f.source.inventory = async () => {
    scans++;
    controller.abort();
    throw new RecordingBackupError("source_inventory_changed");
  };
  try {
    await assert.rejects(
      runDailyBackup({
        directory,
        binding: context,
        signal: controller.signal,
        createPorts: async () => f,
      }),
      { code: "daily_cancelled" },
    );
    assert.equal(scans, 1);
    assert.equal(f.calls.length, 0);
    await assert.rejects(stat(join(directory, "daily.lock")), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("daily runner saves private fresh manifests and preserves last success after failure", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "daily-run-"))),
    f = ports();
  try {
    const a = await runDailyBackup({
      directory,
      binding: context,
      createPorts: async (_signal, options) => {
        assert.deepEqual(options, { requestBudget: 100000 });
        return f;
      },
    });
    assert.equal(a.newObjectsCopied, 1);
    assert.equal((await stat(join(directory, "last-success.json"))).mode & 0o777, 0o600);
    const before = await readFile(join(directory, "last-success.json"), "utf8");
    await assert.rejects(
      runDailyBackup({
        directory,
        binding: context,
        createPorts: async () => {
          throw Error("PRIVATE credential detail");
        },
      }),
      { code: "daily_unconfirmed" },
    );
    assert.equal(await readFile(join(directory, "last-success.json"), "utf8"), before);
    const health = await readDailyHealth(directory, Date.now());
    assert.equal(health.status, "attention");
    assert.equal(health.latestFailureCode, "daily_unconfirmed");
    assert.doesNotMatch(JSON.stringify(health), /PRIVATE|token|password/);
    await assert.rejects(stat(join(directory, "daily.lock")), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("overlapping run cannot open credentials and failure drains before releasing lock", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "daily-run-")));
  let release, started;
  const ready = new Promise((r) => {
      started = r;
    }),
    pending = new Promise((r) => {
      release = r;
    });
  let opened = 0;
  const first = runDailyBackup({
    directory,
    binding: context,
    createPorts: async () => {
      opened++;
      started();
      await pending;
      throw Error("fixture");
    },
  });
  try {
    await ready;
    await assert.rejects(
      runDailyBackup({
        directory,
        binding: context,
        createPorts: async () => {
          opened++;
        },
      }),
      { code: "daily_already_locked" },
    );
    assert.equal(opened, 1);
    release();
    await assert.rejects(first);
    await assert.rejects(stat(join(directory, "daily.lock")), { code: "ENOENT" });
  } finally {
    release?.();
    await first.catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
test("unsafe directory, symlink and unverified health file fail closed", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "daily-run-")));
  let opened = 0;
  try {
    await chmod(directory, 0o755);
    await assert.rejects(
      runDailyBackup({
        directory,
        createPorts: async () => {
          opened++;
        },
      }),
      { code: "daily_directory_unverified" },
    );
    await chmod(directory, 0o700);
    await symlink(directory, directory + "-link");
    await assert.rejects(
      runDailyBackup({
        directory: directory + "-link",
        createPorts: async () => {
          opened++;
        },
      }),
      { code: "daily_directory_unverified" },
    );
    await writeFile(join(directory, "last-success.json"), "{}", { mode: 0o644 });
    await assert.rejects(readDailyHealth(directory), { code: "daily_file_unverified" });
    assert.equal(opened, 0);
  } finally {
    await rm(directory + "-link", { force: true });
    await rm(directory, { recursive: true, force: true });
  }
});
