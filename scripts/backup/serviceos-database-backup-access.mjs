/** Read only the separately approved database machine identities from Keychain. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { databaseBackupBinding as binding } from "./database-backup-template.mjs";
import { RecordingBackupError } from "./recording-backup-core.mjs";
export async function loadDatabaseCredential(role, execute = promisify(execFile), env = process.env) {
  if (!["Writer", "Restore"].includes(role))
    throw new RecordingBackupError("database_credential_role_invalid");
  try {
    const hostedName = `SERVICEOS_DATABASE_BACKUP_${role.toUpperCase()}_JSON`;
    const hosted = env[hostedName] !== undefined;
    if (hosted && (env.GITHUB_ACTIONS !== "true" ||
      env.GITHUB_REPOSITORY !== "Drummasterflash83/serviceos-dh" ||
      env.GITHUB_REF !== "refs/heads/main" || env.RUNNER_ARCH !== "ARM64"))
      throw Error("hosted_database_credential_scope_invalid");
    const stdout = hosted ? env[hostedName] : (await execute(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-s",
        `OpenFolk.ServiceOS.DatabaseBackup.${role}`,
        "-a",
        binding.accountId,
        "-w",
      ],
      { encoding: "utf8", timeout: 15000, maxBuffer: 4096 },
    )).stdout;
    const value = JSON.parse(stdout);
    if (
      !/^AKIA[A-Z0-9]{16}$/.test(value?.accessKeyId ?? "") ||
      !/^[A-Za-z0-9/+=]{40}$/.test(value?.secretAccessKey ?? "") ||
      !new RegExp(
        `^arn:aws:iam::235099643372:user/serviceos/database-backup/openfolk-serviceos-database-backup-${role}-[A-Za-z0-9]+$`,
      ).test(value?.principalArn ?? "")
    )
      throw Error("invalid");
    return value;
  } catch {
    throw new RecordingBackupError("database_scoped_credential_unverified");
  }
}
