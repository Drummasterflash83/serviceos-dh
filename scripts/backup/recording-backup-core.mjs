/** Private recording-copy protocol. Ports must be bound to the reviewed source
 * and destination; no credentials, network clients or activation live here. */
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const uuid = (v) =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const digest = (v) => createHash("sha256").update(v).digest("hex");
const canonicalJson = (v) =>
  JSON.stringify(v, function (_key, value) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, value[k]]),
        )
      : value;
  });
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const MAX_BYTES = 256 * 1024 * 1024;
const DAYS_30 = 30 * 86400000;
export class RecordingBackupError extends Error {
  constructor(code) {
    super(`Recording backup: ${code}`);
    this.code = code;
  }
}
function requireValue(ok, code) {
  if (!ok) throw new RecordingBackupError(code);
}
export function recordingIdentity(value) {
  requireValue(
    value &&
      uuid(value.tenantId) &&
      uuid(value.objectId) &&
      typeof value.sourceKey === "string" &&
      value.sourceKey.length > 0 &&
      value.sourceKey.length <= 4096 &&
      typeof value.sourceVersion === "string" &&
      value.sourceVersion.length > 0 &&
      value.sourceVersion.length <= 512 &&
      Number.isSafeInteger(value.size) &&
      value.size >= 0 &&
      value.size <= MAX_BYTES &&
      Array.isArray(value.recordingIds) &&
      value.recordingIds.length <= 10000 &&
      value.recordingIds.every(uuid) &&
      new Set(value.recordingIds).size === value.recordingIds.length,
    "invalid_source_identity",
  );
  return {
    tenantId: value.tenantId,
    objectId: value.objectId,
    sourceKey: value.sourceKey,
    sourceVersion: value.sourceVersion,
    size: value.size,
    recordingIds: [...value.recordingIds].sort(),
  };
}
export function recordingContext(value) {
  requireValue(
    value &&
      uuid(value.tenantId) &&
      /^[a-z]{20}$/.test(value.sourceProjectRef ?? "") &&
      /^\d{12}$/.test(value.accountId ?? "") &&
      value.region === "eu-west-2" &&
      /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value.bucket ?? "") &&
      value.prefix === `tenants/${value.tenantId}/`,
    "invalid_backup_context",
  );
  return {
    tenantId: value.tenantId,
    sourceProjectRef: value.sourceProjectRef,
    accountId: value.accountId,
    region: value.region,
    bucket: value.bucket,
    prefix: value.prefix,
  };
}
const sourceDigest = (entry, context) =>
  digest(JSON.stringify({ sourceProjectRef: context.sourceProjectRef, ...entry }));
/** Stable receipt lookup only; receipt presence never proves stored byte integrity. */
export function recordingReceiptIdentity(input, binding) {
  const entry = recordingIdentity(input), context = recordingContext(binding);
  requireValue(entry.tenantId === context.tenantId && entry.sourceKey.startsWith(context.tenantId + '/'), 'foreign_tenant');
  return sourceDigest(entry, context);
}
async function inspectDestination(context, port) {
  const state = await port.inspect();
  requireValue(
    state &&
      ["accountId", "region", "bucket", "prefix"].every((k) => state[k] === context[k]) &&
      state.private === true &&
      state.tlsRequired === true &&
      state.versioning === "Enabled" &&
      state.encryption === "AES256" &&
      state.retentionMode === "GOVERNANCE" &&
      state.retentionDays === 30 &&
      state.conditionalWritesRequired === true,
    "destination_unverified",
  );
}
async function unchanged(entry, source) {
  const current = recordingIdentity(await source.metadata(structuredClone(entry)));
  requireValue(JSON.stringify(current) === JSON.stringify(entry), "source_changed");
}
function checkVersion(v, key, sha256, size, now) {
  requireValue(
    v &&
      v.key === key &&
      typeof v.versionId === "string" &&
      v.versionId !== "null" &&
      v.versionId.length > 0 &&
      v.versionId.length <= 1024 &&
      v.size === size &&
      v.sha256 === sha256 &&
      v.encryption === "AES256" &&
      v.retentionMode === "GOVERNANCE" &&
      Number.isFinite(Date.parse(v.createdAt)) &&
      Date.parse(v.createdAt) <= now + 60000 &&
      Number.isFinite(Date.parse(v.retainUntil)) &&
      Date.parse(v.retainUntil) >= Date.parse(v.createdAt) + DAYS_30 - 1000,
    "destination_version_unverified",
  );
}
async function hashStream(stream, expectedSize, output) {
  const sha = createHash("sha256");
  let bytes = 0;
  for await (const chunk of stream) {
    requireValue(chunk instanceof Uint8Array, "invalid_byte_stream");
    bytes += chunk.byteLength;
    requireValue(bytes <= expectedSize && bytes <= MAX_BYTES, "byte_length_mismatch");
    sha.update(chunk);
    if (output) {
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await output.write(chunk, offset, chunk.length - offset);
        requireValue(bytesWritten > 0, "spool_write_failed");
        offset += bytesWritten;
      }
    }
  }
  requireValue(bytes === expectedSize, "byte_length_mismatch");
  return sha.digest("hex");
}
function privateReceipt(receipt, entry, context) {
  const identity = sourceDigest(entry, context);
  requireValue(
    receipt &&
      receipt.contract === "recording-backup-receipt/1" &&
      receipt.identity === identity &&
      JSON.stringify(recordingIdentity(receipt.source)) === JSON.stringify(entry) &&
      JSON.stringify(recordingContext(receipt.destination)) === JSON.stringify(context) &&
      hash(receipt.sha256) &&
      receipt.key === `${context.prefix}objects/${identity}/${receipt.sha256}` &&
      typeof receipt.versionId === "string" &&
      receipt.versionId.length > 0 &&
      receipt.versionId !== "null" &&
      Number.isFinite(Date.parse(receipt.verifiedAt)),
    "receipt_unverified",
  );
  return receipt;
}
async function verifyVersion(receipt, entry, context, destination, now) {
  privateReceipt(receipt, entry, context);
  const version = await destination.version(receipt.key, receipt.versionId);
  checkVersion(version, receipt.key, receipt.sha256, entry.size, now());
  requireValue(version.versionId === receipt.versionId, "destination_version_unverified");
  const actual = await hashStream(
    await destination.read(receipt.key, receipt.versionId),
    entry.size,
  );
  requireValue(actual === receipt.sha256, "destination_digest_mismatch");
}
/** One object per call. The journal is durable, private and create-only; a lost
 * upload or receipt acknowledgement is recovered on a later invocation, not
 * blindly retried. Caller must never count an exception as copied coverage. */
export async function backupRecording(
  input,
  binding,
  { source, destination, journal, now = Date.now },
) {
  let directory;
  try {
    const entry = recordingIdentity(input),
      context = recordingContext(binding);
    requireValue(entry.tenantId === context.tenantId, "foreign_tenant");
    await inspectDestination(context, destination);
    await unchanged(entry, source);
    const identity = sourceDigest(entry, context);
    const existing = await journal.load(identity);
    if (existing) {
      await verifyVersion(existing, entry, context, destination, now);
      await unchanged(entry, source);
      return {
        state: "verified",
        recovered: true,
        bytes: entry.size,
        receipt: structuredClone(existing),
      };
    }
    directory = await mkdtemp(join(tmpdir(), "serviceos-recording-backup-"));
    const path = join(directory, "recording");
    const file = await open(path, "wx", 0o600);
    let sha256;
    try {
      sha256 = await hashStream(await source.read(structuredClone(entry)), entry.size, file);
      await file.sync();
    } finally {
      await file.close();
    }
    await unchanged(entry, source);
    const key = `${context.prefix}objects/${identity}/${sha256}`;
    let version = await destination.find(key);
    if (!version) {
      const uploadStartedAt = now();
      // A returned version is mandatory. On an uncertain write stop; the next
      // attempt discovers and verifies the deterministic key before writing.
      version = await destination.put({
        key,
        size: entry.size,
        sha256,
        body: () => createReadStream(path),
        ifNoneMatch: "*",
        encryption: "AES256",
        checksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
      });
      requireValue(
        Date.parse(version?.createdAt) >= uploadStartedAt - 60000 &&
          Date.parse(version?.retainUntil) >= uploadStartedAt + DAYS_30 - 60000,
        "destination_version_unverified",
      );
    }
    checkVersion(version, key, sha256, entry.size, now());
    const receipt = {
      contract: "recording-backup-receipt/1",
      identity,
      source: entry,
      destination: context,
      key,
      versionId: version.versionId,
      sha256,
      verifiedAt: new Date(now()).toISOString(),
    };
    await verifyVersion(receipt, entry, context, destination, now);
    await unchanged(entry, source);
    const persisted = await journal.saveIfAbsent(identity, structuredClone(receipt));
    privateReceipt(persisted, entry, context);
    requireValue(
      persisted.key === receipt.key &&
        persisted.versionId === receipt.versionId &&
        persisted.sha256 === receipt.sha256,
      "receipt_conflict",
    );
    return {
      state: "verified",
      recovered: false,
      bytes: entry.size,
      receipt: structuredClone(persisted),
    };
  } catch (error) {
    if (error instanceof RecordingBackupError) throw error;
    // Provider errors can contain signed URLs, paths, account data or secrets.
    throw new RecordingBackupError("copy_unconfirmed");
  } finally {
    if (directory)
      try {
        await rm(directory, { recursive: true, force: true });
      } catch {
        throw new RecordingBackupError("temporary_cleanup_failed");
      }
  }
}
/** Restores one recorded version into an isolated new private directory. No
 * caller-supplied destination path, production write or source provider access.
 * The owner must remove the returned directory after playback/inspection. */
export async function restoreRecording(receipt, binding, { destination, now = Date.now }) {
  let directory;
  try {
    const context = recordingContext(binding),
      entry = recordingIdentity(receipt?.source);
    requireValue(entry.tenantId === context.tenantId, "foreign_tenant");
    privateReceipt(receipt, entry, context);
    await inspectDestination(context, destination);
    const version = await destination.version(receipt.key, receipt.versionId);
    checkVersion(version, receipt.key, receipt.sha256, entry.size, now());
    requireValue(version.versionId === receipt.versionId, "destination_version_unverified");
    directory = await mkdtemp(join(tmpdir(), "serviceos-recording-restore-"));
    const path = join(directory, randomUUID() + ".audio");
    const file = await open(path, "wx", 0o600);
    let actual;
    try {
      actual = await hashStream(
        await destination.read(receipt.key, receipt.versionId),
        entry.size,
        file,
      );
      await file.sync();
    } finally {
      await file.close();
    }
    requireValue(actual === receipt.sha256, "destination_digest_mismatch");
    const restored = {
      state: "restored_and_verified",
      path,
      directory,
      bytes: entry.size,
      sha256: actual,
      recordingIds: [...entry.recordingIds],
      playback: "not_verified",
    };
    directory = null;
    return restored;
  } catch (error) {
    if (error instanceof RecordingBackupError) throw error;
    throw new RecordingBackupError("restore_unconfirmed");
  } finally {
    if (directory)
      try {
        await rm(directory, { recursive: true, force: true });
      } catch {
        throw new RecordingBackupError("temporary_cleanup_failed");
      }
  }
}

/** A completed manifest proves only this explicit inventory, not a simultaneous
 * database/storage snapshot or playable audio. Inventories must come from the
 * authorised, complete source listing; the transport adapter owns that boundary. */
export async function finalizeRecordingInventory(
  input,
  binding,
  { source, destination, journal, now = Date.now, verificationConcurrency = 1, signal, onProgress },
) {
  try {
    requireValue(Number.isInteger(verificationConcurrency) && verificationConcurrency >= 1 && verificationConcurrency <= 4, 'verification_concurrency_invalid');
    // Bound network/stream use and drain active workers on any failure. Never
    // publish a partial manifest or let checks continue beyond the runner lock.
    const verifyAll = async (entries, phase, verify) => {
      let next=0,completed=0,failure;
      const workers=Array.from({length:Math.min(verificationConcurrency,entries.length)},async()=>{
        while(!failure){
          try{
            if(signal?.aborted)throw new RecordingBackupError('runner_cancelled');
            const index=next++;
            if(index>=entries.length)return;
            await verify(entries[index],index);
            completed++;
            if(completed%100===0||completed===entries.length)onProgress?.({phase,verifiedObjects:completed,totalObjects:entries.length});
          }catch(e){failure??=e;}
        }
      });
      await Promise.all(workers);
      if(failure)throw failure;
    };
    const context = recordingContext(binding);
    requireValue(
      input &&
        input.contract === "recording-inventory/1" &&
        uuid(input.runId) &&
        input.tenantId === context.tenantId &&
        input.sourceProjectRef === context.sourceProjectRef &&
        Number.isFinite(Date.parse(input.observedAt)) &&
        Date.parse(input.observedAt) <= now() &&
        input.listingComplete === true &&
        input.sourceSnapshot === "non_atomic" &&
        Array.isArray(input.objects) &&
        input.objects.length > 0 &&
        input.objects.length <= 10000,
      "inventory_unverified",
    );
    const entries = input.objects
      .map(recordingIdentity)
      .sort((a, b) => a.objectId.localeCompare(b.objectId));
    requireValue(
      entries.every((e) => e.tenantId === context.tenantId) &&
        new Set(entries.map((e) => e.objectId)).size === entries.length &&
        new Set(entries.map((e) => e.sourceKey)).size === entries.length,
      "inventory_unverified",
    );
    const inventory = {
      contract: input.contract,
      runId: input.runId,
      tenantId: context.tenantId,
      sourceProjectRef: context.sourceProjectRef,
      observedAt: input.observedAt,
      listingComplete: true,
      sourceSnapshot: "non_atomic",
      objects: entries,
    };
    const inventorySha256 = digest(JSON.stringify(inventory));
    await inspectDestination(context, destination);
    const prior = await journal.loadManifest(input.runId);
    if (prior)
      requireValue(
        prior.contract === "recording-backup-manifest/1" &&
          prior.runId === input.runId &&
          prior.inventorySha256 === inventorySha256 &&
          canonicalJson(prior.destination) === canonicalJson(context) &&
          prior.coverage === "verified_inventory_only" &&
          Array.isArray(prior.objects) &&
          prior.objects.length === entries.length &&
          Number.isFinite(Date.parse(prior.verifiedAt)),
        "manifest_conflict",
      );
    const receipts = new Array(entries.length);
    await verifyAll(entries,'destination_bytes',async(entry,i)=>{
      if (!prior) await unchanged(entry, source);
      const receipt = prior ? prior.objects[i] : await journal.load(sourceDigest(entry, context));
      await verifyVersion(receipt, entry, context, destination, now);
      receipts[i]=structuredClone(receipt);
    });
    // Receipt recovery retains its original time/coverage even if source objects
    // have since changed or disappeared; it never claims those current sources.
    if (!prior) await verifyAll(entries,'source_recheck',entry=>unchanged(entry,source));
    if(signal?.aborted)throw new RecordingBackupError('runner_cancelled');
    const manifest = {
      contract: "recording-backup-manifest/1",
      runId: input.runId,
      inventorySha256,
      destination: context,
      inventoryObservedAt: input.observedAt,
      verifiedAt: prior ? prior.verifiedAt : new Date(now()).toISOString(),
      coverage: "verified_inventory_only",
      sourceSnapshot: "non_atomic",
      objects: receipts,
      totalBytes: entries.reduce((total, e) => total + e.size, 0),
      recordingReferences: entries.reduce((total, e) => total + e.recordingIds.length, 0),
      playback: "not_verified",
      databaseRestore: "not_verified",
    };
    if (prior) {
      requireValue(
        canonicalJson(prior) === canonicalJson(manifest) &&
          Date.parse(prior.verifiedAt) <= now() + 60000,
        "manifest_conflict",
      );
      return { state: "inventory_verified", recovered: true, manifest: structuredClone(prior) };
    }
    const saved = await journal.saveManifestIfAbsent(input.runId, structuredClone(manifest));
    // Exact immutable manifest recovery permits a competing writer's original
    // timestamp, but never a changed inventory, reference or version.
    requireValue(
      saved &&
        canonicalJson({ ...saved, verifiedAt: null }) ===
          canonicalJson({ ...manifest, verifiedAt: null }) &&
        Number.isFinite(Date.parse(saved.verifiedAt)) &&
        Date.parse(saved.verifiedAt) <= now() + 60000,
      "manifest_conflict",
    );
    return { state: "inventory_verified", recovered: false, manifest: structuredClone(saved) };
  } catch (error) {
    if (error instanceof RecordingBackupError) throw error;
    throw new RecordingBackupError("manifest_unconfirmed");
  }
}

/** Source-independent restore selected from a verified immutable manifest.
 * Validates every receipt's identity and the inventory digest before selection. */
export async function restoreRecordingFromManifest(manifest, runId, objectId, binding, ports) {
  const context = recordingContext(binding),
    now = (ports.now ?? Date.now)();
  requireValue(
    uuid(runId) &&
      uuid(objectId) &&
      manifest?.contract === "recording-backup-manifest/1" &&
      manifest.runId === runId &&
      manifest.coverage === "verified_inventory_only" &&
      manifest.sourceSnapshot === "non_atomic" &&
      canonicalJson(recordingContext(manifest.destination)) === canonicalJson(context) &&
      Number.isFinite(Date.parse(manifest.inventoryObservedAt)) &&
      Number.isFinite(Date.parse(manifest.verifiedAt)) &&
      Date.parse(manifest.inventoryObservedAt) <= Date.parse(manifest.verifiedAt) &&
      Date.parse(manifest.verifiedAt) <= now + 60000 &&
      Array.isArray(manifest.objects) &&
      manifest.objects.length > 0 &&
      manifest.objects.length <= 10000,
    "restore_manifest_unverified",
  );
  const entries = manifest.objects
    .map((r) => {
      const entry = recordingIdentity(r?.source);
      requireValue(
        entry.tenantId === context.tenantId && entry.sourceKey.startsWith(`${context.tenantId}/`),
        "restore_manifest_unverified",
      );
      privateReceipt(r, entry, context);
      return entry;
    })
    .sort((a, b) => a.objectId.localeCompare(b.objectId));
  requireValue(
    new Set(entries.map((e) => e.objectId)).size === entries.length &&
      new Set(entries.map((e) => e.sourceKey)).size === entries.length &&
      manifest.totalBytes === entries.reduce((n, e) => n + e.size, 0) &&
      manifest.recordingReferences === entries.reduce((n, e) => n + e.recordingIds.length, 0),
    "restore_manifest_unverified",
  );
  const inventory = {
    contract: "recording-inventory/1",
    runId,
    tenantId: context.tenantId,
    sourceProjectRef: context.sourceProjectRef,
    observedAt: manifest.inventoryObservedAt,
    listingComplete: true,
    sourceSnapshot: "non_atomic",
    objects: entries,
  };
  requireValue(
    digest(JSON.stringify(inventory)) === manifest.inventorySha256,
    "restore_manifest_unverified",
  );
  const receipt = manifest.objects.find((r) => r.source.objectId === objectId);
  requireValue(receipt, "restore_object_not_in_manifest");
  const restored = await restoreRecording(receipt, context, ports);
  return {
    ...restored,
    manifestRunId: runId,
    inventorySha256: manifest.inventorySha256,
    inventoryObservedAt: manifest.inventoryObservedAt,
    backupVerifiedAt: manifest.verifiedAt,
    source: structuredClone(receipt.source),
    databaseRestore: "not_verified",
  };
}
