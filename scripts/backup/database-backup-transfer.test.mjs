import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fixture } from "./test-support/s3-fixture.mjs";
import { databaseBackupBinding as binding } from "./database-backup-template.mjs";
import { MAX_DATABASE_PACKAGE_BYTES } from "./database-backup-template.mjs";
import { createDatabaseS3 } from "./recording-backup-s3.mjs";
import { uploadDatabasePackage, downloadDatabasePackage } from "./database-backup-transfer.mjs";
const sha = (b) => createHash("sha256").update(b).digest("hex");

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), "database-transport-synthetic-"));
  const path = join(directory, "synthetic.age");
  // This tests transport gates, not encryption. The Python integration test also
  // exercises this transport using a real age-encrypted synthetic package.
  const bytes = Buffer.from("age-encryption.org/v1\nsynthetic-transport-fixture");
  await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
  const descriptor = {
    format: "serviceos-database-package/1",
    project: binding.project,
    snapshotAt: "2026-10-10T12:00:00Z",
    recipient: "age1" + "a".repeat(58),
    sourceRevision: "a".repeat(40),
    bytes: bytes.length,
    sha256: sha(bytes),
  };
  const f = fixture({ database: true });
  t.after(async () => {
    f.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, path, bytes, descriptor, f };
}

test("encrypted copy, immutable completion receipt and independent download use exact version", async (t) => {
  const { directory, path, bytes, descriptor, f } = await setup(t);
  const result = await uploadDatabasePackage(path, descriptor, f, { now: f.now });
  assert.equal(result.state, "encrypted_database_copy_verified");
  assert.equal(result.databaseRestoreVerified, false);
  assert.equal(f.objects.size, 2);
  const resumed = await uploadDatabasePackage(path, descriptor, f, { now: f.now });
  assert.deepEqual(resumed.receipt, result.receipt);
  assert.equal(f.calls.filter((c) => c.method === "PUT").length, 2);
  const downloaded = join(directory, "downloaded.age");
  await downloadDatabasePackage(result.receipt, downloaded, f, { now: f.now });
  assert.deepEqual(await readFile(downloaded), bytes);
  assert.equal((await stat(downloaded)).mode & 0o777, 0o600);
  await assert.rejects(downloadDatabasePackage(result.receipt, downloaded, f, { now: f.now }));
  assert.deepEqual(await readFile(downloaded), bytes, "existing destination retained");
});

test("lost upload reply stops without receipt; retry verifies retained object without overwriting", async (t) => {
  const { path, descriptor, f } = await setup(t);
  f.loss = true;
  await assert.rejects(uploadDatabasePackage(path, descriptor, f, { now: f.now }));
  assert.equal(f.objects.size, 1);
  assert.equal(
    [...f.objects.keys()].some((k) => k.includes("/receipts/")),
    false,
  );
  await uploadDatabasePackage(path, descriptor, f, { now: f.now });
  assert.equal(f.objects.size, 2);
  assert.equal(f.calls.filter((c) => c.method === "PUT").length, 2);
});

test("wrong destination, failed reads and corrupt bytes cannot produce a receipt", async (t) => {
  for (const [setting, value] of [
    ["account", "000000000000"],
    ["region", "eu-west-1"],
    ["invalidPolicy", true],
    ["failList", 403],
    ["corrupt", true],
    ["nullVersion", true],
  ]) {
    const { path, descriptor, f } = await setup(t);
    f[setting] = value;
    await assert.rejects(uploadDatabasePackage(path, descriptor, f, { now: f.now }));
    assert.equal(
      [...f.objects.keys()].some((k) => k.includes("/receipts/")),
      false,
      setting,
    );
  }
});

test("failed download leaves no partial artifact and modified descriptor is rejected before network", async (t) => {
  const { directory, path, descriptor, f } = await setup(t);
  await assert.rejects(uploadDatabasePackage(path, { ...descriptor, sha256: "0".repeat(64) }, f));
  assert.equal(f.calls.length, 0);
  const result = await uploadDatabasePackage(path, descriptor, f, { now: f.now });
  f.corrupt = true;
  const downloaded = join(directory, "downloaded.age");
  await assert.rejects(downloadDatabasePackage(result.receipt, downloaded, f, { now: f.now }));
  await assert.rejects(stat(downloaded), { code: "ENOENT" });
});

test("database package remains bounded at two GiB before any storage request", async (t) => {
  const { path, descriptor, f } = await setup(t);
  await assert.rejects(uploadDatabasePackage(path,
    { ...descriptor, bytes: MAX_DATABASE_PACKAGE_BYTES + 1 }, f));
  assert.equal(f.calls.length, 0);
});

test("database factory requires exact account and identity path; foreign keys never reach SDK", async () => {
  assert.throws(() => createDatabaseS3({ credentials: async () => ({}) }));
  assert.throws(() =>
    createDatabaseS3({
      expectedPrincipalArn: "arn:aws:iam::235099643372:user/root",
      credentials: async () => ({}),
    }),
  );
  const f = fixture({ database: true });
  try {
    await assert.rejects(
      f.destination.find(
        "tenants/00000000-0000-0000-0000-000000000001/objects/" +
          "a".repeat(64) +
          "/" +
          "b".repeat(64),
      ),
    );
    assert.equal(f.calls.length, 0);
  } finally {
    f.close();
  }
});
