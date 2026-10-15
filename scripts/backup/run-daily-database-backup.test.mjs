import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runDailyDatabaseBackup } from "./run-daily-database-backup.mjs";

const ID = "52ee0781-58c9-4711-bad3-85d0cf83e5fe";
const outputs = [
  { stage: "export_complete_restore_unverified", archiveBytes: 1057045013 },
  { state: "daily_native_restore_verified_vault_pending", containerRemoved: true,
    productionWrites: false },
  { state: "package_encrypted_native_evidence_verified_vault_pending",
    recoveryKeyRead: false },
  { state: "encrypted_offsite_copy_and_download_verified_restore_pending",
    independentStorageVerified: true, recoveryKeyRead: false,
    databaseRestoreVerified: false, attempt: "93510629-2c12-447f-a616-ed1476726179",
    encryptedBytes: 1060652040 },
];

test("daily attempt records only a verified keyless copy", async () => {
  const base = await mkdtemp(join(tmpdir(), "daily-backup-test-"));
  const commands = [];
  try {
    const result = await runDailyDatabaseBackup({ base, runId: ID, day: "20261015",
      execute: async (command, args) => {
        commands.push([command, args]);
        return JSON.stringify(outputs[commands.length - 1]);
      },
    });
    assert.equal(result.state, "one_unattended_copy_verified_restore_pending");
    assert.equal(result.recoveryKeyRead, false);
    assert.equal(result.sustainedDailyOperationVerified, false);
    assert.equal(result.fullApplicationRecoveryVerified, false);
    assert.equal(commands.length, 4);
    assert.deepEqual(commands.map(([command]) => command),
      ["node", "python3", "node", "node"]);
    assert.ok(commands.every(([, args]) => args.join(" ").includes(
      `.verification-results/production-database-daily-20261015-${ID}`)));
    const saved = JSON.parse(await readFile(join(base, `database-daily-run-${ID}`,
      "verified.json"), "utf8"));
    assert.deepEqual(saved, result);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("unconfirmed native restore stops before encryption or copy without retry", async () => {
  const base = await mkdtemp(join(tmpdir(), "daily-backup-test-"));
  let calls = 0;
  try {
    await assert.rejects(runDailyDatabaseBackup({ base, runId: ID, day: "20261015",
      execute: async () => JSON.stringify(calls++ === 0 ? outputs[0] :
        { state: "daily_native_restore_not_verified" }),
    }), /daily_backup_not_verified/);
    assert.equal(calls, 2);
    const files = await readdir(join(base, `database-daily-run-${ID}`));
    assert.ok(files.includes("failed.json"));
    assert.ok(!files.includes("verified.json"));
    assert.ok(!files.includes("encrypt.json"));
  } finally { await rm(base, { recursive: true, force: true }); }
});
