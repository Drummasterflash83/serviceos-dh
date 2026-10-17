/** Download one exact immutable scheduled database copy in bounded ranges.
 * Rehashes the complete age ciphertext before declaring recovery input ready.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { S3Client, ListObjectVersionsCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { mkdir, lstat, open, link, unlink, realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDatabaseCredential } from "./serviceos-database-backup-access.mjs";
import { createDatabaseS3 } from "./recording-backup-s3.mjs";
import { databaseBackupBinding as binding } from "./database-backup-template.mjs";

const parent = join(fileURLToPath(new URL("../../", import.meta.url)),
  ".verification-results");
const root = join(parent, "build01-scheduled-database-20261017");
const bytes = 1_638_226_616;
const earliest = Date.parse("2026-10-17T07:51:38Z");
const latest = Date.parse("2026-10-17T08:09:23Z");
const chunkBytes = 64 * 1024 * 1024;
const need = (ok, code) => { if (!ok) throw Error(code); };

async function selectExact(s3, ports) {
  const prefix = `${binding.prefix}objects/`;
  const found = [];
  let keyMarker, versionMarker;
  for (let pageNo = 0; pageNo < 4; pageNo++) {
    const page = await s3.send(new ListObjectVersionsCommand({
      Bucket: binding.bucket, ExpectedBucketOwner: binding.accountId,
      Prefix: prefix, MaxKeys: 1000,
      ...(keyMarker ? { KeyMarker: keyMarker,
        VersionIdMarker: versionMarker } : {}),
    }), { abortSignal: AbortSignal.timeout(30000) });
    for (const value of page.Versions ?? []) {
      const at = value.LastModified instanceof Date
        ? value.LastModified.getTime() : NaN;
      if (at < earliest || at > latest || value.Size !== bytes) continue;
      const suffix = value.Key?.slice(prefix.length) ?? "";
      need(value.Key?.startsWith(prefix) &&
        /^[a-f0-9]{64}\/[a-f0-9]{64}$/.test(suffix) &&
        typeof value.VersionId === "string" && value.VersionId !== "null",
      "scheduled_resume_object_shape_invalid");
      found.push({ key: value.Key, versionId: value.VersionId,
        receiptId: suffix.slice(0, 64) });
    }
    if (!page.IsTruncated) break;
    need(pageNo < 3 && page.NextKeyMarker && page.NextVersionIdMarker,
      "scheduled_resume_listing_incomplete");
    keyMarker = page.NextKeyMarker;
    versionMarker = page.NextVersionIdMarker;
  }
  need(found.length === 1, "scheduled_resume_object_not_unique");
  const object = found[0];
  const receipt = await ports.journal.load(object.receiptId);
  need(receipt?.contract === "database-backup-receipt/1" &&
    receipt.descriptor?.format === "serviceos-database-package/2" &&
    receipt.descriptor?.project === binding.project &&
    receipt.descriptor?.bytes === bytes &&
    receipt.object?.key === object.key &&
    receipt.object?.versionId === object.versionId &&
    receipt.object?.size === bytes &&
    /^[a-f0-9]{64}$/.test(receipt.descriptor?.sha256 ?? ""),
  "scheduled_resume_receipt_mismatch");
  const pinned = await ports.destination.version(object.key, object.versionId);
  need(pinned.key === receipt.object.key &&
    pinned.versionId === receipt.object.versionId &&
    pinned.size === bytes &&
    pinned.sha256 === receipt.descriptor.sha256 &&
    pinned.encryption === "AES256" &&
    pinned.retentionMode === "GOVERNANCE",
  "scheduled_resume_stored_version_changed");
  return { object, receipt };
}

async function main() {
  need(process.argv.slice(2).join(" ") === "--exact-2026-10-17",
    "scheduled_resume_exact_mode_required");
  const base = await lstat(parent);
  need(base.isDirectory() && !base.isSymbolicLink() &&
    base.uid === process.getuid() && (base.mode & 0o077) === 0 &&
    await realpath(parent) === parent,
  "scheduled_resume_private_root_invalid");
  try { await mkdir(root, { mode: 0o700 }); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  const dir = await lstat(root);
  need(dir.isDirectory() && !dir.isSymbolicLink() && dir.uid === process.getuid() &&
    (dir.mode & 0o077) === 0 && await realpath(root) === root,
  "scheduled_resume_private_directory_invalid");
  try { await lstat(join(root, "download-verified.json"));
    throw Error("scheduled_resume_already_verified"); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  const credential = await loadDatabaseCredential("Restore");
  const creds = { accessKeyId: credential.accessKeyId,
    secretAccessKey: credential.secretAccessKey };
  const s3 = new S3Client({ region: binding.region, credentials: creds,
    maxAttempts: 1 });
  const ports = createDatabaseS3({ credentials: async () => creds,
    expectedPrincipalArn: credential.principalArn,
    signal: AbortSignal.timeout(18 * 60 * 1000) });
  try {
    const inspected = await ports.destination.inspect();
    need(inspected.accountId === binding.accountId &&
      inspected.bucket === binding.bucket && inspected.private === true &&
      inspected.versioning === "Enabled" && inspected.retentionMode === "GOVERNANCE",
    "scheduled_resume_destination_unverified");
    const { object, receipt } = await selectExact(s3, ports);
    const prefix = join(root, "snapshot-prefix.age");
    let file;
    try { file = await open(prefix, constants.O_RDWR | constants.O_NOFOLLOW); }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      file = await open(prefix, constants.O_RDWR | constants.O_CREAT |
        constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    }
    try {
      const stat = await file.stat();
      const direct = await lstat(prefix);
      need(stat.isFile() && !direct.isSymbolicLink() &&
        stat.uid === process.getuid() && (stat.mode & 0o077) === 0 &&
        stat.size >= 0 && stat.size < bytes,
      "scheduled_resume_prefix_invalid");
      let position = stat.size;
      while (position < bytes) {
        const end = Math.min(bytes, position + chunkBytes) - 1;
        const expected = end - position + 1;
        let completed = false;
        try {
          const response = await s3.send(new GetObjectCommand({
            Bucket: binding.bucket, ExpectedBucketOwner: binding.accountId,
            Key: object.key, VersionId: object.versionId,
            Range: `bytes=${position}-${end}`,
          }), { abortSignal: AbortSignal.timeout(120000) });
          need(response.VersionId === object.versionId &&
            response.ContentRange === `bytes ${position}-${end}/${bytes}` &&
            response.ContentLength === expected &&
            response.ServerSideEncryption === "AES256" &&
            response.Metadata?.sha256 === receipt.descriptor.sha256,
          "scheduled_resume_range_response_changed");
          let received = 0;
          for await (const part of response.Body) {
            need(part instanceof Uint8Array &&
              received + part.byteLength <= expected,
            "scheduled_resume_range_overflow");
            let offset = 0;
            while (offset < part.byteLength) {
              const write = await file.write(part, offset,
                part.byteLength - offset, position + received + offset);
              need(write.bytesWritten > 0, "scheduled_resume_write_failed");
              offset += write.bytesWritten;
            }
            received += part.byteLength;
          }
          need(received === expected, "scheduled_resume_range_short");
          await file.sync();
          completed = true;
        } finally {
          if (!completed) { await file.truncate(position); await file.sync(); }
        }
        position += expected;
        console.log(JSON.stringify({ state: "encrypted_range_received",
          receivedBytes: position, totalBytes: bytes,
          recoveryKeyRead: false, productionWrites: false }));
      }
      const hash = createHash("sha256");
      for await (const part of file.createReadStream({ start: 0, autoClose: false }))
        hash.update(part);
      need(hash.digest("hex") === receipt.descriptor.sha256,
        "scheduled_resume_full_digest_mismatch");
      const magic = Buffer.alloc(22);
      await file.read(magic, 0, magic.length, 0);
      need(magic.toString() === "age-encryption.org/v1\n",
        "scheduled_resume_age_header_invalid");
    } finally { await file.close(); }
    const completedPath = join(root, "snapshot.age");
    await link(prefix, completedPath); // Exclusive: never replace a prior copy.
    await unlink(prefix);
    const report = { version: "learn-build01-scheduled-recovery-input/1",
      state: "independently_downloaded_ciphertext_verified",
      checkedAt: new Date().toISOString(), githubRunId: 39015198972,
      trigger: "schedule", object, descriptor: receipt.descriptor,
      recoveryKeyRead: false, backupWriterUsed: false,
      productionWrites: false, plaintextRestored: false,
      transfer: "exact-version-bounded-ranges-plus-full-sha256" };
    const output = await open(join(root, "download-verified.json"), "wx", 0o600);
    try { await output.writeFile(JSON.stringify(report, null, 2) + "\n");
      await output.sync(); } finally { await output.close(); }
    console.log(JSON.stringify({ state: report.state, checkedAt: report.checkedAt,
      githubRunId: report.githubRunId, encryptedBytes: bytes,
      sha256: receipt.descriptor.sha256,
      recoveryKeyRead: false, backupWriterUsed: false,
      productionWrites: false }));
  } finally {
    credential.secretAccessKey = "";
    s3.destroy(); ports.close();
  }
}

try { await main(); }
catch { console.error(JSON.stringify({ state: "scheduled_resume_unverified",
  secretOrObjectKeyPrinted: false })); process.exitCode = 1; }
