/** Same-host three-bucket supervisor. No schedule is created or changed. */
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { binding } from "./drummonds-recording-backup-access.mjs";
import { RecordingBackupError, recordingIdentity } from "./recording-backup-core.mjs";
import {
  runDailyBackup,
  readDailyHealth,
  privateDir,
  readPrivate,
  writePrivate,
} from "./run-drummonds-recording-daily.mjs";
import { withDailyLease } from "./communication-backup-lock.mjs";
import { createLiveCommunicationSession } from "./communication-backup-live.mjs";
export const communicationBuckets = Object.freeze([
  "phone-recordings",
  "learn-voicemail-sources",
  "receptionist-voicemails",
]);
const check = (v, c) => {
  if (!v) throw new RecordingBackupError(c);
};
export function communicationBudget({
  objects = 400,
  bytes = 256 * 1024 * 1024,
  requests = 100000,
} = {}) {
  check(
    Number.isSafeInteger(objects) &&
      objects > 0 &&
      objects <= 400 &&
      Number.isSafeInteger(bytes) &&
      bytes > 0 &&
      bytes <= 256 * 1024 * 1024 &&
      Number.isSafeInteger(requests) &&
      requests > 0 &&
      requests <= 100000,
    "communication_limits_invalid",
  );
  let used = { objects: 0, bytes: 0, requests: 0 };
  return {
    reserveNewData(n) {
      check(
        Number.isSafeInteger(n.objects) &&
          n.objects >= 0 &&
          Number.isSafeInteger(n.bytes) &&
          n.bytes >= 0,
        "communication_reservation_invalid",
      );
      check(
        used.objects + n.objects <= objects && used.bytes + n.bytes <= bytes,
        "communication_new_data_limit",
      );
      used.objects += n.objects;
      used.bytes += n.bytes;
    },
    sourceRequest() {
      check(used.requests < requests, "communication_request_limit");
      used.requests++;
    },
    usage: () => ({ ...used, limits: { objects, bytes, requests } }),
  };
}
export function reconcileVoicemailPairs(listed, tenant) {
  const maps = {};
  for (const bucket of communicationBuckets.slice(1)) {
    const x = listed[bucket],
      r = x?.reconciliation;
    check(
      r?.sourceBucket === bucket &&
        r.tenantId === tenant &&
        r.missingObjectReferences?.length === 0 &&
        r.rowsWithoutStoragePointer === 0 &&
        r.unreferencedObjects === 0 &&
        r.preparedReferences === 0,
      "communication_pair_reconciliation_pending",
    );
    const pairs = new Map();
    for (const candidate of x.inventory.objects) {
      const e = recordingIdentity(candidate),
        p = e.sourceKey.split("/"),
        audio = bucket === "receptionist-voicemails";
      check(
        e.tenantId === tenant &&
          e.sourceBucket === bucket &&
          e.sourceContentSha256 &&
          p.length === 3 &&
          p[0] === tenant &&
          e.recordingIds.length === 1,
        "communication_pair_binding_invalid",
      );
      const intake = audio ? p[2] : p[1];
      check(
        audio ? e.recordingIds[0] === intake : p[2] === e.recordingIds[0] + ".eml",
        "communication_pair_binding_invalid",
      );
      check(!pairs.has(intake), "communication_pair_binding_invalid");
      pairs.set(intake, e.objectId);
    }
    maps[bucket] = pairs;
  }
  const raw = maps["learn-voicemail-sources"],
    audio = maps["receptionist-voicemails"];
  check(
    raw.size > 0 && raw.size === audio.size && [...raw.keys()].every((id) => audio.has(id)),
    "communication_pair_reconciliation_pending",
  );
  return { matchedPairs: raw.size, scope: "observed_non_atomic_inventories" };
}
const directories = (root) => ({
  "phone-recordings": join(root, "recording-daily"),
  "learn-voicemail-sources": join(root, "voicemail-raw-daily"),
  "receptionist-voicemails": join(root, "voicemail-audio-daily"),
});
export async function runCommunicationBackup({
  root,
  context = binding,
  createSession = createLiveCommunicationSession,
  limits,
  signal = AbortSignal.timeout(3600000),
  now = Date.now,
  onProgress,
} = {}) {
  root = resolve(root);
  await privateDir(root);
  const dirs = directories(root),
    aggregate = join(root, "communication-daily");
  return withDailyLease(dirs["phone-recordings"], async (lease) => {
    await privateDir(aggregate);
    const startedAt = new Date(now()).toISOString(),
      budget = communicationBudget(limits),
      results = {},
      listed = {};
    let session;
    try {
      check(!signal.aborted, "communication_cancelled");
      await writePrivate(aggregate, "last-attempt.json", {
        state: "in_progress",
        startedAt,
        pid: process.pid,
        backupComplete: false,
      });
      session = await createSession(signal, budget);
      for (const bucket of communicationBuckets) {
        check(!signal.aborted, "communication_cancelled");
        results[bucket] = await runDailyBackup({
          directory: dirs[bucket],
          binding: context,
          signal,
          ...(bucket === "phone-recordings" ? { lockLease: lease } : {}),
          createPorts: () => session.ports(bucket),
          cycleOptions: { reserveNewData: budget.reserveNewData },
          onInventory: (value) => {
            listed[bucket] = value;
          },
          onProgress: (p) => onProgress?.({ sourceBucket: bucket, ...p }),
        });
        check(
          results[bucket].sourceReconciliation.missingObjectReferences === 0 &&
            results[bucket].sourceReconciliation.rowsWithoutStoragePointer === 0,
          "communication_source_files_missing",
        );
      }
      const pair = reconcileVoicemailPairs(listed, context.tenantId);
      const result = {
        state: "communication_inventory_verified",
        startedAt,
        verifiedAt: new Date(now()).toISOString(),
        inventoryObservedAt: new Date(
          Math.min(...Object.values(results).map((x) => Date.parse(x.inventoryObservedAt))),
        ).toISOString(),
        buckets: results,
        pair,
        budget: budget.usage(),
        backupComplete: false,
        sourceSnapshot: "non_atomic",
        databaseRestore: "separate_acceptance",
        listening: "not_verified",
      };
      check(!signal.aborted, "communication_cancelled");
      const previous = await readPrivate(join(aggregate, "last-success.json"));
      check(
        !previous ||
          (Date.parse(previous.inventoryObservedAt) <= Date.parse(result.inventoryObservedAt) &&
            Date.parse(previous.verifiedAt) <= Date.parse(result.verifiedAt)),
        "communication_clock_or_coverage_regressed",
      );
      await writePrivate(aggregate, "last-success.json", result);
      await writePrivate(aggregate, "last-attempt.json", {
        state: "succeeded",
        startedAt,
        finishedAt: result.verifiedAt,
        backupComplete: false,
      });
      return result;
    } catch (e) {
      const code = e instanceof RecordingBackupError ? e.code : "communication_run_unconfirmed";
      await writePrivate(aggregate, "last-attempt.json", {
        state: "failed",
        startedAt,
        finishedAt: new Date(now()).toISOString(),
        code,
        completedBuckets: Object.keys(results),
        budget: budget.usage(),
        backupComplete: false,
      });
      throw new RecordingBackupError(code);
    } finally {
      session?.close?.();
    }
  });
}
export async function readCommunicationHealth(root, now = Date.now()) {
  root = resolve(root);
  const dirs = directories(root),
    aggregate = join(root, "communication-daily");
  await privateDir(aggregate);
  const success = await readPrivate(join(aggregate, "last-success.json")),
    attempt = await readPrivate(join(aggregate, "last-attempt.json")),
    buckets = {};
  for (const b of communicationBuckets) buckets[b] = await readDailyHealth(dirs[b], now);
  let reason = "within_daily_window";
  if (
    success?.state !== "communication_inventory_verified" ||
    !Number.isSafeInteger(success.pair?.matchedPairs) ||
    success.pair.matchedPairs < 1
  )
    reason = "no_verified_aggregate";
  else if (
    !Number.isFinite(Date.parse(success.inventoryObservedAt)) ||
    !Number.isFinite(Date.parse(success.verifiedAt)) ||
    Date.parse(success.inventoryObservedAt) > Date.parse(success.verifiedAt) ||
    Date.parse(success.verifiedAt) > now
  )
    reason = "inventory_time_invalid";
  else if (
    attempt?.state === "failed" &&
    Date.parse(attempt.finishedAt) >= Date.parse(success.verifiedAt)
  )
    reason = "latest_run_failed";
  else if (
    attempt?.state === "in_progress" &&
    (!Number.isFinite(Date.parse(attempt.startedAt)) ||
      now - Date.parse(attempt.startedAt) > 5400000)
  )
    reason = "run_outcome_unconfirmed";
  else if (now - Date.parse(success.inventoryObservedAt) > 108000000) reason = "inventory_overdue";
  else if (
    communicationBuckets.some(
      (b) =>
        buckets[b].status !== "observed_inventory_verified" ||
        buckets[b].inventoryObservedAt !== success.buckets?.[b]?.inventoryObservedAt ||
        buckets[b].lastVerifiedAt !== success.buckets?.[b]?.verifiedAt,
    )
  )
    reason = "component_coverage_changed_or_unverified";
  return {
    status: reason === "within_daily_window" ? "observed_inventory_verified" : "attention",
    reason,
    buckets,
    lastVerifiedAt: success?.verifiedAt ?? null,
    inventoryObservedAt: success?.inventoryObservedAt ?? null,
    latestFailureCode: attempt?.state === "failed" ? attempt.code : null,
    requiresAwakeComputer: true,
    backupComplete: false,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    check(
      process.argv.length === 3 && ["--run-drummonds-daily", "--health"].includes(process.argv[2]),
      "communication_arguments_invalid",
    );
    const root = fileURLToPath(new URL("../../.verification-results/", import.meta.url));
    console.log(
      JSON.stringify(
        process.argv[2] === "--health"
          ? await readCommunicationHealth(root)
          : await runCommunicationBackup({ root }),
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(
      JSON.stringify({
        state: "communication_backup_unconfirmed",
        code: e instanceof RecordingBackupError ? e.code : "communication_run_unconfirmed",
        backupComplete: false,
      }),
    );
    process.exitCode = 1;
  }
}
