/** Guarded orchestration only. All source/destination ports must be explicitly
 * bound by the reviewed local entry point. No credentials or activation here. */
import { readFile, lstat, realpath, mkdir, open, rm, rename, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import { withProductionCommunicationLease } from "./communication-backup-lock.mjs";
import { runRecordingBackup } from "./recording-backup-runner.mjs";
import {
  recordingContext,
  recordingIdentity,
  restoreRecordingFromManifest,
  RecordingBackupError,
} from "./recording-backup-core.mjs";
import { checkRecordingPlayback } from "./recording-playback-check.mjs";
const sha = (b) => createHash("sha256").update(b).digest("hex"),
  fail = (c) => {
    throw new RecordingBackupError(c);
  },
  check = (x, c) => {
    if (!x) fail(c);
  };
async function privateFile(path) {
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await f.stat();
    check(
      s.isFile() &&
        s.nlink === 1 &&
        s.uid === process.getuid() &&
        (s.mode & 0o777) === 0o600 &&
        s.size <= 32 * 1024 * 1024,
      "voicemail_private_file_unverified",
    );
    return await f.readFile();
  } finally {
    await f.close();
  }
}
async function directory(path) {
  path = resolve(path);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const s = await lstat(path);
  check(
    s.isDirectory() &&
      !s.isSymbolicLink() &&
      s.uid === process.getuid() &&
      (s.mode & 0o777) === 0o700 &&
      (await realpath(path)) === path,
    "voicemail_private_directory_unverified",
  );
  return path;
}
async function save(dir, name, value) {
  const tmp = join(dir, ".pending-" + randomUUID()),
    f = await open(tmp, "wx", 0o600);
  try {
    await f.writeFile(JSON.stringify(value, null, 2) + "\n");
    await f.sync();
  } finally {
    await f.close();
  }
  await rename(tmp, join(dir, name));
  const parent = await open(dir, "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}
export async function loadVoicemailBackupScope({ root, planPath, planSha256, binding }) {
  root = resolve(root);
  const bytes = await privateFile(resolve(root, planPath));
  check(sha(bytes) === planSha256, "voicemail_plan_changed");
  const plan = JSON.parse(bytes),
    context = recordingContext(binding);
  check(
    plan.state === "prepared_not_copied" &&
      plan.project === context.sourceProjectRef &&
      plan.tenant === context.tenantId &&
      ["accountId", "region", "bucket", "prefix"].every(
        (k) => plan.destination[k] === context[k],
      ) &&
      plan.inventories?.length === 2 &&
      plan.noNewAccess &&
      plan.noSourceWrites &&
      plan.noDeleteOrOverwrite &&
      plan.noScheduleChanges,
    "voicemail_plan_scope_invalid",
  );
  check(
    plan.copyBounds?.perInvocationObjects === 100 &&
      plan.copyBounds.perInvocationSourceBytes === 268435456 &&
      plan.copyBounds.timeoutMinutes === 30,
    "voicemail_copy_bounds_invalid",
  );
  for (const [path, hash] of Object.entries(plan.sourceHashes)) {
    check(
      path.startsWith("scripts/backup/") &&
        !path.includes("..") &&
        sha(await readFile(resolve(root, path))) === hash,
      "voicemail_source_code_changed",
    );
  }
  const scopes = [];
  for (const spec of plan.inventories) {
    check(
      ["receptionist-voicemails", "learn-voicemail-sources"].includes(spec.sourceBucket) &&
        !scopes.some((s) => s.spec.sourceBucket === spec.sourceBucket),
      "voicemail_bucket_scope_invalid",
    );
    for (const field of ["inventoryPath", "reconciliationPath"])
      check(
        spec[field].startsWith(".verification-results/") && !spec[field].includes(".."),
        "voicemail_inventory_path_invalid",
      );
    const path = resolve(root, spec.inventoryPath);
    check((await realpath(dirname(path))) === dirname(path), "voicemail_inventory_path_invalid");
    const raw = await privateFile(path),
      reconciliation = await privateFile(resolve(root, spec.reconciliationPath));
    check(
      sha(raw) === spec.inventoryFileSha256 && sha(reconciliation) === spec.reconciliationSha256,
      "voicemail_inventory_changed",
    );
    const inventory = JSON.parse(raw),
      r = JSON.parse(reconciliation),
      entries = inventory.objects.map(recordingIdentity);
    check(
      inventory.runId === spec.runId &&
        inventory.tenantId === context.tenantId &&
        inventory.sourceProjectRef === context.sourceProjectRef &&
        inventory.listingComplete === true &&
        entries.length === spec.objects &&
        entries.every(
          (e) =>
            e.tenantId === context.tenantId &&
            e.sourceBucket === spec.sourceBucket &&
            e.sourceContentSha256 &&
            e.recordingIds.length === 1,
        ) &&
        new Set(entries.map((e) => e.objectId)).size === entries.length &&
        new Set(entries.map((e) => e.sourceKey)).size === entries.length &&
        entries.reduce((n, e) => n + e.size, 0) === spec.bytes,
      "voicemail_inventory_binding_invalid",
    );
    check(
      r.sourceBucket === spec.sourceBucket &&
        r.tenantId === context.tenantId &&
        r.sourceProjectRef === context.sourceProjectRef &&
        r.objects === spec.objects &&
        r.totalBytes === spec.bytes &&
        r.unreferencedObjects === 0 &&
        r.rowsWithoutStoragePointer === 0 &&
        r.preparedReferences === 0 &&
        Array.isArray(r.missingObjectReferences) &&
        r.missingObjectReferences.length === 0,
      "voicemail_reconciliation_incomplete",
    );
    scopes.push({ spec, inventory, directory: dirname(path) });
  }
  check(
    scopes.reduce((n, s) => n + s.spec.objects, 0) === plan.exactObjects &&
      plan.exactObjects === plan.copyBounds.totalObjects &&
      plan.exactObjects <= 1000 &&
      scopes.reduce((n, s) => n + s.spec.bytes, 0) === plan.exactSourceBytes &&
      plan.exactSourceBytes === plan.copyBounds.totalSourceBytes &&
      plan.exactSourceBytes <= 1073741824,
    "voicemail_total_scope_changed",
  );
  const audio = scopes.find((s) => s.spec.sourceBucket === "receptionist-voicemails"),
    raw = scopes.find((s) => s.spec.sourceBucket === "learn-voicemail-sources");
  const a = new Set(audio.inventory.objects.map((e) => e.sourceKey.split("/")[2])),
    b = new Set(raw.inventory.objects.map((e) => e.sourceKey.split("/")[1]));
  check(
    a.size === plan.matchedRawAudioPairs && b.size === a.size && [...a].every((id) => b.has(id)),
    "voicemail_pair_scope_changed",
  );
  return { plan, context, scopes };
}
export async function executeVoicemailBackup(options) {
  check(["copy", "finalize", "restore-pair"].includes(options?.mode), "voicemail_mode_invalid");
  if (options.mode === "restore-pair") return executeVoicemailBackupUnlocked(options);
  return withProductionCommunicationLease(
    recordingContext(options?.scope?.context),
    undefined,
    (communicationLease) => executeVoicemailBackupUnlocked({ ...options, communicationLease }),
  );
}
async function executeVoicemailBackupUnlocked({
  scope,
  mode,
  bucket,
  evidenceRoot,
  createWriterPorts,
  createRestorePorts,
  restoreSelection,
  signal,
  decode = checkRecordingPlayback,
  onProgress,
  communicationLease,
}) {
  check(["copy", "finalize", "restore-pair"].includes(mode), "voicemail_mode_invalid");
  check(!signal?.aborted, "voicemail_cancelled");
  const dir = await directory(evidenceRoot);
  let lock,
    locked = false,
    ports;
  const restored = [];
  const startedAt = new Date().toISOString();
  let journal = {
    state: "prepared",
    mode,
    sourceBucket: bucket ?? null,
    startedAt,
    backupComplete: false,
  };
  try {
    try {
      lock = await open(join(dir, "execution.lock"), "wx", 0o600);
      locked = true;
    } catch (e) {
      if (e.code === "EEXIST") fail("voicemail_execution_already_locked");
      throw e;
    }
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt }));
    await lock.sync();
    await save(dir, "last-attempt.json", journal);
    if (mode !== "restore-pair") {
      check(typeof createWriterPorts === "function", "voicemail_writer_ports_required");
      const selected = scope.scopes.find((s) => s.spec.sourceBucket === bucket);
      check(selected, "voicemail_bucket_scope_invalid");
      const result = await runRecordingBackup({
        communicationLease,
        directory: selected.directory,
        inventoryFileSha256: selected.spec.inventoryFileSha256,
        binding: scope.context,
        mode,
        maxObjects: 100,
        maxBytes: 268435456,
        signal,
        onProgress,
        createPorts: async () => {
          const p = await createWriterPorts(bucket, signal);
          await p.source.inspect();
          await p.destination.inspect();
          return p;
        },
      });
      journal = {
        ...journal,
        state: "bounded_operation_verified",
        result,
        finishedAt: new Date().toISOString(),
      };
      await save(dir, `last-${bucket}-${mode}.json`, journal);
      await save(dir, "last-attempt.json", journal);
      return {
        state: journal.state,
        mode,
        sourceBucket: bucket,
        ...result,
        backupComplete: false,
      };
    }
    check(
      typeof createRestorePorts === "function" && restoreSelection && restoreSelection.length === 2,
      "voicemail_restore_selection_required",
    );
    const selected = restoreSelection.map((r) => {
      const s = scope.scopes.find((s) => s.spec.sourceBucket === r.sourceBucket),
        entry = s?.inventory.objects.find((e) => e.objectId === r.objectId);
      check(
        entry && entry.size > 0 && entry.size <= 8 * 1024 * 1024,
        "voicemail_restore_selection_invalid",
      );
      return { s, entry };
    });
    check(
      new Set(selected.map((x) => x.entry.sourceBucket)).size === 2,
      "voicemail_restore_pair_required",
    );
    const a = selected.find((x) => x.entry.sourceBucket === "receptionist-voicemails"),
      r = selected.find((x) => x.entry.sourceBucket === "learn-voicemail-sources");
    check(
      a.entry.sourceKey.split("/")[2] === r.entry.sourceKey.split("/")[1],
      "voicemail_restore_pair_mismatch",
    );
    ports = await createRestorePorts(signal);
    await ports.destination.inspect();
    const proofs = [];
    for (const { s, entry } of selected) {
      check(!signal?.aborted, "voicemail_cancelled");
      const manifest = await ports.journal.loadManifest(s.inventory.runId);
      check(
        manifest?.objects?.length === s.spec.objects && manifest.totalBytes === s.spec.bytes,
        "voicemail_manifest_scope_changed",
      );
      const canonicalEntries = [...s.inventory.objects]
        .map(recordingIdentity)
        .sort((a, b) => a.objectId.localeCompare(b.objectId));
      const expected = sha(
        Buffer.from(JSON.stringify({ ...s.inventory, objects: canonicalEntries })),
      );
      check(manifest.inventorySha256 === expected, "voicemail_manifest_inventory_changed");
      const got = await restoreRecordingFromManifest(
        manifest,
        s.inventory.runId,
        entry.objectId,
        scope.context,
        ports,
      );
      restored.push(got);
      check(
        got.sourceBucket === entry.sourceBucket &&
          got.bytes === entry.size &&
          got.sha256 === entry.sourceContentSha256 &&
          got.sourceContentSha256 === entry.sourceContentSha256,
        "voicemail_restore_content_changed",
      );
      let playback = null;
      if (entry.sourceBucket === "receptionist-voicemails") {
        playback = await decode(got);
        check(playback.state === "decoded", "voicemail_restored_audio_decode_unconfirmed");
      }
      proofs.push({
        sourceBucket: entry.sourceBucket,
        objectId: entry.objectId,
        bytes: got.bytes,
        sha256: got.sha256,
        manifestRunId: s.inventory.runId,
        playback,
      });
    }
    for (const item of restored) await rm(item.directory, { recursive: true, force: true });
    restored.length = 0;
    journal = {
      ...journal,
      state: "independent_pair_restored_and_verified",
      proofs,
      privateContentRemoved: true,
      sourceAccessDuringRestore: false,
      databaseRestore: "pending_isolated_database_comparison",
      listening: "not_verified",
      finishedAt: new Date().toISOString(),
    };
    await save(dir, "paired-restore.json", journal);
    await save(dir, "last-attempt.json", journal);
    return {
      state: journal.state,
      restoredFiles: 2,
      bytes: proofs.reduce((n, p) => n + p.bytes, 0),
      privateContentRemoved: true,
      databaseRestore: journal.databaseRestore,
      listening: "not_verified",
      backupComplete: false,
    };
  } catch (e) {
    const code = e instanceof RecordingBackupError ? e.code : "voicemail_execution_unconfirmed";
    if (locked)
      await save(dir, "last-attempt.json", {
        ...journal,
        state: "failed",
        code,
        finishedAt: new Date().toISOString(),
      }).catch(() => {});
    fail(code);
  } finally {
    for (const item of restored) await rm(item.directory, { recursive: true, force: true });
    ports?.close?.();
    await lock?.close();
    if (locked) await unlink(join(dir, "execution.lock"));
  }
}
