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
  assert.deepEqual(called[1], ["find-generic-password", "-s",
    "OpenFolk.ServiceOS.DatabaseSource.Reader", "-a", good.project, "-w"]);
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
