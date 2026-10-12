/** Bounded encrypted artifact transfer; never exports a database or reads a key.
 * The caller must first complete local package/restore verification. A successful
 * result proves stored ciphertext only, not database or full-service recovery. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { databaseBackupBinding as binding } from "./database-backup-template.mjs";
import { RecordingBackupError } from "./recording-backup-core.mjs";
const MAX_BYTES = 1024 ** 3;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) =>
  JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
const need = (ok, code) => {
  if (!ok) throw new RecordingBackupError(code);
};
const guard = async (work) => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RecordingBackupError) throw error;
    throw new RecordingBackupError("database_transfer_unconfirmed");
  }
};
function descriptor(value) {
  need(
    value?.format === "serviceos-database-package/1" &&
      value.project === binding.project &&
      /^age1[0-9a-z]{58}$/.test(value.recipient ?? "") &&
      /^[0-9a-f]{40}$/.test(value.sourceRevision ?? "") &&
      Number.isFinite(Date.parse(value.snapshotAt)) &&
      /^[0-9a-f]{64}$/.test(value.sha256 ?? "") &&
      Number.isSafeInteger(value.bytes) &&
      value.bytes > 0 &&
      value.bytes <= MAX_BYTES,
    "database_descriptor_invalid",
  );
  return {
    format: value.format,
    project: value.project,
    snapshotAt: value.snapshotAt,
    recipient: value.recipient,
    sourceRevision: value.sourceRevision,
    bytes: value.bytes,
    sha256: value.sha256,
  };
}
const identity = (d) => sha(canonical(d));
const keyFor = (d) => `${binding.prefix}objects/${identity(d)}/${d.sha256}`;
function version(v, d, now) {
  need(
    v?.key === keyFor(d) &&
      v.size === d.bytes &&
      v.sha256 === d.sha256 &&
      typeof v.versionId === "string" &&
      v.versionId.length > 0 &&
      v.versionId.length <= 1024 &&
      v.versionId !== "null" &&
      v.encryption === "AES256" &&
      v.retentionMode === "GOVERNANCE" &&
      Number.isFinite(Date.parse(v.createdAt)) &&
      Date.parse(v.createdAt) <= now + 60000 &&
      Date.parse(v.retainUntil) >= Date.parse(v.createdAt) + 30 * 86400000 - 1000,
    "database_object_unverified",
  );
}
async function destination(port) {
  const s = await port.inspect();
  need(
    ["accountId", "region", "bucket", "prefix", "project"].every((k) => s?.[k] === binding[k]) &&
      s.private === true &&
      s.tlsRequired === true &&
      s.versioning === "Enabled" &&
      s.encryption === "AES256" &&
      s.retentionMode === "GOVERNANCE" &&
      s.retentionDays === 30 &&
      s.conditionalWritesRequired === true,
    "database_destination_unverified",
  );
}
async function privateParent(path) {
  const s = await lstat(dirname(path));
  need(
    s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid() && (s.mode & 0o077) === 0,
    "database_private_directory_required",
  );
}
async function consume(stream, d, file) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of stream) {
    need(chunk instanceof Uint8Array, "database_stream_invalid");
    size += chunk.byteLength;
    need(size <= d.bytes, "database_stream_size_mismatch");
    hash.update(chunk);
    if (file) {
      let offset = 0;
      while (offset < chunk.byteLength) {
        const { bytesWritten } = await file.write(chunk, offset, chunk.byteLength - offset);
        need(bytesWritten > 0, "database_download_write_failed");
        offset += bytesWritten;
      }
    }
  }
  need(size === d.bytes && hash.digest("hex") === d.sha256, "database_stream_integrity_mismatch");
}
async function verifiedRead(v, d, port, now, file) {
  version(v, d, now);
  const current = await port.version(v.key, v.versionId);
  version(current, d, now);
  need(canonical(current) === canonical(v), "database_version_changed");
  await consume(await port.read(v.key, v.versionId), d, file);
}
export async function uploadDatabasePackage(path, input, ports, { now = Date.now } = {}) {
  return guard(async () => {
    const d = descriptor(input);
    await privateParent(path);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      need(
        stat.isFile() &&
          stat.uid === process.getuid() &&
          (stat.mode & 0o077) === 0 &&
          stat.size === d.bytes,
        "database_package_file_invalid",
      );
      const magic = Buffer.alloc(22);
      await file.read(magic, 0, magic.length, 0);
      need(magic.toString() === "age-encryption.org/v1\n", "database_package_not_age");
      await consume(file.createReadStream({ start: 0, autoClose: false }), d);
      await destination(ports.destination);
      const prior = await ports.journal.load(identity(d));
      let v;
      if (prior !== null) {
        need(
          prior?.contract === "database-backup-receipt/1" &&
            canonical(prior.descriptor) === canonical(d) &&
            canonical(prior.destination) === canonical(binding),
          "database_receipt_conflict",
        );
        v = prior.object;
      } else {
        v = await ports.destination.find(keyFor(d));
        if (v === null)
          v = await ports.destination.put({
            key: keyFor(d),
            size: d.bytes,
            sha256: d.sha256,
            checksumSHA256: Buffer.from(d.sha256, "hex").toString("base64"),
            ifNoneMatch: "*",
            encryption: "AES256",
            body: () => file.createReadStream({ start: 0, autoClose: false }),
          });
      }
      await verifiedRead(v, d, ports.destination, now());
      const receipt = {
        contract: "database-backup-receipt/1",
        destination: { ...binding },
        descriptor: d,
        object: v,
      };
      const saved = prior ?? (await ports.journal.saveIfAbsent(identity(d), receipt));
      need(canonical(saved) === canonical(receipt), "database_receipt_conflict");
      return { state: "encrypted_database_copy_verified", receipt, databaseRestoreVerified: false };
    } finally {
      await file.close();
    }
  });
}
export async function downloadDatabasePackage(receipt, path, ports, { now = Date.now } = {}) {
  return guard(async () => {
    const d = descriptor(receipt?.descriptor);
    need(
      receipt?.contract === "database-backup-receipt/1" &&
        canonical(receipt.destination) === canonical(binding),
      "database_receipt_conflict",
    );
    await privateParent(path);
    await destination(ports.destination);
    let file;
    try {
      file = await open(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      await verifiedRead(receipt.object, d, ports.destination, now(), file);
      await file.sync();
    } catch (error) {
      if (file) {
        await file.close();
        file = undefined;
        await unlink(path);
      }
      throw error;
    } finally {
      if (file) await file.close();
    }
    return {
      state: "encrypted_database_download_verified",
      descriptor: d,
      databaseRestoreVerified: false,
    };
  });
}
