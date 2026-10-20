/** Publish only allowlisted non-sensitive failure fields from a hosted attempt. */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENCRYPT_CODES, safeEncryptDiagnostic } from "./database-encrypt-safe-codes.mjs";

const PRIVATE = fileURLToPath(new URL("../../.verification-results/", import.meta.url));
const STAGES = new Set(["preflight", "export", "native_restore", "encrypt", "copy"]);
const EXPORT_STAGES = new Set(["preflight", "opening_snapshot", "exporting_native_archive",
  "export_complete_restore_unverified"]);
const RESTORE_STAGES = new Set(["preflight", "preparing_local_roles",
  "restoring_native_archive", "comparing_native_archive_rows",
  "verifying_all_table_fingerprints"]);
const CODES = new Set(["stage_unconfirmed", "native_export_diagnostic_unavailable",
  "native_export_permission_denied", "native_export_version_mismatch",
  "native_export_connection_lost", "native_export_disk_full",
  "native_export_query_failed", "native_export_failed_unclassified",
  "native_export_no_progress", "native_export_duration_limit",
  "export_disk_preflight_failed", "export_image_pin_failed",
  "export_source_reader_unavailable", "export_snapshot_query_timeout",
  "export_snapshot_connection_failed", "export_failure_unclassified",
  "restore_command_unavailable_or_timeout", "restore_container_command_failed",
  "restore_database_startup_failed", "restore_containment_failed",
  "restore_image_pin_failed", "restore_archive_integrity_failed",
  "restore_archive_changed", "restore_row_mismatch", "restore_sequence_mismatch",
  "restore_catalog_mismatch", "restore_extension_mismatch",
  "restore_cleanup_unconfirmed", "restore_failure_unclassified",
  "restore_inventory_coverage_mismatch", "restore_no_actor_access_mismatch",
  "restore_network_supplement_integrity_failed", "restore_native_stream_bound_or_truncated",
  "restore_native_line_bound", "restore_native_total_bound", "restore_native_line_truncated",
  "restore_native_row_bound", "restore_native_copy_process_failed",
  "restore_native_statement_unrecognized", "restore_network_columns_mismatch",
  "restore_network_rows_bound", "restore_unexpected_key", "restore_unexpected_type",
  "restore_unexpected_value", "restore_unexpected_index", "restore_unexpected_os",
  "restore_unexpected_json", "restore_unexpected_timeout", "restore_unexpected_other"]);

export function sanitizeDailyFailure(value) {
  if (value?.state !== "daily_backup_not_verified" ||
      !STAGES.has(value.stage) ||
      !(value.stage === "encrypt" ? value.code === "stage_unconfirmed" ||
        ENCRYPT_CODES.has(value.code) : CODES.has(value.code)) ||
      value.productionWrites !== false) {
    return { state: "daily_backup_not_verified", code: "diagnostic_unavailable" };
  }
  const encrypt = value.stage === "encrypt" ? safeEncryptDiagnostic(value) : null;
  return { state: value.state, stage: value.stage, code: value.code,
    ...(EXPORT_STAGES.has(value.exportStage) ? { exportStage: value.exportStage } : {}),
    ...(RESTORE_STAGES.has(value.restoreStage) ? { restoreStage: value.restoreStage } : {}),
    ...(encrypt?.packageInputBytes === undefined ? {} :
      { packageInputBytes: encrypt.packageInputBytes }),
    ...(encrypt?.archiveBytes === undefined ? {} : { archiveBytes: encrypt.archiveBytes }),
    productionWrites: false };
}

export async function writeSafeDailyDiagnostic(root = PRIVATE) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^database-daily-run-[a-f0-9-]{36}$/.test(entry.name))
    .map((entry) => entry.name);
  let safe = { state: "daily_backup_not_verified", code: "diagnostic_unavailable" };
  if (dirs.length === 1) {
    try {
      safe = sanitizeDailyFailure(JSON.parse(await readFile(join(root, dirs[0], "failed.json"), "utf8")));
    } catch { /* No raw error reaches the uploaded artifact. */ }
  }
  const destination = join(root, "safe-diagnostic.json");
  await writeFile(destination, JSON.stringify(safe) + "\n", { flag: "wx", mode: 0o600 });
  return safe;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await writeSafeDailyDiagnostic();
}
