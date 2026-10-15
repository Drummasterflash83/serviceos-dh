import test from "node:test";
import assert from "node:assert/strict";
import { databaseDumpCommand } from "./serviceos-database-export-command.mjs";

test("dedicated daily export never switches to postgres", () => {
  const cmd = databaseDumpCommand("0000001A-0000002B-1", { dedicatedReader: true });
  assert.match(cmd, /--snapshot=0000001A-0000002B-1/);
  assert.doesNotMatch(cmd, /--role=postgres/);
});
test("supervised legacy export keeps its reviewed postgres role switch", () => {
  assert.match(databaseDumpCommand("0000001A-0000002B-1"), /--role=postgres/);
});
test("untrusted snapshot text cannot become shell syntax", () => {
  assert.throws(() => databaseDumpCommand("1-2-3; true", { dedicatedReader: true }),
    /database_snapshot_invalid/);
});
