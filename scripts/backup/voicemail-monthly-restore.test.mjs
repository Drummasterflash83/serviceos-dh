import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { fixture, context, time } from "./test-support/s3-fixture.mjs";
import { backupRecording, finalizeRecordingInventory } from "./recording-backup-core.mjs";
import {
  checkMonthlyPair,
  selectMonthlyPair,
  nextMonthlyCheck,
  monthlyRestoreHealth,
  voicemailBuckets,
  removeRestoredDirectory,
} from "./voicemail-monthly-restore.mjs";
import {
  runMonthlyVoicemail,
  createMonthlyRestorePorts,
  privateDir,
  writePrivate,
  readPrivate,
} from "./run-drummonds-voicemail-monthly-restore.mjs";
import { withDailyLease } from "./communication-backup-lock.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const iso = new Date(time).toISOString();
const decoded = { state: "decoded", durationSeconds: 1, listening: "not_verified" };
async function setup(audioBytes) {
  const f = fixture(),
    manifests = {},
    aggregate = {
      state: "communication_inventory_verified",
      verifiedAt: iso,
      inventoryObservedAt: iso,
      pair: { matchedPairs: 1 },
      buckets: {},
    };
  for (let n = 0; n < 2; n++) {
    const bucket = voicemailBuckets[n],
      bytes =
        n && audioBytes
          ? audioBytes
          : Buffer.from(n ? "synthetic audio" : "synthetic original email");
    const entry = {
      tenantId: context.tenantId,
      objectId: id(n + 1),
      sourceKey: n
        ? `${context.tenantId}/${id(7)}/${id(8)}`
        : `${context.tenantId}/${id(8)}/${id(9)}.eml`,
      sourceVersion: "v1",
      size: bytes.length,
      recordingIds: [id(n ? 8 : 9)],
      sourceBucket: bucket,
      sourceContentSha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const ports = {
      ...f,
      source: {
        metadata: async () => structuredClone(entry),
        read: async () => Readable.from([bytes]),
      },
    };
    await backupRecording(entry, context, ports);
    const { manifest } = await finalizeRecordingInventory(
      {
        contract: "recording-inventory/1",
        runId: id(20 + n),
        tenantId: context.tenantId,
        sourceProjectRef: context.sourceProjectRef,
        observedAt: iso,
        listingComplete: true,
        sourceSnapshot: "non_atomic",
        objects: [entry],
      },
      context,
      ports,
    );
    manifests[bucket] = manifest;
    aggregate.buckets[bucket] = {
      runId: manifest.runId,
      inventorySha256: manifest.inventorySha256,
      verifiedAt: iso,
      inventoryObservedAt: iso,
    };
  }
  let success = null,
    attempt = null,
    credentials = 0;
  const state = {
    readSuccess: async () => success,
    writeSuccess: async (v) => {
      success = structuredClone(v);
    },
    writeAttempt: async (v) => {
      attempt = structuredClone(v);
    },
  };
  const restore = async () => {
    credentials++;
    return { destination: f.destination, journal: f.journal, now: () => time };
  };
  return {
    f,
    manifests,
    aggregate,
    state,
    restore,
    get: () => ({ success, attempt, credentials }),
    run: (extra = {}) =>
      checkMonthlyPair({
        aggregate,
        context,
        createRestorePorts: restore,
        state,
        now: () => time,
        decode: async () => decoded,
        ...extra,
      }),
  };
}
test("AWS-only matched pair verifies immutable bytes, decodes audio only and removes both private files", async () => {
  const x = await setup();
  try {
    const before = x.f.calls.length,
      paths = [];
    const result = await x.run({
      decode: async (restored) => {
        const path = restored.path;
        paths.push(path);
        assert.equal((await lstat(path)).mode & 0o777, 0o600);
        return decoded;
      },
    });
    assert.equal(result.status, "sample_restore_verified");
    assert.equal(paths.length, 1);
    await assert.rejects(lstat(paths[0]), { code: "ENOENT" });
    assert.equal(x.get().success.files, 2);
    assert.equal(x.get().success.privateContentRemoved, true);
    assert.equal(x.get().success.sourceAccessDuringRestore, false);
    assert.ok(x.f.calls.slice(before).every((c) => ["GET", "HEAD"].includes(c.method)));
    assert.ok(!JSON.stringify(result).includes(id(8)));
    assert.ok(!JSON.stringify(result).includes("sourceKey"));
  } finally {
    x.f.close();
  }
});
test("wrong tenant, stale aggregate, mismatched manifest and missing pair reject before download", async () => {
  const x = await setup();
  try {
    const count = x.f.calls.length;
    for (const mutate of [
      (a, m) => {
        m[voicemailBuckets[0]].destination.tenantId = id(99);
      },
      (a) => {
        a.inventoryObservedAt = "2025-01-01T00:00:00.000Z";
      },
      (a) => {
        a.buckets[voicemailBuckets[0]].inventorySha256 = "a".repeat(64);
      },
      (a) => {
        a.pair.matchedPairs = 2;
      },
      (a, m) => {
        m[voicemailBuckets[0]].objects.push(m[voicemailBuckets[0]].objects[0]);
      },
      (a, m) => {
        m[voicemailBuckets[1]].objects[0].source.recordingIds = [id(99)];
      },
      (a, m) => {
        m[voicemailBuckets[0]].objects[0].source.size = 1048577;
      },
    ]) {
      const a = structuredClone(x.aggregate),
        m = structuredClone(x.manifests);
      mutate(a, m);
      assert.throws(() => selectMonthlyPair(a, m, context, time));
    }
    assert.equal(count, x.f.calls.length);
  } finally {
    x.f.close();
  }
});
test("tampered full remote manifest cannot bypass core receipt/digest verification", async () => {
  const x = await setup();
  try {
    const original = x.f.journal.loadManifest;
    const restore = async () => ({
      destination: x.f.destination,
      now: () => time,
      journal: {
        loadManifest: async (id) => {
          const m = await original(id);
          m.totalBytes++;
          return m;
        },
      },
    });
    await assert.rejects(x.run({ createRestorePorts: restore }), {
      code: "restore_manifest_unverified",
    });
    assert.equal(x.get().success, null);
    assert.equal(x.get().attempt.state, "failed");
  } finally {
    x.f.close();
  }
});
test("decode failure removes both files and preserves previous successful date", async () => {
  const x = await setup();
  try {
    await x.run();
    const good = x.get().success;
    let removed = 0;
    await assert.rejects(
      x.run({
        decode: async () => ({ state: "unconfirmed" }),
        cleanup: async (p) => {
          await removeRestoredDirectory(p);
          removed++;
        },
      }),
      { code: "monthly_audio_decode_unconfirmed" },
    );
    assert.equal(removed, 2);
    assert.deepEqual(x.get().success, good);
    assert.equal(monthlyRestoreHealth(good, x.get().attempt, time).reason, "latest_restore_failed");
  } finally {
    x.f.close();
  }
});
test("cleanup uncertainty cannot advance success even after successful decode", async () => {
  const x = await setup();
  try {
    let cleaned = 0;
    await assert.rejects(
      x.run({
        cleanup: async (p) => {
          await removeRestoredDirectory(p);
          cleaned++;
          throw Error("synthetic cleanup failure");
        },
      }),
      { code: "monthly_cleanup_unconfirmed" },
    );
    assert.equal(cleaned, 2);
    assert.equal(x.get().success, null);
  } finally {
    x.f.close();
  }
});
test("source ports are rejected and no production source credential resolver is used", async () => {
  const x = await setup();
  try {
    await assert.rejects(x.run({ createRestorePorts: async () => ({ ...x.f }) }), {
      code: "monthly_source_port_forbidden",
    });
    let roles = [];
    const ports = await createMonthlyRestorePorts(AbortSignal.timeout(1000), async (role) => {
      roles.push(role);
      return {
        accessKeyId: "AKIA" + "A".repeat(16),
        secretAccessKey: "x".repeat(40),
        principalArn: "arn:aws:iam::235099643372:user/synthetic",
      };
    });
    assert.deepEqual(roles, ["Restore"]);
    ports.close();
  } finally {
    x.f.close();
  }
});
test("calendar monthly due clamps month ends and handles leap years; invalid and failed evidence needs attention", () => {
  assert.equal(nextMonthlyCheck("2026-01-31T12:00:00Z"), "2026-02-28T12:00:00.000Z");
  assert.equal(nextMonthlyCheck("2028-01-31T12:00:00Z"), "2028-02-29T12:00:00.000Z");
  const s = {
    state: "paired_files_restored_and_verified",
    files: 2,
    checkedAt: iso,
    privateContentRemoved: true,
    playback: decoded,
    sourceAccessDuringRestore: false,
    proofs: voicemailBuckets.map((sourceBucket, i) => ({
      sourceBucket,
      objectId: id(i + 1),
      manifestRunId: id(i + 20),
      sha256: "a".repeat(64),
      inventorySha256: "b".repeat(64),
      bytes: 100,
    })),
  };
  assert.equal(monthlyRestoreHealth(s, null, time).status, "sample_restore_verified");
  assert.equal(
    monthlyRestoreHealth(s, null, Date.parse(nextMonthlyCheck(iso))).reason,
    "monthly_restore_due",
  );
  assert.equal(monthlyRestoreHealth(s, null, time - 1).reason, "restore_time_invalid");
  assert.equal(
    monthlyRestoreHealth({ ...s, privateContentRemoved: false }, null, time).reason,
    "no_verified_pair",
  );
  assert.equal(
    monthlyRestoreHealth(s, { state: "in_progress", startedAt: iso }, time + 600001).reason,
    "restore_outcome_unconfirmed",
  );
});
test("monthly lock prevents credentials on duplicate run; health has no credentials and private state stays 0600", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "vm-monthly-test-"));
  let accessed = 0;
  const createRestorePorts = async () => {
    accessed++;
    throw Error("not expected");
  };
  try {
    const directory = join(root, "voicemail-monthly-restore");
    await withDailyLease(directory, async () => {
      await assert.rejects(runMonthlyVoicemail({ root, createRestorePorts }), {
        code: "daily_already_locked",
      });
    });
    assert.equal(accessed, 0);
    assert.equal(
      (await runMonthlyVoicemail({ root, healthOnly: true, createRestorePorts })).reason,
      "no_verified_pair",
    );
    assert.equal(accessed, 0);
    await privateDir(directory);
    await writePrivate(directory, "test.json", { private: true });
    assert.equal((await lstat(join(directory, "test.json"))).mode & 0o777, 0o600);
    assert.deepEqual(await readPrivate(join(directory, "test.json")), { private: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("abort after download cleans private directories and cannot advance success", async () => {
  const x = await setup(),
    controller = new AbortController();
  try {
    let cleaned = 0;
    await assert.rejects(
      x.run({
        signal: controller.signal,
        decode: async () => {
          controller.abort();
          return decoded;
        },
        cleanup: async (p) => {
          await removeRestoredDirectory(p);
          cleaned++;
        },
      }),
      { code: "monthly_cancelled" },
    );
    assert.equal(cleaned, 2);
    assert.equal(x.get().success, null);
  } finally {
    x.f.close();
  }
});
test(
  "full decoding of synthetic WAV uses the established decoder and removes both files",
  { skip: process.platform !== "darwin" },
  async () => {
    const b = Buffer.alloc(44 + 1600);
    b.write("RIFF");
    b.writeUInt32LE(b.length - 8, 4);
    b.write("WAVEfmt ", 8);
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20);
    b.writeUInt16LE(1, 22);
    b.writeUInt32LE(8000, 24);
    b.writeUInt32LE(16000, 28);
    b.writeUInt16LE(2, 32);
    b.writeUInt16LE(16, 34);
    b.write("data", 36);
    b.writeUInt32LE(1600, 40);
    const x = await setup(b);
    try {
      const { checkRecordingPlayback } = await import("./recording-playback-check.mjs");
      await x.run({ decode: checkRecordingPlayback });
      assert.equal(x.get().success.playback.durationSeconds, 0.1);
    } finally {
      x.f.close();
    }
  },
);
test("pair selection rotates away from the last sampled intake when another bounded pair exists", async () => {
  const x = await setup();
  try {
    const a = structuredClone(x.aggregate),
      m = structuredClone(x.manifests);
    a.pair.matchedPairs = 2;
    for (let n = 0; n < 2; n++) {
      const copied = structuredClone(m[voicemailBuckets[n]].objects[0]);
      copied.source.objectId = id(50 + n);
      copied.source.sourceKey = n
        ? `${context.tenantId}/${id(7)}/${id(18)}`
        : `${context.tenantId}/${id(18)}/${id(19)}.eml`;
      copied.source.recordingIds = [id(n ? 18 : 19)];
      m[voicemailBuckets[n]].objects.push(copied);
    }
    assert.equal(selectMonthlyPair(a, m, context, time, id(8)).intake, id(18));
    assert.equal(selectMonthlyPair(a, m, context, time, id(18)).intake, id(8));
  } finally {
    x.f.close();
  }
});
