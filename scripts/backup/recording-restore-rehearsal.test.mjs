import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, context, time } from "./test-support/s3-fixture.mjs";
import {
  backupRecording,
  finalizeRecordingInventory,
  restoreRecordingFromManifest,
} from "./recording-backup-core.mjs";
import { runRecordingRestore, parseRestoreArgs } from "./run-drummonds-recording-restore.mjs";
import { loadRecordingCredential, binding } from "./drummonds-recording-backup-access.mjs";
function wav() {
  const b = Buffer.alloc(44 + 1600);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(1600, 40);
  for (let i = 0; i < 800; i++)
    b.writeInt16LE(Math.round(1000 * Math.sin((i * Math.PI) / 10)), 44 + i * 2);
  return b;
}
async function prepared(bytes = wav()) {
  const f = fixture({ audioBytes: bytes });
  f.entry.sourceKey = `${context.tenantId}/PRIVATE/call.wav`;
  const runId = "00000000-0000-4000-8000-000000000010";
  await backupRecording(f.entry, context, f);
  const { manifest } = await finalizeRecordingInventory(
    {
      contract: "recording-inventory/1",
      runId,
      tenantId: context.tenantId,
      sourceProjectRef: context.sourceProjectRef,
      observedAt: new Date(time).toISOString(),
      listingComplete: true,
      sourceSnapshot: "non_atomic",
      objects: [f.entry],
    },
    context,
    f,
  );
  return { f, manifest, runId };
}
async function removeEvidence(root) {
  for (const name of await readdir(root)) {
    const evidence = JSON.parse(await readFile(join(root, name, "evidence.json"), "utf8"));
    await rm(evidence.restored.directory, { recursive: true, force: true });
  }
  await rm(root, { recursive: true, force: true });
}
test(
  "source-independent restore decodes real synthetic WAV locally and retains private evidence and original links",
  { skip: process.platform !== "darwin" },
  async () => {
    const { f, manifest, runId } = await prepared();
    const root = await mkdtemp(join(await realpath(tmpdir()), "restore-evidence-test-"));
    try {
      const before = f.calls.length;
      const summary = await runRecordingRestore({
        runId,
        objectId: f.entry.objectId,
        binding: context,
        ports: { destination: f.destination, journal: f.journal, now: () => time },
        evidenceRoot: root,
      });
      assert.equal(summary.playback.state, "decoded");
      assert.equal(summary.playback.frames, 800);
      assert.equal(summary.playback.durationSeconds, 0.1);
      assert.equal(summary.playback.listening, "not_verified");
      assert.equal(summary.recordingReferenceCount, 1);
      assert.equal(summary.databaseRestore, "not_verified");
      assert.equal(summary.backupComplete, false);
      assert.ok(!JSON.stringify(summary).includes("PRIVATE"));
      assert.ok(f.calls.slice(before).every((c) => c.method === "GET" || c.method === "HEAD"));
      const directory = join(root, (await readdir(root))[0]);
      const evidence = JSON.parse(await readFile(join(directory, "evidence.json"), "utf8"));
      assert.deepEqual(await readFile(evidence.restored.path), wav());
      assert.deepEqual(evidence.restored.recordingIds, manifest.objects[0].source.recordingIds);
      assert.equal((await stat(join(directory, "evidence.json"))).mode & 0o777, 0o600);
      assert.equal((await stat(evidence.restored.directory)).mode & 0o777, 0o700);
      assert.deepEqual(await readdir(evidence.restored.directory), [
        evidence.restored.path.split("/").at(-1),
      ]);
    } finally {
      f.close();
      await removeEvidence(root);
    }
  },
);
test("changed manifest inventory, totals or selected object cannot restore bytes", async () => {
  const { f, manifest, runId } = await prepared();
  try {
    const count = f.calls.length;
    for (const changed of [
      { ...manifest, inventorySha256: "a".repeat(64) },
      { ...manifest, totalBytes: 0 },
      { ...manifest, objects: [manifest.objects[0], manifest.objects[0]] },
    ])
      await assert.rejects(
        restoreRecordingFromManifest(changed, runId, f.entry.objectId, context, f),
      );
    await assert.rejects(
      restoreRecordingFromManifest(
        manifest,
        runId,
        "00000000-0000-4000-8000-000000000099",
        context,
        f,
      ),
      { code: "restore_object_not_in_manifest" },
    );
    assert.equal(f.calls.length, count);
  } finally {
    f.close();
  }
});
test(
  "byte-correct but invalid audio preserves restore evidence without claiming playable audio",
  { skip: process.platform !== "darwin" },
  async () => {
    const { f, runId } = await prepared(Buffer.from("not audio"));
    const root = await mkdtemp(join(await realpath(tmpdir()), "restore-evidence-test-"));
    try {
      const summary = await runRecordingRestore({
        runId,
        objectId: f.entry.objectId,
        binding: context,
        ports: f,
        evidenceRoot: root,
      });
      assert.equal(summary.state, "restored_and_verified");
      assert.equal(summary.playback.state, "unconfirmed");
      assert.equal(summary.backupComplete, false);
    } finally {
      f.close();
      await removeEvidence(root);
    }
  },
);
test("restore command accepts only explicit bounded selection and loads only Restore credentials", async () => {
  assert.throws(() => parseRestoreArgs(["--restore-drummonds", "bad", "bad"]));
  const args = [
    "--restore-drummonds",
    "00000000-0000-4000-8000-000000000010",
    "00000000-0000-4000-8000-000000000002",
  ];
  assert.equal(parseRestoreArgs(args).runId, args[1]);
  assert.equal(parseRestoreArgs(args).removeAudioAfterCheck, false);
  assert.equal(
    parseRestoreArgs(["--check-drummonds", ...args.slice(1)]).removeAudioAfterCheck,
    true,
  );
  const key = {
    accessKeyId: "AKIA" + "A".repeat(16),
    secretAccessKey: "A".repeat(40),
    principalArn: `arn:aws:iam::${binding.accountId}:user/serviceos/recording-backup/openfolk-drummonds-recording-access-Restore-SYNTHETIC`,
  };
  const credential = await loadRecordingCredential("Restore", async (cmd, args) => {
    assert.equal(cmd, "/usr/bin/security");
    assert.ok(args.includes("OpenFolk.ServiceOS.RecordingBackup.Restore"));
    return { stdout: JSON.stringify(key) };
  });
  assert.equal(credential.principalArn, key.principalArn);
  await assert.rejects(
    loadRecordingCredential("Restore", async () => ({
      stdout: JSON.stringify({
        ...key,
        principalArn: key.principalArn.replace("-Restore-", "-Writer-"),
      }),
    })),
    { code: "runner_restore_credential_unverified" },
  );
});
test("scheduled restore checks remove audio on decode success or refusal and retain private evidence", async () => {
  for (const failDecode of [false, true]) {
    const { f, runId } = await prepared();
    const root = await mkdtemp(join(await realpath(tmpdir()), "restore-check-test-"));
    try {
      const before = f.calls.length;
      const summary = await runRecordingRestore({
        runId,
        objectId: f.entry.objectId,
        binding: context,
        ports: { destination: f.destination, journal: f.journal, now: () => time },
        evidenceRoot: root,
        removeAudioAfterCheck: true,
        decode: async (restored) => {
          assert.deepEqual(await readFile(restored.path), wav());
          if (failDecode) throw Error("PRIVATE decoder error");
          return { state: "decoded", listening: "not_verified" };
        },
      });
      assert.equal(summary.temporaryAudioRemoved, true);
      assert.equal(summary.sourceInventoryRunId, runId);
      assert.equal(summary.playback.state, failDecode ? "unconfirmed" : "decoded");
      assert.doesNotMatch(JSON.stringify(summary), /PRIVATE/);
      const evidence = JSON.parse(
        await readFile(join(root, (await readdir(root))[0], "evidence.json"), "utf8"),
      );
      await assert.rejects(stat(evidence.restored.directory), { code: "ENOENT" });
      assert.equal(evidence.restored.recordingIds.length, 1);
      assert.ok(f.calls.slice(before).every((c) => ["GET", "HEAD"].includes(c.method)));
    } finally {
      f.close();
      await removeEvidence(root);
    }
  }
});
test("scheduled restore rejects oversized or empty selection before audio retrieval", async () => {
  for (const size of [0, 8 * 1024 * 1024 + 1]) {
    const root = await mkdtemp(join(await realpath(tmpdir()), "restore-limit-test-"));
    const objectId = "00000000-0000-4000-8000-000000000002";
    try {
      await assert.rejects(
        runRecordingRestore({
          runId: "00000000-0000-4000-8000-000000000010",
          objectId,
          binding: context,
          evidenceRoot: root,
          removeAudioAfterCheck: true,
          ports: {
            journal: { loadManifest: async () => ({ objects: [{ source: { objectId, size } }] }) },
          },
        }),
        { code: "restore_check_selection_outside_limit" },
      );
      assert.deepEqual(await readdir(root), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
