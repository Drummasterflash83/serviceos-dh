/** Repeatable whole-inventory run. Reuse existing receipts, but verify every byte
 * and every source before a fresh manifest can claim observed coverage. */
import {
  backupRecording,
  finalizeRecordingInventory,
  recordingContext,
  recordingIdentity,
  recordingReceiptIdentity,
  RecordingBackupError,
} from "./recording-backup-core.mjs";
const check = (v, code) => {
  if (!v) throw new RecordingBackupError(code);
};
export async function dailyRecordingCycle(
  input,
  binding,
  ports,
  {
    signal,
    onProgress,
    maxNewObjects = 400,
    maxNewBytes = 256 * 1024 * 1024,
    concurrency = 4,
    reserveNewData,
  } = {},
) {
  const context = recordingContext(binding),
    now = ports.now ?? Date.now;
  check(
    input?.contract === "recording-inventory/1" &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.runId ?? "") &&
      input.tenantId === context.tenantId &&
      input.sourceProjectRef === context.sourceProjectRef &&
      input.listingComplete === true &&
      input.sourceSnapshot === "non_atomic" &&
      Number.isFinite(Date.parse(input.observedAt)) &&
      Date.parse(input.observedAt) <= now() &&
      Array.isArray(input.objects) &&
      input.objects.length > 0 &&
      input.objects.length <= 10000,
    "daily_inventory_unverified",
  );
  check(
    Number.isInteger(concurrency) &&
      concurrency >= 1 &&
      concurrency <= 4 &&
      Number.isInteger(maxNewObjects) &&
      maxNewObjects > 0 &&
      maxNewObjects <= 400 &&
      Number.isSafeInteger(maxNewBytes) &&
      maxNewBytes > 0 &&
      maxNewBytes <= 256 * 1024 * 1024,
    "daily_limits_invalid",
  );
  const entries = input.objects.map(recordingIdentity);
  let verificationReadRetries = 0;
  const verificationPorts = {
    ...ports,
    signal,
    verificationReadAttempts: 3,
    onVerificationReadRetry: () => {
      verificationReadRetries++;
    },
  };
  check(
    entries.every(
      (e) => e.tenantId === context.tenantId && e.sourceKey.startsWith(context.tenantId + "/"),
    ) &&
      new Set(entries.map((e) => e.objectId)).size === entries.length &&
      new Set(entries.map((e) => e.sourceKey)).size === entries.length,
    "daily_inventory_unverified",
  );
  async function bounded(items, phase, task) {
    let next = 0,
      done = 0,
      failure;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (!failure) {
          try {
            check(!signal?.aborted, "daily_cancelled");
            const index = next++;
            if (index >= items.length) return;
            await task(items[index], index);
            done++;
            if (done % 100 === 0 || done === items.length)
              onProgress?.({ phase, completed: done, total: items.length });
          } catch (e) {
            failure ??= e;
          }
        }
      }),
    );
    if (failure) throw failure;
  }
  const missing = [];
  await bounded(entries, "receipt_discovery", async (e) => {
    if (!(await ports.journal.load(recordingReceiptIdentity(e, context)))) missing.push(e);
  });
  const newBytes = missing.reduce((n, e) => n + e.size, 0);
  check(missing.length <= maxNewObjects && newBytes <= maxNewBytes, "daily_new_data_limit");
  reserveNewData?.({ objects: missing.length, bytes: newBytes });
  let copied = 0,
    recovered = 0;
  await bounded(missing, "new_recordings", async (e) => {
    const r = await backupRecording(e, context, verificationPorts);
    if (r.recovered) recovered++;
    else copied++;
  });
  check(!signal?.aborted, "daily_cancelled");
  const final = await finalizeRecordingInventory(input, context, {
    ...verificationPorts,
    signal,
    onProgress,
    verificationConcurrency: concurrency,
  });
  return {
    state: "inventory_verified",
    runId: input.runId,
    inventoryObservedAt: final.manifest.inventoryObservedAt,
    verifiedAt: final.manifest.verifiedAt,
    inventorySha256: final.manifest.inventorySha256,
    objects: final.manifest.objects.length,
    totalBytes: final.manifest.totalBytes,
    recordingReferences: final.manifest.recordingReferences,
    newObjectsCopied: copied,
    newBytesConsidered: newBytes,
    recoveredObjects: recovered,
    existingReceipts: entries.length - missing.length,
    recoveredManifest: final.recovered,
    coverage: final.manifest.coverage,
    sourceSnapshot: "non_atomic",
    readRecovery: { verificationReadRetries, ...(ports.destination.recovery?.() ?? {}) },
    playback: "not_verified",
    databaseRestore: "not_verified",
    backupComplete: false,
  };
}
export function recordingBackupHealth({ lastSuccess, lastAttempt, now = Date.now() }) {
  const valid =
    lastSuccess?.state === "inventory_verified" &&
    lastSuccess.coverage === "verified_inventory_only" &&
    Number.isFinite(Date.parse(lastSuccess.inventoryObservedAt)) &&
    Number.isFinite(Date.parse(lastSuccess.verifiedAt)) &&
    Date.parse(lastSuccess.verifiedAt) <= now &&
    Date.parse(lastSuccess.inventoryObservedAt) <= Date.parse(lastSuccess.verifiedAt) &&
    Number.isSafeInteger(lastSuccess.objects) &&
    lastSuccess.objects > 0;
  if (!valid)
    return {
      status: "attention",
      reason: "no_verified_inventory",
      backupComplete: false,
    };
  if (
    lastAttempt?.state === "in_progress" &&
    (!Number.isFinite(Date.parse(lastAttempt.startedAt)) ||
      now - Date.parse(lastAttempt.startedAt) > 90 * 60000)
  )
    return {
      status: "attention",
      reason: "run_outcome_unconfirmed",
      lastVerifiedAt: lastSuccess.verifiedAt,
      backupComplete: false,
    };
  const age = now - Date.parse(lastSuccess.inventoryObservedAt);
  if (age < 0)
    return {
      status: "attention",
      reason: "inventory_time_invalid",
      backupComplete: false,
    };
  if (
    lastAttempt?.state === "failed" &&
    Date.parse(lastAttempt.finishedAt ?? lastAttempt.startedAt) >=
      Date.parse(lastSuccess.verifiedAt)
  )
    return {
      status: "attention",
      reason: "latest_run_failed",
      lastVerifiedAt: lastSuccess.verifiedAt,
      backupComplete: false,
    };
  if (age > 30 * 3600000)
    return {
      status: "attention",
      reason: "inventory_overdue",
      lastVerifiedAt: lastSuccess.verifiedAt,
      backupComplete: false,
    };
  if (lastSuccess.sourceReconciliation?.missingObjectReferences > 0)
    return {
      status: "attention",
      reason: "source_recording_files_missing",
      lastVerifiedAt: lastSuccess.verifiedAt,
      sourceReconciliation: lastSuccess.sourceReconciliation,
      backupComplete: false,
    };
  return {
    sourceReconciliation: lastSuccess.sourceReconciliation ?? null,
    status: "observed_inventory_verified",
    reason: lastAttempt?.state === "in_progress" ? "next_run_in_progress" : "within_daily_window",
    lastVerifiedAt: lastSuccess.verifiedAt,
    inventoryObservedAt: lastSuccess.inventoryObservedAt,
    objects: lastSuccess.objects,
    totalBytes: lastSuccess.totalBytes,
    backupComplete: false,
  };
}
