import test from "node:test";
import assert from "node:assert/strict";
import { loadDatabaseCredential } from "./serviceos-database-backup-access.mjs";

const role = "Writer";
const value = { accessKeyId: "AKIA" + "A".repeat(16),
  secretAccessKey: "b".repeat(40),
  principalArn: "arn:aws:iam::235099643372:user/serviceos/database-backup/openfolk-serviceos-database-backup-Writer-Example" };
const hosted = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "Drummasterflash83/serviceos-dh",
  GITHUB_REF: "refs/heads/main", RUNNER_ARCH: "ARM64",
  SERVICEOS_DATABASE_BACKUP_WRITER_JSON: JSON.stringify(value) };

test("hosted Writer uses only the exact scoped runner secret", async () => {
  const noKeychain = async () => { throw Error("keychain_must_not_be_called"); };
  assert.deepEqual(await loadDatabaseCredential(role, noKeychain, hosted), value);
  for (const changed of [
    { GITHUB_REF: "refs/heads/other" },
    { RUNNER_ARCH: "X64" },
    { SERVICEOS_DATABASE_BACKUP_WRITER_JSON: JSON.stringify({ ...value, principalArn: "arn:aws:iam::235099643372:user/other" }) },
  ]) await assert.rejects(loadDatabaseCredential(role, noKeychain, { ...hosted, ...changed }),
    /database_scoped_credential_unverified/);
});
