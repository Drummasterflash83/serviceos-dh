import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeDailyFailure, writeSafeDailyDiagnostic } from "./write-safe-daily-diagnostic.mjs";

test("diagnostic artifact drops private fields and rejects forged codes", async () => {
  assert.deepEqual(sanitizeDailyFailure({ state: "daily_backup_not_verified",
    stage: "native_restore", restoreStage: "preparing_local_roles",
    code: "restore_unexpected_key", productionWrites: false,
    privateText: "never publish", runId: "sensitive" }),
  { state: "daily_backup_not_verified", stage: "native_restore",
    restoreStage: "preparing_local_roles", code: "restore_unexpected_key",
    productionWrites: false });
  assert.deepEqual(sanitizeDailyFailure({ state: "daily_backup_not_verified",
    stage: "native_restore", code: "private value", productionWrites: false }),
  { state: "daily_backup_not_verified", code: "diagnostic_unavailable" });
});

test("only one failed journal can become the uploaded diagnostic", async () => {
  const root = await mkdtemp(join(tmpdir(), "safe-daily-diagnostic-"));
  try {
    const run = join(root, "database-daily-run-52ee0781-58c9-4711-bad3-85d0cf83e5fe");
    await mkdir(run);
    await writeFile(join(run, "failed.json"), JSON.stringify({
      state: "daily_backup_not_verified", stage: "native_restore",
      restoreStage: "comparing_native_archive_rows",
      code: "restore_native_copy_process_failed", productionWrites: false,
      privateText: "never publish" }));
    const result = await writeSafeDailyDiagnostic(root);
    assert.equal(result.code, "restore_native_copy_process_failed");
    const file = await readFile(join(root, "safe-diagnostic.json"), "utf8");
    assert.equal(file.includes("never publish"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
