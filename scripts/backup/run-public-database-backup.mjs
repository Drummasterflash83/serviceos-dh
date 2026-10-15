/** Public-key-only off-site backup stages. Recovery remains a separate action. */
import { readFile, realpath, lstat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { preparePublicDatabaseBackup, copyPreparedDatabaseBackup,
  restoreDownloadedDatabaseBackup } from "./run-serviceos-database-backup.mjs";
import { createRecoveryEscrow } from "./onepassword-database-recovery.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const PRIVATE = join(REPO, ".verification-results");
const [mode, runId, sourceArgument, copyAttempt, bindingArgument] = process.argv.slice(2);
const need = (ok, code) => { if (!ok) throw Error(code); };
async function privateDirectory(path) {
  const s = await lstat(path);
  need(s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid() &&
    (s.mode & 0o077) === 0 && await realpath(path) === path,
    "database_private_directory_invalid");
}
async function privateJson(path) {
  const s = await lstat(path);
  need(s.isFile() && !s.isSymbolicLink() && s.uid === process.getuid() &&
    (s.mode & 0o077) === 0 && s.size > 0 && s.size < 1048576,
    "database_private_metadata_invalid");
  return JSON.parse(await readFile(path, "utf8"));
}
async function main() {
  const daily = mode?.endsWith("-daily") === true;
  const restoring = ["--restore-copy-checkpoint", "--restore-copy-daily"].includes(mode);
  const preparing = ["--prepare-checkpoint", "--prepare-daily"].includes(mode);
  need(["--prepare-checkpoint", "--copy-checkpoint", "--restore-copy-checkpoint",
    "--prepare-daily", "--copy-daily", "--restore-copy-daily"].includes(mode) &&
    /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(runId ?? "") &&
    (daily
      ? /^\.verification-results\/production-database-daily-[0-9]{8}-[a-f0-9-]{36}$/.test(sourceArgument ?? "")
      : /^\.verification-results\/production-release-checkpoint-[0-9]{8}-[a-z0-9-]+$/.test(sourceArgument ?? "")) &&
    (restoring ? process.argv.length === 7 &&
      /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(copyAttempt ?? "") &&
      /^\.verification-results\/[a-z0-9-]+\.json$/.test(bindingArgument ?? "") :
      process.argv.length === 5), "database_public_mode_invalid");
  const source = resolve(REPO, sourceArgument);
  const directory = join(PRIVATE, "database-backup-" + runId);
  need(source.startsWith(PRIVATE + "/"), "database_source_scope_invalid");
  await privateDirectory(PRIVATE);
  await privateDirectory(source);
  const exported = await privateJson(join(source, "report.json"));
  need(exported.project === "tgbnakbxwcqjeimygroz" &&
    exported.state === "export_complete_restore_unverified" &&
    exported.productionDataWrites === false &&
    Number.isSafeInteger(exported.archive?.bytes) &&
    exported.archive.bytes > 0 && exported.archive.bytes <= 1024 ** 3 &&
    /^[a-f0-9]{64}$/.test(exported.archive.sha256 ?? ""),
  "database_source_export_unverified");
  const publicKey = JSON.parse(await readFile(join(REPO,
    "infrastructure/database-backup/public-recipient.json"), "utf8"));
  need(publicKey.project === exported.project &&
    publicKey.format === "age-x25519-recipient/1" &&
    /^age1[0-9a-z]{58}$/.test(publicKey.recipient ?? ""),
  "database_public_recipient_invalid");
  const git = promisify(execFile);
  const status = await git("git", ["status", "--porcelain"], { cwd: REPO });
  need(status.stdout.trim() === "", "database_runner_requires_committed_checkpoint");
  if (preparing) {
    const rev = await git("git", ["rev-parse", "HEAD"], { cwd: REPO });
    return preparePublicDatabaseBackup({ source, directory,
      revision: rev.stdout.trim(), recipient: publicKey.recipient,
      expectedArchive: exported.archive,
      formatVersion: daily ? "serviceos-database-package/2" : "serviceos-database-package/1" });
  }
  await privateDirectory(directory);
  const descriptor = await privateJson(join(directory, "descriptor.json"));
  need(descriptor.recipient === publicKey.recipient &&
    descriptor.format === (daily ? "serviceos-database-package/2" : "serviceos-database-package/1"),
    "database_public_recipient_changed");
  if (restoring) {
    const binding = await privateJson(resolve(REPO, bindingArgument));
    return restoreDownloadedDatabaseBackup({ directory, priorAttempt: copyAttempt,
      publicCopy: true, escrow: createRecoveryEscrow(binding),
      expectedArchive: exported.archive });
  }
  return copyPreparedDatabaseBackup({ directory, expectedArchive: exported.archive });
}
try {
  console.log(JSON.stringify(await main()));
} catch {
  console.error(JSON.stringify({ state: "database_public_backup_not_verified", secretsPrinted: false }));
  process.exitCode = 1;
}
