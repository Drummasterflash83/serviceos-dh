/** Reads an existing approved machine credential; never creates access. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RecordingBackupError } from "./recording-backup-core.mjs";
const fail = (code) => {
  throw new RecordingBackupError(code);
};
export const binding = Object.freeze({
  tenantId: "00000000-0000-0000-0000-000000000001",
  sourceProjectRef: "tgbnakbxwcqjeimygroz",
  accountId: "235099643372",
  region: "eu-west-2",
  bucket: "openfolk-drummonds-recordings-235099643372-eu-west-2",
  prefix: "tenants/00000000-0000-0000-0000-000000000001/",
});
export async function loadRecordingCredential(role, execute = promisify(execFile)) {
  if (!["Writer", "Restore"].includes(role)) fail("runner_credential_role_invalid");
  // No fallback to root, environment/profile keys or the other machine role.
  const { stdout } = await execute(
    "/usr/bin/security",
    [
      "find-generic-password",
      "-s",
      `OpenFolk.ServiceOS.RecordingBackup.${role}`,
      "-a",
      binding.accountId,
      "-w",
    ],
    { encoding: "utf8", timeout: 15000, maxBuffer: 4096 },
  );
  const value = JSON.parse(stdout);
  if (
    !/^AKIA[A-Z0-9]{16}$/.test(value?.accessKeyId ?? "") ||
    !/^[A-Za-z0-9/+=]{40}$/.test(value?.secretAccessKey ?? "") ||
    !new RegExp(
      `^arn:aws:iam::235099643372:user/serviceos/recording-backup/openfolk-drummonds-recording-access-${role}-[A-Za-z0-9]+$`,
    ).test(value?.principalArn ?? "")
  )
    fail(
      role === "Writer"
        ? "runner_writer_credential_unverified"
        : "runner_restore_credential_unverified",
    );
  return value;
}
