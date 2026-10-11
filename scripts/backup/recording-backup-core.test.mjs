import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, stat } from "node:fs/promises";
import {
  backupRecording,
  restoreRecording,
  RecordingBackupError,
} from "./recording-backup-core.mjs";
const tenant = "00000000-0000-0000-0000-000000000001";
const now = () => Date.parse("2026-10-11T12:00:00Z");
function fixture() {
  const bytes = Buffer.from("RIFF-synthetic-test-recording");
  const context = {
    tenantId: tenant,
    sourceProjectRef: "tgbnakbxwcqjeimygroz",
    accountId: "123456789012",
    region: "eu-west-2",
    bucket: "openfolk-synthetic-recordings",
    prefix: `tenants/${tenant}/`,
  };
  const entry = {
    tenantId: tenant,
    objectId: "00000000-0000-4000-8000-000000000002",
    sourceKey: "PRIVATE/call.wav",
    sourceVersion: "revision-1",
    size: bytes.length,
    recordingIds: ["00000000-0000-4000-8000-000000000003"],
  };
  const objects = new Map(),
    receipts = new Map();
  let puts = 0,
    sourceReads = 0,
    metaReads = 0,
    losePut = false,
    loseReceipt = false,
    corrupt = false;
  const stream = async function* (content) {
    yield content.subarray(0, 5);
    yield content.subarray(5);
  };
  const source = {
    metadata: async () => {
      metaReads++;
      return structuredClone(entry);
    },
    read: async () => {
      sourceReads++;
      return stream(bytes);
    },
  };
  const destination = {
    inspect: async () => ({
      ...context,
      private: true,
      tlsRequired: true,
      versioning: "Enabled",
      encryption: "AES256",
      retentionMode: "GOVERNANCE",
      retentionDays: 30,
      conditionalWritesRequired: true,
    }),
    find: async (key) => (objects.has(key) ? { ...objects.get(key).version } : null),
    version: async (key, versionId) => {
      const record = objects.get(key);
      assert.equal(record.version.versionId, versionId);
      return { ...record.version };
    },
    read: async (key, versionId) => {
      const record = objects.get(key);
      assert.equal(record.version.versionId, versionId);
      return stream(corrupt ? Buffer.alloc(record.bytes.length, 1) : record.bytes);
    },
    put: async (request) => {
      puts++;
      assert.equal(request.ifNoneMatch, "*");
      assert.equal(request.encryption, "AES256");
      assert.equal(request.checksumSHA256, Buffer.from(request.sha256, "hex").toString("base64"));
      assert.equal(objects.has(request.key), false, "Duplicate object write");
      const chunks = [];
      for await (const c of request.body()) chunks.push(c);
      const stored = Buffer.concat(chunks);
      assert.deepEqual(stored, bytes);
      const version = {
        key: request.key,
        versionId: "version-1",
        size: request.size,
        sha256: request.sha256,
        encryption: "AES256",
        retentionMode: "GOVERNANCE",
        createdAt: new Date(now()).toISOString(),
        retainUntil: new Date(now() + 30 * 86400000).toISOString(),
      };
      objects.set(request.key, { bytes: stored, version });
      if (losePut) {
        losePut = false;
        throw Error("PRIVATE signed URL and credential");
      }
      return { ...version };
    },
  };
  const journal = {
    load: async (id) => receipts.get(id),
    saveIfAbsent: async (id, r) => {
      if (!receipts.has(id)) receipts.set(id, r);
      if (loseReceipt) {
        loseReceipt = false;
        throw Error("PRIVATE journal timeout");
      }
      return receipts.get(id);
    },
  };
  return {
    entry,
    context,
    bytes,
    source,
    destination,
    journal,
    objects,
    receipts,
    now,
    get puts() {
      return puts;
    },
    get sourceReads() {
      return sourceReads;
    },
    get metaReads() {
      return metaReads;
    },
    set losePut(v) {
      losePut = v;
    },
    set loseReceipt(v) {
      loseReceipt = v;
    },
    set corrupt(v) {
      corrupt = v;
    },
  };
}
const isCode = (code) => (e) =>
  e instanceof RecordingBackupError && e.code === code && !e.message.includes("PRIVATE");
test("copy verifies streamed bytes and pinned S3 version; isolated restore retains references and private permissions", async () => {
  const f = fixture();
  const copied = await backupRecording(f.entry, f.context, f);
  assert.equal(copied.state, "verified");
  assert.equal(f.puts, 1);
  assert.equal(f.receipts.size, 1);
  const restored = await restoreRecording(copied.receipt, f.context, f);
  try {
    assert.deepEqual(await readFile(restored.path), f.bytes);
    assert.deepEqual(restored.recordingIds, f.entry.recordingIds);
    assert.equal(restored.playback, "not_verified");
    assert.equal((await stat(restored.path)).mode & 0o777, 0o600);
    assert.equal((await stat(restored.directory)).mode & 0o777, 0o700);
  } finally {
    await rm(restored.directory, { recursive: true, force: true });
  }
});
test("lost upload acknowledgement recovers deterministic object by verifying bytes, without overwriting", async () => {
  const f = fixture();
  f.losePut = true;
  await assert.rejects(backupRecording(f.entry, f.context, f), isCode("copy_unconfirmed"));
  assert.equal(f.puts, 1);
  assert.equal(f.receipts.size, 0);
  const retry = await backupRecording(f.entry, f.context, f);
  assert.equal(retry.state, "verified");
  assert.equal(f.puts, 1);
});
test("lost journal acknowledgement recovers stored receipt without another source download or upload", async () => {
  const f = fixture();
  f.loseReceipt = true;
  await assert.rejects(backupRecording(f.entry, f.context, f), isCode("copy_unconfirmed"));
  const reads = f.sourceReads;
  const recovered = await backupRecording(f.entry, f.context, f);
  assert.equal(recovered.recovered, true);
  assert.equal(f.sourceReads, reads);
  assert.equal(f.puts, 1);
});
test("source changes during copy or resumed verification do not advance coverage", async () => {
  const f = fixture();
  const metadata = f.source.metadata;
  f.source.metadata = async () => {
    const v = await metadata();
    return f.metaReads > 1 ? { ...v, sourceVersion: "changed" } : v;
  };
  await assert.rejects(backupRecording(f.entry, f.context, f), isCode("source_changed"));
  assert.equal(f.puts, 0);
  const g = fixture();
  await backupRecording(g.entry, g.context, g);
  g.entry.sourceVersion = "changed";
  const oldEntry = { ...g.entry, sourceVersion: "revision-1" };
  await assert.rejects(backupRecording(oldEntry, g.context, g), isCode("source_changed"));
  assert.equal(g.puts, 1);
});
test("foreign tenant and unverified destination block all source downloads and destination writes", async () => {
  const f = fixture();
  await assert.rejects(
    backupRecording({ ...f.entry, tenantId: "00000000-0000-0000-0000-000000000099" }, f.context, f),
    isCode("foreign_tenant"),
  );
  for (const patch of [
    { private: false },
    { versioning: "Suspended" },
    { retentionDays: 1 },
    { accountId: "999999999999" },
    { region: "eu-west-1" },
    { prefix: "other/" },
    { conditionalWritesRequired: false },
    { encryption: "none" },
  ]) {
    const g = fixture(),
      inspect = g.destination.inspect;
    g.destination.inspect = async () => ({ ...(await inspect()), ...patch });
    await assert.rejects(backupRecording(g.entry, g.context, g), isCode("destination_unverified"));
    assert.equal(g.sourceReads, 0);
    assert.equal(g.puts, 0);
  }
});
test("truncated or oversized source and corrupt destination bytes cannot become receipts", async () => {
  for (const delta of [-1, 1]) {
    const f = fixture();
    f.source.read = async () => [Buffer.alloc(f.entry.size + delta)];
    await assert.rejects(backupRecording(f.entry, f.context, f), isCode("byte_length_mismatch"));
    assert.equal(f.puts, 0);
  }
  const f = fixture();
  f.corrupt = true;
  await assert.rejects(
    backupRecording(f.entry, f.context, f),
    isCode("destination_digest_mismatch"),
  );
  assert.equal(f.receipts.size, 0);
});
test("incorrect or underprotected versions cannot complete, including the exact version readback", async () => {
  for (const patch of [
    { versionId: "null" },
    { retentionMode: "COMPLIANCE" },
    { retainUntil: "2026-10-12T12:00:00Z" },
    { sha256: "0".repeat(64) },
    { size: 1 },
    { createdAt: "invalid" },
  ]) {
    const f = fixture(),
      put = f.destination.put;
    f.destination.put = async (request) => ({ ...(await put(request)), ...patch });
    await assert.rejects(
      backupRecording(f.entry, f.context, f),
      isCode("destination_version_unverified"),
    );
    assert.equal(f.receipts.size, 0);
  }
  const f = fixture(),
    version = f.destination.version;
  f.destination.version = async (...args) => ({
    ...(await version(...args)),
    versionId: "wrong-version",
  });
  await assert.rejects(
    backupRecording(f.entry, f.context, f),
    isCode("destination_version_unverified"),
  );
});
test("restore refuses changed source relationships, destination bindings and corrupted historical bytes", async () => {
  const f = fixture(),
    copied = await backupRecording(f.entry, f.context, f);
  await assert.rejects(
    restoreRecording(
      { ...copied.receipt, source: { ...copied.receipt.source, recordingIds: [] } },
      f.context,
      f,
    ),
    isCode("receipt_unverified"),
  );
  await assert.rejects(
    restoreRecording(copied.receipt, { ...f.context, bucket: "another-bucket" }, f),
    isCode("receipt_unverified"),
  );
  f.corrupt = true;
  await assert.rejects(
    restoreRecording(copied.receipt, f.context, f),
    isCode("destination_digest_mismatch"),
  );
});
test("empty and unreferenced objects are retained without inventing playable audio", async () => {
  const f = fixture();
  f.entry.size = 0;
  f.entry.recordingIds = [];
  f.source.read = async () => [];
  f.destination.put = async (request) => {
    const version = {
      key: request.key,
      versionId: "empty-1",
      size: 0,
      sha256: request.sha256,
      encryption: "AES256",
      retentionMode: "GOVERNANCE",
      createdAt: new Date(now()).toISOString(),
      retainUntil: new Date(now() + 30 * 86400000).toISOString(),
    };
    f.objects.set(request.key, { bytes: Buffer.alloc(0), version });
    return version;
  };
  const copied = await backupRecording(f.entry, f.context, f);
  assert.equal(copied.bytes, 0);
  const restored = await restoreRecording(copied.receipt, f.context, f);
  try {
    assert.equal(restored.bytes, 0);
    assert.equal(restored.playback, "not_verified");
  } finally {
    await rm(restored.directory, { recursive: true, force: true });
  }
});
test("provider exceptions never expose signed URLs, paths or credentials", async () => {
  const f = fixture();
  f.source.read = async () => {
    throw Error("PRIVATE URL key path");
  };
  await assert.rejects(backupRecording(f.entry, f.context, f), isCode("copy_unconfirmed"));
});

test("whole-inventory completion requires every receipt and preserves historical scope after a lost reply", async () => {
  const { finalizeRecordingInventory } = await import("./recording-backup-core.mjs");
  const f = fixture(),
    manifests = new Map();
  let lose = true;
  f.journal.loadManifest = async (id) => manifests.get(id);
  f.journal.saveManifestIfAbsent = async (id, m) => {
    if (!manifests.has(id)) manifests.set(id, m);
    if (lose) {
      lose = false;
      throw Error("PRIVATE lost manifest");
    }
    return manifests.get(id);
  };
  const inventory = {
    contract: "recording-inventory/1",
    runId: "00000000-0000-4000-8000-000000000005",
    tenantId: tenant,
    sourceProjectRef: f.context.sourceProjectRef,
    observedAt: new Date(now() - 1000).toISOString(),
    listingComplete: true,
    sourceSnapshot: "non_atomic",
    objects: [structuredClone(f.entry)],
  };
  await assert.rejects(
    finalizeRecordingInventory(inventory, f.context, f),
    isCode("receipt_unverified"),
  );
  assert.equal(manifests.size, 0);
  await backupRecording(f.entry, f.context, f);
  await assert.rejects(
    finalizeRecordingInventory({ ...inventory, objects: [f.entry, f.entry] }, f.context, f),
    isCode("inventory_unverified"),
  );
  await assert.rejects(
    finalizeRecordingInventory({ ...inventory, listingComplete: false }, f.context, f),
    isCode("inventory_unverified"),
  );
  await assert.rejects(
    finalizeRecordingInventory(inventory, f.context, f),
    isCode("manifest_unconfirmed"),
  );
  f.source.metadata = async () => {
    throw Error("PRIVATE source no longer exists");
  };
  const recovered = await finalizeRecordingInventory(inventory, f.context, f);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.manifest.coverage, "verified_inventory_only");
  assert.equal(recovered.manifest.totalBytes, f.bytes.length);
  assert.equal(recovered.manifest.databaseRestore, "not_verified");
  assert.equal(manifests.size, 1);
  const savedManifest = manifests.get(inventory.runId);
  manifests.set(inventory.runId, { ...savedManifest, totalBytes: savedManifest.totalBytes + 1 });
  await assert.rejects(
    finalizeRecordingInventory(inventory, f.context, f),
    isCode("manifest_conflict"),
  );
  manifests.set(inventory.runId, savedManifest);
  await assert.rejects(
    finalizeRecordingInventory(
      { ...inventory, objects: [{ ...f.entry, sourceVersion: "another" }] },
      f.context,
      f,
    ),
    isCode("manifest_conflict"),
  );
});
