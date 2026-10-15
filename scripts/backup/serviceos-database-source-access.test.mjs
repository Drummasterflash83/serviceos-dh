import test from "node:test";
import assert from "node:assert/strict";
import { loadDatabaseSourceReader } from "./serviceos-database-source-access.mjs";

const good = { project: "tgbnakbxwcqjeimygroz", role: "serviceos_backup_reader",
  host: "aws-1-eu-west-2.pooler.supabase.com", password: "a".repeat(40) };
test("daily source login is bound to the exact dedicated Keychain item", async () => {
  let called;
  const value = await loadDatabaseSourceReader(async (...args) => {
    called = args;
    return { stdout: JSON.stringify(good) };
  });
  assert.deepEqual(value, good);
  assert.equal(called[0], "python3");
  assert.equal(called[1][0], "-B");
  assert.match(called[1][1], /\/scripts\/backup\/database-source-keychain\.py$/);
  assert.equal(called[1][2], "--get");
});
test("daily source login rejects changed scope, unbounded secret and extra fields", async () => {
  for (const value of [
    { ...good, project: "saatxzwxvdvqevbnskxy" },
    { ...good, role: "postgres" },
    { ...good, host: "example.invalid" },
    { ...good, password: "short" },
    { ...good, extra: "unexpected" },
  ]) await assert.rejects(loadDatabaseSourceReader(async () => ({ stdout: JSON.stringify(value) })),
    /database_source_reader_unavailable/);
});
test("hosted reader accepts only the exact ARM main-branch environment", async () => {
  const hosted = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "Drummasterflash83/serviceos-dh",
    GITHUB_REF: "refs/heads/main", RUNNER_ARCH: "ARM64",
    SERVICEOS_DATABASE_SOURCE_READER_JSON: JSON.stringify(good) };
  const noKeychain = async () => { throw Error("keychain_must_not_be_called"); };
  assert.deepEqual(await loadDatabaseSourceReader(noKeychain, hosted), good);
  for (const changed of [
    { GITHUB_REF: "refs/heads/codex/learn-v1-test" },
    { GITHUB_REPOSITORY: "other/repo" },
    { RUNNER_ARCH: "X64" },
    { SERVICEOS_DATABASE_SOURCE_READER_JSON: JSON.stringify({ ...good, role: "postgres" }) },
  ]) await assert.rejects(loadDatabaseSourceReader(noKeychain, { ...hosted, ...changed }),
    /database_source_reader_unavailable/);
});
