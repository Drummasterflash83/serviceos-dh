/** Fixed public-key package diagnostics; never accept subprocess text or paths. */
export const ENCRYPT_CODES = new Set([
  "encrypt_private_directory_required", "encrypt_regular_file_required",
  "encrypt_file_size_invalid", "encrypt_json_size_invalid",
  "encrypt_package_format_invalid", "encrypt_export_not_complete",
  "encrypt_snapshot_missing", "encrypt_archive_evidence_mismatch",
  "encrypt_supplement_evidence_mismatch", "encrypt_native_restore_unverified",
  "encrypt_row_comparison_unverified", "encrypt_restore_containment_unverified",
  "encrypt_native_fingerprints_unverified", "encrypt_vault_ciphertext_inventory_unverified",
  "encrypt_inventory_incomplete", "encrypt_source_archive_changed",
  "encrypt_output_already_exists", "encrypt_recipient_invalid",
  "encrypt_revision_invalid", "encrypt_package_size_invalid",
  "encrypt_age_binary_pin_mismatch", "encrypt_age_binary_unavailable",
  "encrypt_age_operation_failed",
  "encrypt_age_operation_timeout", "encrypt_disk_full",
  "encrypt_permission_denied", "encrypt_source_missing",
  "encrypt_package_preparation_failed", "encrypt_unexpected_failure",
  "encrypt_source_export_unverified", "encrypt_private_metadata_invalid",
  "encrypt_source_revision_unverified", "encrypt_preparation_binding_invalid",
  "encrypt_python_stage_unconfirmed", "encrypt_package_descriptor_unverified",
  "encrypt_recipient_changed", "encrypt_source_scope_invalid",
  "encrypt_source_archive_size_exceeded",
]);
const MAX_DIAGNOSTIC_ARCHIVE_BYTES = 1024 ** 4;
const PUBLIC_PREPARATION_CODES = new Map([
  ["database_private_directory_invalid", "encrypt_private_directory_required"],
  ["database_runner_directory_invalid", "encrypt_private_directory_required"],
  ["database_private_metadata_invalid", "encrypt_private_metadata_invalid"],
  ["database_source_export_unverified", "encrypt_source_export_unverified"],
  ["database_public_recipient_invalid", "encrypt_recipient_invalid"],
  ["database_runner_requires_committed_checkpoint", "encrypt_source_revision_unverified"],
  ["database_public_preparation_binding_invalid", "encrypt_preparation_binding_invalid"],
  ["database_python_stage_unconfirmed", "encrypt_python_stage_unconfirmed"],
  ["database_initial_package_not_verified", "encrypt_package_descriptor_unverified"],
  ["database_recipient_changed", "encrypt_recipient_changed"],
  ["database_source_scope_invalid", "encrypt_source_scope_invalid"],
]);

export function safeEncryptDiagnostic(value) {
  if (!ENCRYPT_CODES.has(value?.code)) return null;
  const size = value.packageInputBytes;
  const archiveBytes = value.archiveBytes;
  return { code: value.code,
    ...(["encrypt_package_size_invalid", "encrypt_file_size_invalid"].includes(value.code) &&
      Number.isSafeInteger(size) && size >= 0 && size <= 1024 ** 4
      ? { packageInputBytes: size } : {}),
    ...(value.code === "encrypt_source_archive_size_exceeded" &&
      Number.isSafeInteger(archiveBytes) && archiveBytes > 0 &&
      archiveBytes <= MAX_DIAGNOSTIC_ARCHIVE_BYTES
      ? { archiveBytes } : {}) };
}

export function sourceExportPreparationDiagnostic(exported, archiveStat, maxPackageBytes) {
  const bytes = exported?.archive?.bytes;
  if (exported?.project !== "tgbnakbxwcqjeimygroz" ||
    exported.state !== "export_complete_restore_unverified" ||
    exported.productionDataWrites !== false ||
    !Number.isSafeInteger(bytes) || bytes <= 0 ||
    bytes > MAX_DIAGNOSTIC_ARCHIVE_BYTES ||
    !/^[a-f0-9]{64}$/.test(exported.archive?.sha256 ?? "") ||
    !archiveStat?.isFile() || archiveStat.isSymbolicLink() ||
    archiveStat.size !== bytes ||
    !Number.isSafeInteger(maxPackageBytes) || maxPackageBytes <= 0)
    return { code: "encrypt_source_export_unverified" };
  return bytes > maxPackageBytes
    ? { code: "encrypt_source_archive_size_exceeded", archiveBytes: bytes } : null;
}

export function safePythonPreparationFailure(output) {
  try {
    const last = JSON.parse(output.trim().split("\n").at(-1));
    return last?.state === "package_preparation_failed_safe" &&
      last.secretsPrinted === false ? safeEncryptDiagnostic(last) : null;
  } catch { return null; }
}

export function classifyPythonStageFailure(name, output, failed) {
  const safeDiagnostic = !failed && name === "prepare_public_database_package.py"
    ? safePythonPreparationFailure(output) : null;
  return { code: safeDiagnostic?.code ?? "database_python_stage_unconfirmed",
    ...(safeDiagnostic ? { safeDiagnostic } : {}) };
}

export function publicPreparationFailure(error, mode) {
  if (mode !== "--prepare-daily") return null;
  const diagnostic = safeEncryptDiagnostic(error?.safeDiagnostic) ??
    safeEncryptDiagnostic(error) ?? {
    code: PUBLIC_PREPARATION_CODES.get(error?.code ?? error?.message) ?? "encrypt_unexpected_failure" };
  return { state: "database_public_backup_failed_safe",
    stage: "encrypt", ...diagnostic, secretsPrinted: false };
}
