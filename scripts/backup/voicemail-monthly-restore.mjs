/** AWS-only paired-file rehearsal. Does not establish a current database restore. */
import { rm, lstat } from "node:fs/promises";
import {
  RecordingBackupError,
  recordingIdentity,
  restoreRecordingFromManifest,
} from "./recording-backup-core.mjs";
import { checkRecordingPlayback } from "./recording-playback-check.mjs";
export const voicemailBuckets = Object.freeze([
  "learn-voicemail-sources",
  "receptionist-voicemails",
]);
const check = (v, c) => {
  if (!v) throw new RecordingBackupError(c);
};
const uuid = (v) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v ?? "");
const sha = (v) => /^[a-f0-9]{64}$/.test(v ?? "");
export function nextMonthlyCheck(checkedAt) {
  const d = new Date(checkedAt);
  check(Number.isFinite(d.getTime()), "monthly_time_invalid");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}
export function monthlyRestoreHealth(success, attempt, now = Date.now()) {
  const checked = Date.parse(success?.checkedAt),
    at = Date.parse(attempt?.finishedAt ?? attempt?.startedAt);
  let reason = "within_monthly_window";
  if (
    success?.state !== "paired_files_restored_and_verified" ||
    success?.files !== 2 ||
    success?.privateContentRemoved !== true ||
    success?.playback?.state !== "decoded" ||
    success?.sourceAccessDuringRestore !== false ||
    !Array.isArray(success?.proofs) ||
    success.proofs.length !== 2 ||
    !voicemailBuckets.every((bucket, i) => {
      const p = success.proofs[i];
      return (
        p?.sourceBucket === bucket &&
        uuid(p.objectId) &&
        uuid(p.manifestRunId) &&
        sha(p.sha256) &&
        sha(p.inventorySha256) &&
        Number.isSafeInteger(p.bytes) &&
        p.bytes > 0 &&
        p.bytes <= (i === 0 ? 1048576 : 8388608)
      );
    })
  )
    reason = "no_verified_pair";
  else if (!Number.isFinite(checked) || checked > now) reason = "restore_time_invalid";
  else if (attempt && (!Number.isFinite(at) || at > now)) reason = "attempt_time_invalid";
  else if (attempt?.state === "failed" && at >= checked) reason = "latest_restore_failed";
  else if (attempt?.state === "in_progress" && now - at > 10 * 60 * 1000)
    reason = "restore_outcome_unconfirmed";
  else if (now >= Date.parse(nextMonthlyCheck(success.checkedAt))) reason = "monthly_restore_due";
  return {
    status: reason === "within_monthly_window" ? "sample_restore_verified" : "attention",
    reason,
    checkedAt: Number.isFinite(checked) ? success.checkedAt : null,
    nextDueAt: Number.isFinite(checked) ? nextMonthlyCheck(success.checkedAt) : null,
    requiresAwakeComputer: true,
    databaseRestore: "separate_acceptance",
    listening: "not_verified",
    backupComplete: false,
  };
}
/** A fresh successful aggregate identifies both immutable remote manifests. */
export function selectMonthlyPair(
  aggregate,
  manifests,
  context,
  now = Date.now(),
  previousIntake = null,
) {
  const verified = Date.parse(aggregate?.verifiedAt),
    observed = Date.parse(aggregate?.inventoryObservedAt);
  check(
    aggregate?.state === "communication_inventory_verified" &&
      Number.isFinite(verified) &&
      Number.isFinite(observed) &&
      observed <= verified &&
      verified <= now &&
      now - observed <= 30 * 3600000,
    "monthly_backup_baseline_unverified",
  );
  const maps = {};
  for (const bucket of voicemailBuckets) {
    const expected = aggregate.buckets?.[bucket],
      manifest = manifests[bucket];
    check(
      uuid(expected?.runId) &&
        sha(expected?.inventorySha256) &&
        manifest?.runId === expected.runId &&
        manifest.inventorySha256 === expected.inventorySha256 &&
        manifest.verifiedAt === expected.verifiedAt &&
        manifest.inventoryObservedAt === expected.inventoryObservedAt &&
        manifest.destination?.tenantId === context.tenantId &&
        Array.isArray(manifest.objects) &&
        manifest.objects.length > 0 &&
        manifest.objects.length <= 10000,
      "monthly_manifest_binding_invalid",
    );
    const map = new Map();
    for (const receipt of manifest.objects) {
      const e = recordingIdentity(receipt.source),
        parts = e.sourceKey.split("/"),
        audio = bucket === voicemailBuckets[1];
      const intake = audio ? parts[2] : parts[1];
      check(
        e.tenantId === context.tenantId &&
          e.sourceBucket === bucket &&
          sha(e.sourceContentSha256) &&
          parts.length === 3 &&
          parts[0] === context.tenantId &&
          uuid(intake) &&
          e.recordingIds.length === 1 &&
          (audio ? e.recordingIds[0] === intake : parts[2] === e.recordingIds[0] + ".eml") &&
          !map.has(intake),
        "monthly_pair_binding_invalid",
      );
      map.set(intake, e);
    }
    maps[bucket] = map;
  }
  const raw = maps[voicemailBuckets[0]],
    audio = maps[voicemailBuckets[1]];
  check(
    raw.size === audio.size &&
      raw.size === aggregate.pair?.matchedPairs &&
      [...raw.keys()].every((k) => audio.has(k)),
    "monthly_pair_coverage_invalid",
  );
  let eligible = [...audio.keys()].filter(
    (k) =>
      raw.get(k).size > 0 &&
      raw.get(k).size <= 1048576 &&
      audio.get(k).size > 0 &&
      audio.get(k).size <= 8388608,
  );
  check(eligible.length > 0, "monthly_no_bounded_pair");
  if (eligible.length > 1) eligible = eligible.filter((k) => k !== previousIntake);
  eligible.sort((a, b) => audio.get(a).size - audio.get(b).size || a.localeCompare(b));
  const intake = eligible[Math.floor(eligible.length / 2)];
  return { intake, entries: voicemailBuckets.map((b) => maps[b].get(intake)) };
}
export async function removeRestoredDirectory(directory) {
  await rm(directory, { recursive: true, force: true });
  let absent = false;
  try {
    await lstat(directory);
  } catch (e) {
    if (e.code === "ENOENT") absent = true;
    else throw e;
  }
  check(absent, "monthly_cleanup_unconfirmed");
}
/** Caller owns the private lock/state. Only the injected Restore factory is invoked. */
export async function checkMonthlyPair({
  aggregate,
  context,
  createRestorePorts,
  state,
  now = Date.now,
  signal = AbortSignal.timeout(300000),
  decode = checkRecordingPlayback,
  cleanup = removeRestoredDirectory,
}) {
  const startedAt = new Date(now()).toISOString(),
    directories = [],
    proofs = [],
    cleanupPending = [];
  let ports, result, error;
  await state.writeAttempt({ state: "in_progress", startedAt, pid: process.pid });
  try {
    check(!signal.aborted, "monthly_cancelled");
    const previous = await state.readSuccess();
    ports = await createRestorePorts(signal);
    check(!ports.source, "monthly_source_port_forbidden");
    const manifests = {};
    for (const bucket of voicemailBuckets) {
      const runId = aggregate?.buckets?.[bucket]?.runId;
      check(uuid(runId), "monthly_manifest_binding_invalid");
      manifests[bucket] = await ports.journal.loadManifest(runId);
    }
    const selected = selectMonthlyPair(aggregate, manifests, context, now(), previous?.intake);
    for (const entry of selected.entries) {
      check(!signal.aborted, "monthly_cancelled");
      const manifest = manifests[entry.sourceBucket];
      const restored = await restoreRecordingFromManifest(
        manifest,
        manifest.runId,
        entry.objectId,
        context,
        ports,
      );
      directories.push(restored.directory);
      // Private recovery metadata survives interruption; no source bytes are journalled.
      await state.writeAttempt({
        state: "in_progress",
        startedAt,
        pid: process.pid,
        cleanupPending: [...directories],
      });
      check(
        restored.bytes === entry.size && restored.sha256 === entry.sourceContentSha256,
        "monthly_restored_binding_invalid",
      );
      let playback = null;
      if (entry.sourceBucket === voicemailBuckets[1]) {
        playback = await decode(restored);
        check(
          playback?.state === "decoded" &&
            Number.isFinite(playback.durationSeconds) &&
            playback.durationSeconds > 0,
          "monthly_audio_decode_unconfirmed",
        );
      }
      proofs.push({
        sourceBucket: entry.sourceBucket,
        objectId: entry.objectId,
        sha256: restored.sha256,
        bytes: restored.bytes,
        manifestRunId: manifest.runId,
        inventorySha256: manifest.inventorySha256,
        playback,
      });
    }
    check(!signal.aborted, "monthly_cancelled");
    check(!previous || Date.parse(previous.checkedAt) <= now(), "monthly_clock_regressed");
    result = {
      state: "paired_files_restored_and_verified",
      checkedAt: new Date(now()).toISOString(),
      files: 2,
      bytes: proofs.reduce((n, p) => n + p.bytes, 0),
      intake: selected.intake,
      proofs,
      playback: proofs[1].playback,
      privateContentRemoved: true,
      sourceAccessDuringRestore: false,
      databaseRestore: "separate_acceptance",
      listening: "not_verified",
      backupComplete: false,
    };
  } catch (e) {
    error = e;
  } finally {
    for (const directory of directories) {
      try {
        await cleanup(directory);
      } catch {
        cleanupPending.push(directory);
        error = new RecordingBackupError("monthly_cleanup_unconfirmed");
      }
    }
    try {
      ports?.close?.();
    } catch {
      error ??= new RecordingBackupError("monthly_close_unconfirmed");
    }
  }
  if (signal.aborted) error ??= new RecordingBackupError("monthly_cancelled");
  if (error) {
    const code = error instanceof RecordingBackupError ? error.code : "monthly_restore_unconfirmed";
    await state.writeAttempt({
      state: "failed",
      startedAt,
      finishedAt: new Date(now()).toISOString(),
      code,
      cleanupPending,
    });
    throw new RecordingBackupError(code);
  }
  // Cleanup completed before either durable success receipt is advanced.
  await state.writeSuccess(result);
  await state.writeAttempt({ state: "succeeded", startedAt, finishedAt: result.checkedAt });
  return monthlyRestoreHealth(result, null, now());
}
