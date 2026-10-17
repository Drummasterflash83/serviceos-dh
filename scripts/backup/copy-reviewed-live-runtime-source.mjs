/** Exact encrypted LIVE Edge source copy. No credential or network access is
 * performed by this module: the caller must supply separately approved Writer
 * and Restore ports. This proves stored ciphertext, not service recovery. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { databaseBackupBinding as destination } from "./database-backup-template.mjs";

export const reviewedLiveRuntimeSource = Object.freeze({
  bytes: 5971576,
  sha256: "4aa6f7ae538077530caa09cd8509b173dc60b97f28dc14e4ccea7d59665b335c",
  // Parent is SHA-256 of the fixed runtime package contract and manifest digest. The existing
  // scoped S3 port accepts only this two-digest object-key grammar.
  key: "projects/tgbnakbxwcqjeimygroz/objects/c384ec8d4be8f271445b68e273197e13bdeaa1655e389f2ef058f88f8b242ab9/4aa6f7ae538077530caa09cd8509b173dc60b97f28dc14e4ccea7d59665b335c",
});

export const reviewedLiveRuntimeSource1705 = Object.freeze({
  bytes: 6012536,
  sha256: "e0c3cbdb8ff2fded1ab5cf879806f8b580a1278f07bfc513290ca3ccab7b2f17",
  key: "projects/tgbnakbxwcqjeimygroz/objects/120b1e3083e80b80e7d623867c1066e782f85a52b7e70c6a8879939245c9833e/e0c3cbdb8ff2fded1ab5cf879806f8b580a1278f07bfc513290ca3ccab7b2f17",
});

export const reviewedLiveRuntimeSource1828 = Object.freeze({
  bytes: 6022776,
  sha256: "796eb3f9ee44e2f233ca244d8fed1f0a2463d266cb74e8c774d7e7aaa73e5a0a",
  key: "projects/tgbnakbxwcqjeimygroz/objects/58dc9f5d80110646fcd4d7f7922541cd7f1c28b9e1bfafcaf084ebe72e7bb6ce/796eb3f9ee44e2f233ca244d8fed1f0a2463d266cb74e8c774d7e7aaa73e5a0a",
});

export const reviewedLiveRuntimeSource1911 = Object.freeze({
  bytes: 6022776,
  sha256: "7cbc837e8e183ceace76cbd5312524c10c0a7f4c10f7dfc1cb1712cbd6e96fac",
  key: "projects/tgbnakbxwcqjeimygroz/objects/e89ec35412a8709eadf63142873c204a1369659e7f48717d3def8eccc56f84ed/7cbc837e8e183ceace76cbd5312524c10c0a7f4c10f7dfc1cb1712cbd6e96fac",
});

export const reviewedLiveRuntimeSource2046 = Object.freeze({
  bytes: 6022776,
  sha256: "afc78ae97474bb2c4d0ce885aeff7fedf1c50098193c016b3f369fba35604bf7",
  key: "projects/tgbnakbxwcqjeimygroz/objects/57b2d97692c211f09a10c1503d71329a89ee03f0e5b0da5afeb7e63fb8c35927/afc78ae97474bb2c4d0ce885aeff7fedf1c50098193c016b3f369fba35604bf7",
});

export const reviewedLiveRuntimeSource2203 = Object.freeze({
  bytes: 6022776,
  sha256: "06205d042fe8a4618ac6d291d654e03cf3ecaadad9d3ae65281069a778cd2ec5",
  key: "projects/tgbnakbxwcqjeimygroz/objects/b789aecbcce6989e7d6e210abeaa03270bcb3cf65533f227909354eaeae2a546/06205d042fe8a4618ac6d291d654e03cf3ecaadad9d3ae65281069a778cd2ec5",
});

export const reviewedLiveRuntimeSource2322 = Object.freeze({
  bytes: 6022776,
  sha256: "dcfcbb300d0239f379f744e55e989fb1a4bcd2b85ab67f1c8b3fa5a940f55473",
  key: "projects/tgbnakbxwcqjeimygroz/objects/a4d892a1387b1c19c53caea3cdfb85d7c15dd80929cd2c5defeef7b5621d1656/dcfcbb300d0239f379f744e55e989fb1a4bcd2b85ab67f1c8b3fa5a940f55473",
});

// Chris's approved one-time, scoped Build 01 credential copy. The first key
// digest separates this object type from Edge source and database snapshots;
// the second is the exact ciphertext hash. No credential value is in this file.
export const reviewedBuild01EdgeCredentialPackage = Object.freeze({
  kind: "edge_credentials",
  bytes: 5094,
  sha256: "6842129fb664e513bd7fa078b7e5080e3b7f44ee3fce7f7aa764d87cce2105aa",
  key: `projects/tgbnakbxwcqjeimygroz/objects/${createHash("sha256")
    .update("serviceos-build01-edge-credential-package/1\n4008cc502a41f5948cfea8e2d06fa3be26ff4f4f7828839f707724b7c49f1488")
    .digest("hex")}/6842129fb664e513bd7fa078b7e5080e3b7f44ee3fce7f7aa764d87cce2105aa`,
});

const fail = (code) => { throw Error(code); };
const need = (condition, code) => { if (!condition) fail(code); };
const canon = (value) => JSON.stringify(value, (_key, entry) =>
  entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]))
    : entry);

async function privateParent(path) {
  const stat = await lstat(dirname(path));
  need(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() &&
    (stat.mode & 0o077) === 0, "runtime_private_directory_required");
}

async function checkedStream(stream, sink, reviewed) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of stream) {
    need(chunk instanceof Uint8Array, "runtime_stream_invalid");
    bytes += chunk.byteLength;
    need(bytes <= reviewed.bytes, "runtime_size_mismatch");
    hash.update(chunk);
    if (sink) {
      let offset = 0;
      while (offset < chunk.byteLength) {
        const result = await sink.write(chunk, offset, chunk.byteLength - offset);
        need(result.bytesWritten > 0, "runtime_download_write_failed");
        offset += result.bytesWritten;
      }
    }
  }
  need(bytes === reviewed.bytes &&
    hash.digest("hex") === reviewed.sha256, "runtime_integrity_mismatch");
}

async function inspect(port) {
  const actual = await port.inspect();
  need(["accountId", "region", "project", "bucket", "prefix"].every((key) =>
    actual?.[key] === destination[key]) && actual.private === true &&
    actual.tlsRequired === true && actual.versioning === "Enabled" &&
    actual.encryption === "AES256" && actual.retentionMode === "GOVERNANCE" &&
    actual.retentionDays === 30 && actual.conditionalWritesRequired === true,
  "runtime_destination_unverified");
}

function checkedVersion(version, now, reviewed) {
  need(version?.key === reviewed.key &&
    version.size === reviewed.bytes &&
    version.sha256 === reviewed.sha256 &&
    typeof version.versionId === "string" && version.versionId.length > 0 &&
    version.versionId.length <= 1024 && version.versionId !== "null" &&
    version.encryption === "AES256" &&
    Number.isFinite(Date.parse(version.createdAt)) &&
    Number.isFinite(Date.parse(version.retainUntil)) &&
    Date.parse(version.createdAt) <= now + 60000 &&
    Date.parse(version.retainUntil) >= Date.parse(version.createdAt) + 30 * 86400000 - 1000,
  "runtime_object_unverified");
}

/** The caller must provide a private destination path that does not exist.
 * No application, database, Slack or provider source write occurs here. */
export async function copyReviewedLiveRuntimeSource({ sourcePath, downloadPath, writer, restore,
  now = Date.now, reviewed = reviewedLiveRuntimeSource }) {
  need(reviewed === reviewedLiveRuntimeSource || reviewed === reviewedLiveRuntimeSource1705 ||
    reviewed === reviewedLiveRuntimeSource1828 || reviewed === reviewedLiveRuntimeSource1911 ||
    reviewed === reviewedLiveRuntimeSource2046 || reviewed === reviewedLiveRuntimeSource2203 ||
    reviewed === reviewedLiveRuntimeSource2322 || reviewed === reviewedBuild01EdgeCredentialPackage,
    "runtime_reviewed_package_invalid");
  need(typeof sourcePath === "string" && typeof downloadPath === "string" &&
    sourcePath !== downloadPath && writer?.destination && restore?.destination,
  "runtime_copy_arguments_invalid");
  await privateParent(sourcePath);
  await privateParent(downloadPath);
  const source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let downloaded;
  try {
    const stat = await source.stat();
    need(stat.isFile() && stat.uid === process.getuid() &&
      (stat.mode & 0o077) === 0 && stat.size === reviewed.bytes,
    "runtime_source_invalid");
    const header = Buffer.alloc(22);
    await source.read(header, 0, header.length, 0);
    need(header.toString() === "age-encryption.org/v1\n", "runtime_age_header_invalid");
    await checkedStream(source.createReadStream({ start: 0, autoClose: false }), undefined, reviewed);
    await inspect(writer.destination);
    await inspect(restore.destination);
    const { key, sha256, bytes } = reviewed;
    let version = await writer.destination.find(key);
    if (version === null) version = await writer.destination.put({
      key, size: bytes, sha256,
      checksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
      ifNoneMatch: "*", encryption: "AES256",
      body: () => source.createReadStream({ start: 0, autoClose: false }),
    });
    checkedVersion(version, now(), reviewed);
    const writerReadback = await writer.destination.version(key, version.versionId);
    checkedVersion(writerReadback, now(), reviewed);
    need(canon(writerReadback) === canon(version), "runtime_version_changed");
    await checkedStream(await writer.destination.read(key, version.versionId), undefined, reviewed);
    const restoreReadback = await restore.destination.version(key, version.versionId);
    checkedVersion(restoreReadback, now(), reviewed);
    need(canon(restoreReadback) === canon(version), "runtime_restore_version_changed");
    downloaded = await open(downloadPath, "wx", 0o600);
    await checkedStream(await restore.destination.read(key, version.versionId), downloaded, reviewed);
    await downloaded.sync();
    return {
      state: reviewed.kind === "edge_credentials"
        ? "encrypted_build01_edge_credentials_offsite_copy_verified"
        : "encrypted_live_runtime_source_offsite_copy_verified",
      object: version, destination: { ...destination },
      bytes, sha256, independentRestoreDownloadVerified: true,
      applicationRecoveryVerified: false, productionWrites: false,
    };
  } catch (error) {
    if (downloaded) { await downloaded.close(); downloaded = undefined;
      await unlink(downloadPath).catch(() => {}); }
    throw error;
  } finally {
    await downloaded?.close();
    await source.close();
  }
}
