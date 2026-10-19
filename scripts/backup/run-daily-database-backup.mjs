/** One unattended database backup attempt. Activation/scheduling is separate. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const PRIVATE = join(REPO, ".verification-results");
const ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SAFE_EXPORT_STAGES = new Set(["preflight", "opening_snapshot",
  "exporting_native_archive", "export_complete_restore_unverified"]);
const SAFE_EXPORT_CODES = new Set(["native_export_diagnostic_unavailable",
  "native_export_permission_denied", "native_export_version_mismatch",
  "native_export_connection_lost", "native_export_disk_full",
  "native_export_query_failed", "native_export_failed_unclassified",
  "native_export_no_progress", "native_export_duration_limit",
  "export_disk_preflight_failed", "export_image_pin_failed",
  "export_source_reader_unavailable", "export_snapshot_query_timeout",
  "export_snapshot_connection_failed", "export_failure_unclassified"]);
const SAFE_RESTORE_STAGES = new Set(["preflight", "preparing_local_roles",
  "restoring_native_archive", "comparing_native_archive_rows",
  "verifying_all_table_fingerprints"]);
const SAFE_RESTORE_CODES = new Set(["restore_command_unavailable_or_timeout",
  "restore_container_command_failed", "restore_database_startup_failed",
  "restore_containment_failed", "restore_image_pin_failed",
  "restore_archive_integrity_failed", "restore_archive_changed",
  "restore_row_mismatch", "restore_sequence_mismatch",
  "restore_catalog_mismatch", "restore_extension_mismatch",
  "restore_cleanup_unconfirmed", "restore_failure_unclassified",
  "restore_native_stream_bound_or_truncated", "restore_native_row_bound",
  "restore_native_copy_process_failed", "restore_native_statement_unrecognized"]);
function safeExportDiagnostic(value) {
  return value && SAFE_EXPORT_STAGES.has(value.exportStage) &&
    SAFE_EXPORT_CODES.has(value.code)
    ? { exportStage: value.exportStage, code: value.code } : null;
}
function safeRestoreDiagnostic(value) {
  return value && SAFE_RESTORE_STAGES.has(value.restoreStage) &&
    SAFE_RESTORE_CODES.has(value.code)
    ? { restoreStage: value.restoreStage, code: value.code } : null;
}
const STAGES = [
  ["export", "node", (source) => ["scripts/backup/export-production-database.mjs", "--export-unattended-daily", source], 100],
  ["native_restore", "python3", (source) => ["-B", "scripts/backup/verify_daily_native_export.py", source], 110],
  ["encrypt", "node", (source, id) => ["scripts/backup/run-public-database-backup.mjs", "--prepare-daily", id, source], 20],
  ["copy", "node", (source, id) => ["scripts/backup/run-public-database-backup.mjs", "--copy-daily", id, source], 40],
];

async function saveNew(path, value) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + "\n");
    await file.sync();
  } finally { await file.close(); }
}

async function runStage(command, args, minutes) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: REPO, stdio: ["ignore", "pipe", "ignore"] });
    let size = 0, failed = false;
    const chunks = [];
    const stop = () => { failed = true; child.kill("SIGINT"); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const timer = setTimeout(stop, minutes * 60000);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) stop();
      else chunks.push(chunk);
    });
    child.on("error", () => { failed = true; });
    child.once("close", (code) => {
      clearTimeout(timer);
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      if (failed || code !== 0) {
        let safe = null;
        try {
          const last = JSON.parse(Buffer.concat(chunks).toString("utf8").trim().split("\n").at(-1));
          if (last?.state === "export_failed_safe" && last.secretsPrinted === false)
            safe = safeExportDiagnostic({ exportStage: last.stage, code: last.code });
          else if (last?.state === "native_restore_failed_safe" && last.secretsPrinted === false)
            safe = safeRestoreDiagnostic({ restoreStage: last.stage, code: last.code });
        } catch { /* Unknown child output never enters hosted logs. */ }
        const error = Error("daily_stage_unconfirmed");
        error.safeDiagnostic = safe;
        reject(error);
      }
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

export async function runDailyDatabaseBackup({
  runId = randomUUID(),
  day = new Date().toISOString().slice(0, 10).replaceAll("-", ""),
  execute = runStage,
  save = saveNew,
  base = PRIVATE,
} = {}) {
  if (!ID.test(runId) || !/^20[0-9]{6}$/.test(day)) throw Error("daily_backup_binding_invalid");
  const source = `.verification-results/production-database-daily-${day}-${runId}`;
  const journal = join(base, `database-daily-run-${runId}`);
  await mkdir(journal, { mode: 0o700 });
  await save(join(journal, "started.json"), { contract: "database-daily-attempt/1",
    runId, source, startedAt: new Date().toISOString(), productionWrites: false });
  let stage = "preflight";
  try {
    for (const [name, command, args, minutes] of STAGES) {
      stage = name;
      const output = await execute(command, args(source, runId), minutes);
      let result;
      try { result = JSON.parse(output.trim().split("\n").at(-1)); }
      catch { throw Error("daily_stage_result_invalid"); }
      if (name === "copy") {
        if (result.state !== "encrypted_offsite_copy_and_download_verified_restore_pending" ||
          result.independentStorageVerified !== true || result.recoveryKeyRead !== false ||
          result.databaseRestoreVerified !== false) throw Error("daily_copy_unconfirmed");
        const verified = { contract: "database-daily-attempt/1",
          state: "one_unattended_copy_verified_restore_pending", runId, source,
          completedAt: new Date().toISOString(), copyAttempt: result.attempt,
          encryptedBytes: result.encryptedBytes, independentStorageVerified: true,
          recoveryKeyRead: false, databaseRestoreVerified: false,
          sustainedDailyOperationVerified: false, fullApplicationRecoveryVerified: false,
          productionWrites: false };
        await save(join(journal, "verified.json"), verified);
        return verified;
      }
      if (name === "export" && (result.stage !== "export_complete_restore_unverified" ||
        !Number.isSafeInteger(result.archiveBytes) || result.archiveBytes <= 0))
        throw Error("daily_export_unconfirmed");
      if (name === "native_restore" &&
        (result.state !== "daily_native_restore_verified_vault_pending" ||
          result.containerRemoved !== true || result.productionWrites !== false))
        throw Error("daily_native_restore_unconfirmed");
      if (name === "encrypt" &&
        (result.state !== "package_encrypted_native_evidence_verified_vault_pending" ||
          result.recoveryKeyRead !== false)) throw Error("daily_encryption_unconfirmed");
      await save(join(journal, `${name}.json`), { stage: name,
        state: "completed", at: new Date().toISOString(), productionWrites: false });
    }
    throw Error("daily_pipeline_incomplete");
  } catch (error) {
    const diagnosis = stage === "export" ? safeExportDiagnostic(error?.safeDiagnostic)
      : stage === "native_restore" ? safeRestoreDiagnostic(error?.safeDiagnostic) : null;
    const failure = { contract: "database-daily-attempt/1",
      state: "daily_backup_not_verified", runId, stage,
      ...(diagnosis ? diagnosis : { code: "stage_unconfirmed" }),
      inspectionRequired: true, productionWrites: false };
    await save(join(journal, "failed.json"), failure);
    const reported = Error("daily_backup_not_verified");
    reported.safeDiagnostic = { stage, ...(diagnosis ?? { code: "stage_unconfirmed" }) };
    throw reported;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).join(" ") !== "--run-once")
      throw Error("daily_backup_mode_invalid");
    console.log(JSON.stringify(await runDailyDatabaseBackup()));
  } catch (error) {
    console.error(JSON.stringify({ state: "daily_backup_not_verified",
      ...(error?.safeDiagnostic ?? { stage: "preflight", code: "stage_unconfirmed" }),
      secretsPrinted: false }));
    process.exitCode = 1;
  }
}
