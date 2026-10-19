import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyPythonStageFailure, publicPreparationFailure,
  safePythonPreparationFailure, sourceExportPreparationDiagnostic } from
  "./database-encrypt-safe-codes.mjs";
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
  assert.deepEqual(safeDailyChildFailure(JSON.stringify({ state: "database_public_backup_failed_safe",
    stage: "encrypt", code: "encrypt_package_size_invalid", packageInputBytes: 1024 ** 4 + 1,
    secretsPrinted: false })), { code: "encrypt_package_size_invalid" });
});

test("Python size evidence survives the Node wrappers and restricted artifact", () => {
  const python = JSON.stringify({ state: "package_preparation_failed_safe",
    code: "encrypt_package_size_invalid", packageInputBytes: 8_700_000_000,
    secretsPrinted: false, privateText: "PRIVATE PATH AND RECIPIENT" });
  const classified = classifyPythonStageFailure("prepare_public_database_package.py", python, false);
  const error = Error("private subprocess text must not escape");
  error.code = classified.code;
  error.safeDiagnostic = classified.safeDiagnostic;
  const publicLine = publicPreparationFailure(error, "--prepare-daily");
  const daily = safeDailyChildFailure(JSON.stringify(publicLine));
  const artifact = sanitizeDailyFailure({ state: "daily_backup_not_verified",
    stage: "encrypt", ...daily, productionWrites: false });
  assert.deepEqual(artifact, { state: "daily_backup_not_verified", stage: "encrypt",
    code: "encrypt_package_size_invalid", packageInputBytes: 8_700_000_000,
    productionWrites: false });
  assert.equal(JSON.stringify({ publicLine, artifact }).includes("PRIVATE"), false);
});

test("validated archive size survives export, public, daily and artifact wrappers", async () => {
  const bytes = 2 * 1024 ** 3 + 1;
  const exportReport = { project: "tgbnakbxwcqjeimygroz",
    state: "export_complete_restore_unverified", productionDataWrites: false,
    archive: { bytes, sha256: "a".repeat(64) } };
  const archiveStat = { size: bytes, isFile: () => true, isSymbolicLink: () => false };
  const diagnostic = sourceExportPreparationDiagnostic(exportReport, archiveStat, 2 * 1024 ** 3);
  assert.deepEqual(diagnostic, { code: "encrypt_source_archive_size_exceeded", archiveBytes: bytes });
  const error = Error("PRIVATE EXPORT FAILURE");
  error.safeDiagnostic = { ...diagnostic, privateText: "PRIVATE ARCHIVE PATH" };
  const publicLine = publicPreparationFailure(error, "--prepare-daily");
  const daily = safeDailyChildFailure(JSON.stringify(publicLine));
  const base = await mkdtemp(join(tmpdir(), "daily-archive-size-safe-"));
  let calls = 0;
  try {
    await assert.rejects(runDailyDatabaseBackup({ base, runId: id, day: "20261019",
      execute: async () => {
        calls++;
        if (calls === 1) return JSON.stringify({ stage: "export_complete_restore_unverified",
          archiveBytes: bytes });
        if (calls === 2) return JSON.stringify({ state: "daily_native_restore_verified_vault_pending",
          containerRemoved: true, productionWrites: false });
        const failure = Error("PRIVATE ARCHIVE PATH");
        failure.safeDiagnostic = daily;
        throw failure;
      },
    }), /daily_backup_not_verified/);
    assert.equal(calls, 3);
    const artifact = { state: "daily_backup_not_verified", stage: "encrypt",
      code: "encrypt_source_archive_size_exceeded", archiveBytes: bytes,
      productionWrites: false };
    const privateFailure = JSON.parse(await readFile(join(base,
      `database-daily-run-${id}`, "failed.json")));
    assert.equal(privateFailure.archiveBytes, bytes);
    assert.equal(privateFailure.privateText, undefined);
    assert.deepEqual(await writeSafeDailyDiagnostic(base), artifact);
    assert.deepEqual(JSON.parse(await readFile(join(base, "safe-diagnostic.json"))), artifact);
    assert.equal(JSON.stringify({ publicLine, artifact }).includes("PRIVATE"), false);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("source contract failures never disclose unverified archive bytes", () => {
  const bytes = 2 * 1024 ** 3 + 1;
  const exported = { project: "tgbnakbxwcqjeimygroz",
    state: "export_complete_restore_unverified", productionDataWrites: false,
    archive: { bytes, sha256: "b".repeat(64) } };
  const stat = { size: bytes, isFile: () => true, isSymbolicLink: () => false };
  const generic = { code: "encrypt_source_export_unverified" };
  for (const changed of [
    { ...exported, project: "OTHER" },
    { ...exported, state: "exporting_native_archive" },
    { ...exported, productionDataWrites: true },
    { ...exported, archive: { bytes, sha256: "PRIVATE" } },
    { ...exported, archive: { bytes: "PRIVATE", sha256: "b".repeat(64) } },
  ]) assert.deepEqual(sourceExportPreparationDiagnostic(changed, stat, 2 * 1024 ** 3), generic);
  for (const changed of [
    null,
    { ...stat, size: bytes - 1 },
    { ...stat, isFile: () => false },
    { ...stat, isSymbolicLink: () => true },
  ]) assert.deepEqual(sourceExportPreparationDiagnostic(exported, changed, 2 * 1024 ** 3), generic);
  assert.equal(sourceExportPreparationDiagnostic({ ...exported,
    archive: { ...exported.archive, bytes: 2 * 1024 ** 3 } },
  { ...stat, size: 2 * 1024 ** 3 }, 2 * 1024 ** 3), null);
  const forged = sanitizeDailyFailure({ state: "daily_backup_not_verified", stage: "encrypt",
    code: "encrypt_source_archive_size_exceeded", archiveBytes: "PRIVATE",
    productionWrites: false });
  assert.deepEqual(forged, { state: "daily_backup_not_verified", stage: "encrypt",
    code: "encrypt_source_archive_size_exceeded", productionWrites: false });
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
