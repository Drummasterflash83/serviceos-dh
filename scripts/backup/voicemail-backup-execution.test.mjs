import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { executeVoicemailBackup } from "./voicemail-backup-execution.mjs";
import { fixture, context, time } from "./test-support/s3-fixture.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  sha = (b) => createHash("sha256").update(b).digest("hex");
async function setup() {
  const dir = await mkdtemp(join(await realpath(tmpdir()), "vm-backup-test-")),
    f = fixture(),
    scopes = [],
    content = new Map();
  for (const [bucket, n] of [
    ["receptionist-voicemails", 1],
    ["learn-voicemail-sources", 2],
  ]) {
    const bytes = Buffer.from(
        bucket === "receptionist-voicemails"
          ? "synthetic-audio"
          : "From: synthetic@example.invalid\r\n\r\noriginal",
      ),
      sourceKey =
        bucket === "receptionist-voicemails"
          ? `${context.tenantId}/${id(3)}/${id(4)}`
          : `${context.tenantId}/${id(4)}/${id(5)}.eml`,
      entry = {
        tenantId: context.tenantId,
        objectId: id(n),
        sourceKey,
        sourceVersion: "v1",
        size: bytes.length,
        recordingIds: [id(n + 10)],
        sourceBucket: bucket,
        sourceContentSha256: sha(bytes),
      };
    content.set(bucket, bytes);
    const inventory = {
        contract: "recording-inventory/1",
        runId: id(n + 20),
        tenantId: context.tenantId,
        sourceProjectRef: context.sourceProjectRef,
        observedAt: new Date(time).toISOString(),
        listingComplete: true,
        sourceSnapshot: "non_atomic",
        objects: [entry],
      },
      directory = await mkdtemp(join(dir, "inv-")),
      raw = JSON.stringify(inventory);
    await writeFile(join(directory, "inventory.json"), raw, { mode: 0o600 });
    scopes.push({
      directory,
      inventory,
      spec: {
        sourceBucket: bucket,
        inventoryFileSha256: sha(raw),
        runId: inventory.runId,
        objects: 1,
        bytes: bytes.length,
      },
    });
  }
  const scope = { scopes, context, plan: {} };
  const source = (bucket) => ({
    inspect: async () => ({}),
    metadata: async (e) => structuredClone(e),
    read: async () => Readable.from([content.get(bucket)]),
  });
  return {
    scope,
    dir,
    f,
    selection: scopes.map((s) => ({
      sourceBucket: s.spec.sourceBucket,
      objectId: s.inventory.objects[0].objectId,
    })),
    writer: async (bucket) => ({ ...f, source: source(bucket), close: () => {} }),
    restore: async () => ({ ...f, source: undefined, close: () => {} }),
    close: async () => {
      f.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
async function copies(x) {
  for (const s of x.scope.scopes)
    for (const mode of ["copy", "finalize"])
      await executeVoicemailBackup({
        scope: x.scope,
        mode,
        bucket: s.spec.sourceBucket,
        evidenceRoot: join(x.dir, "evidence"),
        createWriterPorts: x.writer,
      });
}
test("bounded copy, explicit finalization and independent paired restore keep raw private and decode audio only", async () => {
  const x = await setup();
  try {
    await copies(x);
    let calls = 0;
    const before = x.f.calls.length;
    const result = await executeVoicemailBackup({
      scope: x.scope,
      mode: "restore-pair",
      evidenceRoot: join(x.dir, "evidence"),
      restoreSelection: x.selection,
      createRestorePorts: x.restore,
      createWriterPorts: () => {
        throw Error("writer forbidden");
      },
      decode: async (got) => {
        calls++;
        assert.equal(got.sourceBucket, "receptionist-voicemails");
        return { state: "decoded", listening: "not_verified" };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.state, "independent_pair_restored_and_verified");
    assert.equal(result.backupComplete, false);
    assert(result.privateContentRemoved);
    assert(x.f.calls.slice(before).every((c) => ["GET", "HEAD"].includes(c.method)));
    const e = JSON.parse(await readFile(join(x.dir, "evidence", "paired-restore.json")));
    assert.equal(e.proofs.length, 2);
    assert.equal((await stat(join(x.dir, "evidence", "paired-restore.json"))).mode & 0o777, 0o600);
  } finally {
    await x.close();
  }
});
test("incomplete copy, changed source and invalid selection fail before restore credentials or completion", async () => {
  const x = await setup();
  try {
    await assert.rejects(
      executeVoicemailBackup({
        scope: x.scope,
        mode: "finalize",
        bucket: "receptionist-voicemails",
        evidenceRoot: join(x.dir, "evidence"),
        createWriterPorts: () => {
          throw Error("must not load");
        },
      }),
      { code: "runner_copy_pass_incomplete" },
    );
    await assert.rejects(
      executeVoicemailBackup({
        scope: x.scope,
        mode: "restore-pair",
        evidenceRoot: join(x.dir, "evidence"),
        restoreSelection: [x.selection[0], x.selection[0]],
        createRestorePorts: () => {
          throw Error("must not load");
        },
      }),
      { code: "voicemail_restore_pair_required" },
    );
    await assert.rejects(
      executeVoicemailBackup({
        scope: x.scope,
        mode: "copy",
        bucket: "receptionist-voicemails",
        evidenceRoot: join(x.dir, "evidence"),
        createWriterPorts: async (b) => {
          const p = await x.writer(b);
          p.source.metadata = async (e) => ({ ...e, sourceVersion: "changed" });
          return p;
        },
      }),
      { code: "source_changed" },
    );
    assert(!x.f.calls.some((c) => c.method === "PUT"));
  } finally {
    await x.close();
  }
});
test("corrupted independent restore stops and releases local lock without claiming successful playback", async () => {
  const x = await setup();
  try {
    await copies(x);
    await assert.rejects(
      executeVoicemailBackup({
        scope: x.scope,
        mode: "restore-pair",
        evidenceRoot: join(x.dir, "evidence"),
        restoreSelection: x.selection,
        createRestorePorts: x.restore,
        decode: async () => ({ state: "unconfirmed" }),
      }),
      { code: "voicemail_restored_audio_decode_unconfirmed" },
    );
    const e = JSON.parse(await readFile(join(x.dir, "evidence", "last-attempt.json")));
    assert.equal(e.state, "failed");
    assert.equal(e.backupComplete, false);
    await assert.rejects(stat(join(x.dir, "evidence", "execution.lock")), { code: "ENOENT" });
  } finally {
    await x.close();
  }
});
