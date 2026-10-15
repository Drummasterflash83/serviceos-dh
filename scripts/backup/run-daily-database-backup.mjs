/** One unattended database backup attempt. Activation/scheduling is separate. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const PRIVATE = join(REPO, ".verification-results");
const ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const STAGES = [
  ["export", "node", (source) => ["scripts/backup/export-production-database.mjs", "--export-unattended-daily", source], 100],
  ["native_restore", "python3", (source) => ["-B", "scripts/backup/verify_daily_native_export.py", source], 40],
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
      if (failed || code !== 0) reject(Error("daily_stage_unconfirmed"));
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
  } catch {
    await save(join(journal, "failed.json"), { contract: "database-daily-attempt/1",
      state: "daily_backup_not_verified", runId, stage,
      inspectionRequired: true, productionWrites: false });
    throw Error("daily_backup_not_verified");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).join(" ") !== "--run-once")
      throw Error("daily_backup_mode_invalid");
    console.log(JSON.stringify(await runDailyDatabaseBackup()));
  } catch {
    console.error(JSON.stringify({ state: "daily_backup_not_verified", secretsPrinted: false }));
    process.exitCode = 1;
  }
}
