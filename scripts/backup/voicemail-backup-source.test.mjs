import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { createVoicemailSource } from "./recording-backup-source.mjs";
import {
  recordingIdentity,
  recordingReceiptIdentity,
  backupRecording,
  finalizeRecordingInventory,
  restoreRecordingFromManifest,
} from "./recording-backup-core.mjs";
import { fixture as s3fixture, context, time } from "./test-support/s3-fixture.mjs";
const tenant = context.tenantId,
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  sha = (b) => createHash("sha256").update(b).digest("hex"),
  date = new Date(time).toISOString();
function fixture(bucket, options = {}) {
  const audio = bucket === "receptionist-voicemails",
    data = Buffer.from(
      audio ? "synthetic-audio" : "From: synthetic@example.invalid\r\n\r\nsigned-source-fixture",
    ),
    key = audio ? `${tenant}/${id(2)}/${id(3)}` : `${tenant}/${id(3)}/${id(4)}.eml`;
  const row = audio
    ? {
        id: id(3),
        tenant_id: tenant,
        mailbox_id: id(2),
        audio_sha256: sha(data),
        audio_bytes: data.length,
        state: "published",
      }
    : {
        id: id(4),
        tenant_id: tenant,
        intake_id: id(3),
        raw_sha256: sha(data),
        raw_bytes: data.length,
      };
  const files = new Map([
      [key, { id: id(1), bytes: data }],
      [`${tenant}/orphan`, { id: id(8), bytes: Buffer.from("orphan") }],
    ]),
    calls = [];
  let contentCorrupt = false,
    publicBucket = false;
  const fetcher = async (url, req) => {
    const u = new URL(url),
      path = u.pathname;
    calls.push(path);
    assert.equal(u.origin, `https://${context.sourceProjectRef}.supabase.co`);
    assert.equal(req.redirect, "error");
    const json = (x) => new Response(JSON.stringify(x));
    if (path === "/rest/v1/tenants") return json([{ id: tenant }]);
    if (path === `/storage/v1/bucket/${bucket}`)
      return json({ id: bucket, name: bucket, public: publicBucket });
    if (
      path ===
      `/rest/v1/${audio ? "receptionist_voicemail_intakes" : "receptionist_voicemail_sources"}`
    ) {
      assert.equal(u.searchParams.get("tenant_id"), `eq.${tenant}`);
      return json(u.searchParams.has("id") ? [] : [row]);
    }
    if (path === "/rest/v1/receptionist_voicemails")
      return json(
        u.searchParams.has("id") || row.state === "prepared"
          ? []
          : [
              {
                id: id(3),
                tenant_id: tenant,
                mailbox_id: id(2),
                recording_path: options.wrongPublishedPath ? `${tenant}/bad` : key,
              },
            ],
      );
    if (path === `/storage/v1/object/list/${bucket}`) {
      const b = JSON.parse(req.body),
        list = new Map();
      for (const [k, f] of files) {
        if (!k.startsWith(b.prefix + "/")) continue;
        const rest = k.slice(b.prefix.length + 1),
          name = rest.split("/")[0];
        list.set(
          name,
          rest.includes("/")
            ? { name, id: null, metadata: null }
            : {
                name,
                id: f.id,
                updated_at: date,
                metadata: { size: f.bytes.length, eTag: sha(f.bytes) },
              },
        );
      }
      return json(
        [...list.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(b.offset, b.offset + 1),
      );
    }
    const info = `/storage/v1/object/info/authenticated/${bucket}/`,
      read = `/storage/v1/object/authenticated/${bucket}/`,
      isInfo = path.startsWith(info);
    assert(isInfo || path.startsWith(read));
    const k = decodeURIComponent(path.slice((isInfo ? info : read).length)),
      f = files.get(k);
    if (!f) return new Response("missing", { status: 404 });
    if (isInfo)
      return json({
        id: f.id,
        name: k,
        bucket_id: bucket,
        size: f.bytes.length,
        version: "v1",
        etag: sha(f.bytes),
        last_modified: date,
      });
    assert.equal(req.headers["If-Match"], `"${sha(f.bytes)}"`);
    return new Response(contentCorrupt ? Buffer.alloc(f.bytes.length) : f.bytes, {
      headers: { "content-length": String(f.bytes.length), etag: `"${sha(f.bytes)}"` },
    });
  };
  const source = createVoicemailSource(context, bucket, {
    credentials: async () => ({ apikey: "synthetic", token: "synthetic" }),
    fetcher,
    now: () => time,
    ...options,
  });
  return {
    source,
    data,
    key,
    row,
    files,
    calls,
    set corrupt(v) {
      contentCorrupt = v;
    },
    set public(v) {
      publicBucket = v;
    },
  };
}
test("legacy identity bytes stay unchanged; voicemail bucket and content hashes cannot collide", () => {
  const old = {
    tenantId: tenant,
    objectId: id(1),
    sourceKey: `${tenant}/same`,
    sourceVersion: "v1",
    size: 3,
    recordingIds: [id(2)],
  };
  assert.deepEqual(recordingIdentity(old), old);
  const expected = createHash("sha256")
    .update(JSON.stringify({ sourceProjectRef: context.sourceProjectRef, ...old }))
    .digest("hex");
  assert.equal(recordingReceiptIdentity(old, context), expected);
  const a = {
      ...old,
      sourceBucket: "receptionist-voicemails",
      sourceContentSha256: "a".repeat(64),
    },
    b = { ...a, sourceBucket: "learn-voicemail-sources" };
  assert.notEqual(recordingReceiptIdentity(a, context), recordingReceiptIdentity(b, context));
  assert.throws(() => recordingIdentity({ ...a, sourceBucket: "avatars" }));
  assert.throws(() => recordingIdentity({ ...old, sourceContentSha256: "a".repeat(64) }));
});
for (const bucket of ["receptionist-voicemails", "learn-voicemail-sources"]) {
  test(`${bucket}: complete recursive inventory, orphan retention, conditional read and signed-source hash`, async () => {
    const f = fixture(bucket),
      r = await f.source.inventory();
    assert.equal(r.inventory.objects.length, 2);
    assert.equal(r.reconciliation.unreferencedObjects, 1);
    assert.equal(r.reconciliation.sourceBucket, bucket);
    const e = r.inventory.objects.find((x) => x.sourceKey === f.key);
    assert.equal(e.sourceContentSha256, sha(f.data));
    assert.equal(e.sourceBucket, bucket);
    assert.deepEqual(Buffer.concat(await Array.fromAsync(await f.source.read(e))), f.data);
    await assert.rejects(
      f.source.metadata({
        ...e,
        sourceBucket:
          bucket === "receptionist-voicemails"
            ? "learn-voicemail-sources"
            : "receptionist-voicemails",
      }),
      { code: "source_bucket_outside_scope" },
    );
    f.corrupt = true;
    await assert.rejects(Array.fromAsync(await f.source.read(e)), {
      code: "source_content_hash_mismatch",
    });
  });
  test(`${bucket}: missing expected objects stay explicit and content binding changes fail`, async () => {
    const f = fixture(bucket);
    f.files.delete(f.key);
    const r = await f.source.inventory();
    assert.equal(r.reconciliation.missingObjectReferences.length, 1);
    const g = fixture(bucket);
    g.row[bucket === "receptionist-voicemails" ? "audio_bytes" : "raw_bytes"]++;
    await assert.rejects(g.source.inventory(), { code: "source_content_binding_changed" });
    g.public = true;
    const h = fixture(bucket);
    h.public = true;
    await assert.rejects(h.source.inventory(), { code: "source_bucket_unverified" });
  });
  test(`${bucket}: independent AWS-fixture restore preserves bucket provenance and bytes`, async () => {
    const src = fixture(bucket),
      inv = (await src.source.inventory()).inventory,
      s3 = s3fixture({ audioBytes: src.data });
    const ports = { ...s3, source: src.source };
    let restored;
    try {
      for (const e of inv.objects) await backupRecording(e, context, ports);
      const { manifest } = await finalizeRecordingInventory(inv, context, ports);
      const e = inv.objects.find((x) => x.sourceKey === src.key);
      restored = await restoreRecordingFromManifest(manifest, inv.runId, e.objectId, context, {
        ...s3,
        source: undefined,
      });
      assert.equal(restored.sourceBucket, bucket);
      assert.equal(restored.sourceContentSha256, sha(src.data));
      assert.deepEqual(await readFile(restored.path), src.data);
      const changed = structuredClone(manifest);
      changed.objects[0].source.sourceBucket = "avatars";
      await assert.rejects(
        restoreRecordingFromManifest(changed, inv.runId, e.objectId, context, s3),
      );
    } finally {
      s3.close();
      if (restored) await rm(restored.directory, { recursive: true, force: true });
    }
  });
}
test("prepared audio is inventoried without inventing publication; published pointer mismatch fails", async () => {
  const f = fixture("receptionist-voicemails");
  f.row.state = "prepared";
  const r = await f.source.inventory();
  assert.equal(r.reconciliation.preparedReferences, 1);
  await assert.rejects(
    fixture("receptionist-voicemails", { wrongPublishedPath: true }).source.inventory(),
    { code: "source_published_references_unverified" },
  );
  assert.throws(() => createVoicemailSource(context, "phone-recordings", {}), {
    code: "source_bucket_outside_scope",
  });
});
test("core refuses a substituted signed-content hash before any destination object write", async () => {
  const f = s3fixture({ audioBytes: Buffer.from("synthetic") });
  try {
    f.entry.sourceBucket = "learn-voicemail-sources";
    f.entry.sourceContentSha256 = "a".repeat(64);
    await assert.rejects(backupRecording(f.entry, context, f), {
      code: "source_content_hash_mismatch",
    });
    assert(!f.calls.some((c) => c.method === "PUT"));
  } finally {
    f.close();
  }
});
