import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicPreparationFailure, safePythonPreparationFailure } from "./database-encrypt-safe-codes.mjs";
import { safeDailyChildFailure, runDailyDatabaseBackup } from "./run-daily-database-backup.mjs";
import { sanitizeDailyFailure, writeSafeDailyDiagnostic } from "./write-safe-daily-diagnostic.mjs";

const id = "52ee0781-58c9-4711-bad3-85d0cf83e5fe";
const safePython = JSON.stringify({ state: "package_preparation_failed_safe",
  code: "encrypt_age_operation_timeout", secretsPrinted: false, packageInputBytes: 9999,
  privateText: "PRIVATE RECIPIENT AND PATH" });
const safePublic = JSON.stringify({ state: "database_public_backup_failed_safe",
  stage: "encrypt", code: "encrypt_age_operation_timeout", secretsPrinted: false,
  packageInputBytes: 9999,
  privateText: "PRIVATE RECIPIENT AND PATH" });

test("Python and public wrapper accept only fixed preparation codes", () => {
  assert.deepEqual(safePythonPreparationFailure(safePython),
    { code: "encrypt_age_operation_timeout" });
  assert.deepEqual(publicPreparationFailure({ code: "encrypt_age_operation_timeout",
    privateText: "PRIVATE" }, "--prepare-daily"),
  { state: "database_public_backup_failed_safe", stage: "encrypt",
    code: "encrypt_age_operation_timeout", secretsPrinted: false });
  assert.equal(publicPreparationFailure({ code: "encrypt_age_operation_timeout" },
    "--copy-daily"), null);
  assert.deepEqual(publicPreparationFailure({ code: "database_runner_requires_committed_checkpoint" },
    "--prepare-daily"), { state: "database_public_backup_failed_safe", stage: "encrypt",
    code: "encrypt_source_revision_unverified", secretsPrinted: false });
  assert.deepEqual(publicPreparationFailure(Error("PRIVATE PATH"), "--prepare-daily"),
    { state: "database_public_backup_failed_safe", stage: "encrypt",
      code: "encrypt_unexpected_failure", secretsPrinted: false });
  assert.deepEqual(safeDailyChildFailure(safePublic),
    { code: "encrypt_age_operation_timeout" });
  for (const value of [
    { state: "package_preparation_failed_safe", code: "PRIVATE PATH", secretsPrinted: false },
    { state: "package_preparation_failed_safe", code: "encrypt_age_operation_timeout", secretsPrinted: true },
  ]) assert.equal(safePythonPreparationFailure(JSON.stringify(value)), null);
  assert.equal(safeDailyChildFailure(JSON.stringify({ state: "database_public_backup_failed_safe",
    stage: "copy", code: "encrypt_age_operation_timeout", secretsPrinted: false })), null);
  assert.equal(safeDailyChildFailure("PRIVATE STDERR"), null);
  const sized = { code: "encrypt_package_size_invalid", packageInputBytes: 2_147_483_649 };
  assert.deepEqual(publicPreparationFailure(sized, "--prepare-daily"), {
    state: "database_public_backup_failed_safe", stage: "encrypt",
    ...sized, secretsPrinted: false });
  assert.deepEqual(safeDailyChildFailure(JSON.stringify({ state: "database_public_backup_failed_safe",
    stage: "encrypt", ...sized, secretsPrinted: false })), sized);
  assert.deepEqual(safeDailyChildFailure(JSON.stringify({ state: "database_public_backup_failed_safe",
    stage: "encrypt", code: "encrypt_package_size_invalid", packageInputBytes: "PRIVATE",
    secretsPrinted: false })), { code: "encrypt_package_size_invalid" });
});

test("failed encrypt reaches only the allowlisted daily artifact, without retry", async () => {
  const base = await mkdtemp(join(tmpdir(), "daily-encrypt-safe-"));
  let calls = 0;
  try {
    await assert.rejects(runDailyDatabaseBackup({ base, runId: id, day: "20261019",
      execute: async () => {
        calls++;
        if (calls === 1) return JSON.stringify({ stage: "export_complete_restore_unverified",
          archiveBytes: 1048576 });
        if (calls === 2) return JSON.stringify({ state: "daily_native_restore_verified_vault_pending",
          containerRemoved: true, productionWrites: false });
        const error = Error("PRIVATE RECIPIENT AND PATH");
        error.safeDiagnostic = safeDailyChildFailure(safePublic);
        throw error;
      },
    }), error => {
      assert.deepEqual(error.safeDiagnostic,
        { stage: "encrypt", code: "encrypt_age_operation_timeout" });
      return true;
    });
    assert.equal(calls, 3);
    const failed = JSON.parse(await readFile(join(base, `database-daily-run-${id}`, "failed.json")));
    assert.equal(failed.code, "encrypt_age_operation_timeout");
    const safe = await writeSafeDailyDiagnostic(base);
    assert.deepEqual(safe, { state: "daily_backup_not_verified", stage: "encrypt",
      code: "encrypt_age_operation_timeout", productionWrites: false });
    assert.equal((await readFile(join(base, "safe-diagnostic.json"), "utf8"))
      .includes("PRIVATE"), false);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("artifact rejects forged or cross-stage encrypt codes", () => {
  const base = { state: "daily_backup_not_verified", stage: "encrypt",
    productionWrites: false };
  assert.deepEqual(sanitizeDailyFailure({ ...base, code: "PRIVATE PATH" }),
    { state: "daily_backup_not_verified", code: "diagnostic_unavailable" });
  assert.deepEqual(sanitizeDailyFailure({ ...base, code: "encrypt_age_operation_failed",
    privateText: "PRIVATE" }), { ...base, code: "encrypt_age_operation_failed" });
  assert.deepEqual(sanitizeDailyFailure({ ...base, stage: "copy",
    code: "encrypt_age_operation_failed" }),
  { state: "daily_backup_not_verified", code: "diagnostic_unavailable" });
  assert.deepEqual(sanitizeDailyFailure({ ...base,
    code: "encrypt_file_size_invalid", packageInputBytes: 2_147_483_649 }),
  { ...base, code: "encrypt_file_size_invalid", packageInputBytes: 2_147_483_649 });
});
