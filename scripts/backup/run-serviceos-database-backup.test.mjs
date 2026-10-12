import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, rm, stat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fixture } from "./test-support/s3-fixture.mjs";
import {
  runPreparedDatabaseBackup,
  parseDatabaseBackupArgs,
} from "./run-serviceos-database-backup.mjs";
async function setup(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "database-operator-synthetic-")));
  const bytes = Buffer.from("age-encryption.org/v1\nSYNTHETIC-transport-only");
  const descriptor = {
    format: "serviceos-database-package/1",
    project: "tgbnakbxwcqjeimygroz",
    snapshotAt: "2026-10-10T12:00:00Z",
    sourceRevision: "a".repeat(40),
    recipient: "age1" + "a".repeat(58),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const preparation = {
    contract: "database-package-preparation/1",
    snapshotAt: descriptor.snapshotAt,
    state: "package_encrypted_and_decrypt_checked",
    descriptor,
    localDatabaseRestoreVerified: true,
    archive: {
      bytes: 197303039,
      sha256: "bdb6be1f2cb934247949d6443305550888e6b4e62f5c55dac419a432616bd3db",
    },
  };
  for (const [name, value] of [
    ["descriptor.json", descriptor],
    ["preparation.json", preparation],
  ])
    await writeFile(join(directory, name), JSON.stringify(value), { mode: 0o600, flag: "wx" });
  await writeFile(join(directory, "snapshot.age"), bytes, { mode: 0o600, flag: "wx" });
  const f = fixture({ database: true }),
    order = [];
  t.after(async () => {
    f.close();
    await rm(directory, { recursive: true, force: true });
  });
  const material = {
    ageRecipient: descriptor.recipient,
    ageIdentity: "synthetic-age-identity",
    vaultRootKey: "12".repeat(32),
  };
  const escrow = {
    binding: { itemId: "synthetic" },
    async read() {
      order.push("escrow-read");
      return { ...material };
    },
  };
  const options = {
    directory,
    escrow,
    now: f.now,
    openWriter: async () => {
      order.push("writer-open");
      return { ...f, close: () => order.push("writer-close") };
    },
    openRestore: async () => {
      order.push("restore-open");
      return { ...f, close: () => order.push("restore-close") };
    },
    recover: async (data) => {
      order.push("database-restore");
      assert.deepEqual(await readFile(data.encryptedPath), bytes);
      assert.equal(data.rootKey, material.vaultRootKey);
      return {
        state: "encrypted_package_database_and_vault_restored",
        containerRemoved: true,
        originalPackageFilesUnchanged: true,
        allPhysicalTablesCovered: true,
        tableCatalogMatched: true,
        extensionVersionsMatched: true,
        vaultSecretsVerified: 1,
        nativeDataComparison: { rows: 11 },
        networkSupplementComparison: { rows: 1 },
        recordingRelationships: { recordings: 1 },
        unexpectedPrivateField: "PRIVATE-must-not-be-forwarded",
      };
    },
  };
  return { directory, f, order, options, preparation, material };
}
test("operator separates writer, restore and fresh escrow reads, then records bounded acceptance", async (t) => {
  const { directory, options, order } = await setup(t);
  const result = await runPreparedDatabaseBackup(options);
  assert.deepEqual(order, [
    "escrow-read",
    "writer-open",
    "writer-close",
    "restore-open",
    "restore-close",
    "escrow-read",
    "database-restore",
  ]);
  assert.equal(result.state, "independent_database_snapshot_verified");
  assert.equal(result.dailyOperationVerified, false);
  assert.equal(result.fullServiceRecoveryVerified, false);
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  await assert.rejects(stat(join(directory, "active.lock")), { code: "ENOENT" });
  assert.equal((await readdir(directory)).filter((n) => n.startsWith("verified-")).length, 1);
});
test("lost upload acknowledgement leaves no acceptance; retry uses exact existing object", async (t) => {
  const { directory, options, f } = await setup(t);
  f.loss = true;
  await assert.rejects(runPreparedDatabaseBackup(options), /database_backup_not_verified/);
  assert.equal((await readdir(directory)).filter((n) => n.startsWith("verified-")).length, 0);
  await assert.rejects(stat(join(directory, "active.lock")), { code: "ENOENT" });
  await runPreparedDatabaseBackup(options);
  assert.equal(f.calls.filter((c) => c.method === "PUT").length, 2);
});
test("uncertain database failure retains an inspection lock and cannot silently retry", async (t) => {
  const { directory, options, order } = await setup(t);
  options.recover = async () => {
    throw Error("PRIVATE raw recovery output");
  };
  await assert.rejects(runPreparedDatabaseBackup(options), /database_backup_not_verified/);
  assert.ok((await stat(join(directory, "active.lock"))).isFile());
  const before = order.length;
  await assert.rejects(runPreparedDatabaseBackup(options));
  assert.equal(order.length, before);
  const name = (await readdir(directory)).find((n) => n.startsWith("failed-"));
  const report = await readFile(join(directory, name), "utf8");
  assert.ok(!report.includes("PRIVATE"));
  assert.equal(JSON.parse(report).restoreInspectionRequired, true);
});
test("unverified preparation prevents access to keys or AWS", async (t) => {
  const { directory, options, preparation, order, f } = await setup(t);
  preparation.localDatabaseRestoreVerified = false;
  await writeFile(join(directory, "preparation.json"), JSON.stringify(preparation));
  await assert.rejects(runPreparedDatabaseBackup(options));
  assert.equal(order.length, 0);
  assert.equal(f.calls.length, 0);
});
test("different preparation format or snapshot refuses credential access", async (t) => {
  for (const replacement of [
    { contract: "database-package-preparation/2" },
    { snapshotAt: "different" },
  ]) {
    await t.test(Object.keys(replacement)[0], async (t) => {
      const { directory, options, preparation, order, f } = await setup(t);
      await writeFile(
        join(directory, "preparation.json"),
        JSON.stringify({ ...preparation, ...replacement }),
      );
      await assert.rejects(runPreparedDatabaseBackup(options));
      assert.equal(order.length, 0);
      assert.equal(f.calls.length, 0);
    });
  }
});
test("CLI requires explicit initial-snapshot mode and a run identity", () => {
  assert.throws(() => parseDatabaseBackupArgs([]));
  assert.throws(() => parseDatabaseBackupArgs(["--daily", "bad", "/tmp/binding.json"]));
  assert.equal(
    parseDatabaseBackupArgs([
      "--prepare-initial",
      "00000000-0000-4000-8000-000000000001",
      "/tmp/binding.json",
    ]).mode,
    "--prepare-initial",
  );
});
