import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRecordingSource } from "./recording-backup-source.mjs";
import { RecordingBackupError } from "./recording-backup-core.mjs";
const tenant = "00000000-0000-0000-0000-000000000001",
  project = "tgbnakbxwcqjeimygroz";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const date = "2026-10-11T12:00:00.000Z";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const code = (expected) => (e) =>
  e instanceof RecordingBackupError && e.code === expected && !e.message.includes("PRIVATE");
function fixture(options = {}) {
  const calls = [],
    files = new Map(),
    rows = [];
  function add(path, n, bytes = Buffer.from(`audio-${n}`)) {
    files.set(path, {
      id: id(n),
      key: path,
      bytes,
      updated: date,
      etag: sha(bytes),
      version: `version-${n}`,
    });
  }
  add(`${tenant}/calls/a.wav`, 1);
  add(`${tenant}/orphan-folder/extra.wav`, 2);
  add(`${tenant}/root.wav`, 3, Buffer.alloc(0));
  rows.push(
    { id: id(101), tenant_id: tenant, storage_path: `${tenant}/calls/a.wav` },
    { id: id(102), tenant_id: tenant, storage_path: `${tenant}/calls/a.wav` },
    { id: id(103), tenant_id: tenant, storage_path: `${tenant}/missing.wav` },
    { id: id(104), tenant_id: tenant, storage_path: null },
  );
  let listCalls = 0,
    status = null,
    badEtag = false,
    truncate = false,
    changePass = false,
    duplicate = false,
    privateBucket = true,
    wrongTenant = false;
  const fetcher = async (url, request) => {
    const u = new URL(url);
    calls.push({ url: u, request });
    await options.beforeRequest?.(u, request);
    assert.equal(u.origin, `https://${project}.supabase.co`);
    assert.equal(request.redirect, "error");
    assert.equal(request.headers.Authorization, "Bearer SYNTHETIC");
    assert.equal(request.headers.apikey, "SYNTHETIC");
    assert.ok(request.signal instanceof AbortSignal);
    if (status) return new Response("PRIVATE provider error", { status });
    const json = (data) =>
      new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
    if (u.pathname === "/rest/v1/tenants") return json([{ id: wrongTenant ? id(999) : tenant }]);
    if (u.pathname === "/storage/v1/bucket/phone-recordings")
      return json({ id: "phone-recordings", name: "phone-recordings", public: !privateBucket });
    if (u.pathname === "/rest/v1/phone_recordings") {
      assert.equal(u.searchParams.get("tenant_id"), `eq.${tenant}`);
      assert.equal(u.searchParams.get("order"), "id.asc");
      const cursor = u.searchParams.get("id")?.slice(3),
        path = u.searchParams.get("storage_path")?.slice(3);
      return json(
        rows
          .filter((r) => (!cursor || r.id > cursor) && (!path || r.storage_path === path))
          .slice(0, 1),
      );
    }
    if (u.pathname === "/storage/v1/object/list/phone-recordings") {
      assert.equal(request.method, "POST");
      const b = JSON.parse(request.body);
      assert.ok(b.prefix === tenant || b.prefix.startsWith(`${tenant}/`));
      listCalls++;
      if (changePass && listCalls === 8) add(`${tenant}/late.wav`, 4);
      const all = new Map();
      for (const f of files.values()) {
        if (!f.key.startsWith(b.prefix + "/")) continue;
        const suffix = f.key.slice(b.prefix.length + 1),
          name = suffix.split("/")[0];
        all.set(
          name,
          suffix.includes("/")
            ? { name, id: null, metadata: null, updated_at: null }
            : {
                name,
                id: f.id,
                updated_at: f.updated,
                metadata: { size: f.bytes.length, eTag: f.etag },
              },
        );
      }
      const list = [...all.values()].sort((a, b) => a.name.localeCompare(b.name));
      return json(list.slice(duplicate ? 0 : b.offset, (duplicate ? 0 : b.offset) + 1));
    }
    const info = "/storage/v1/object/info/authenticated/phone-recordings/",
      download = "/storage/v1/object/authenticated/phone-recordings/";
    const isInfo = u.pathname.startsWith(info);
    const key = decodeURIComponent(u.pathname.slice((isInfo ? info : download).length));
    const f = files.get(key);
    if (!f) return new Response("missing", { status: 404 });
    if (isInfo) {
      await options.beforeInfo?.(key);
      return json({
        id: f.id,
        name: key,
        version: f.version,
        bucket_id: "phone-recordings",
        size: f.bytes.length,
        etag: f.etag,
        last_modified: f.updated,
      });
    }
    assert.ok(u.pathname.startsWith(download));
    assert.equal(request.method, "GET");
    assert.equal(request.headers["If-Match"], `"${f.etag}"`);
    return new Response(truncate ? f.bytes.subarray(1) : f.bytes, {
      headers: {
        etag: `"${badEtag ? "bad-etag" : f.etag}"`,
        "content-length": String(f.bytes.length),
      },
    });
  };
  const source = createRecordingSource(
    { tenantId: tenant, sourceProjectRef: project },
    {
      credentials: async () => ({ apikey: "SYNTHETIC", token: "SYNTHETIC" }),
      fetcher,
      now: () => Date.parse(date),
      ...options,
    },
  );
  return {
    source,
    calls,
    files,
    rows,
    add,
    set status(v) {
      status = v;
    },
    set badEtag(v) {
      badEtag = v;
    },
    set truncate(v) {
      truncate = v;
    },
    set changePass(v) {
      changePass = v;
    },
    set duplicate(v) {
      duplicate = v;
    },
    set privateBucket(v) {
      privateBucket = v;
    },
    set wrongTenant(v) {
      wrongTenant = v;
    },
  };
}
test("whole tenant traversal includes unreferenced folders, root files, zero bytes and all recording links despite short pages", async () => {
  const f = fixture();
  assert.equal(f.calls.length, 0);
  const { inventory, reconciliation } = await f.source.inventory();
  assert.equal(inventory.objects.length, 3);
  assert.equal(inventory.listingComplete, true);
  assert.equal(inventory.sourceSnapshot, "non_atomic");
  assert.deepEqual(inventory.objects[0].recordingIds, [id(101), id(102)]);
  assert.equal(reconciliation.unreferencedObjects, 2);
  assert.equal(reconciliation.rowsWithoutStoragePointer, 1);
  assert.equal(reconciliation.missingObjectReferences.length, 1);
  assert.equal(reconciliation.recordingRows, 4);
  assert.equal(inventory.objects[2].size, 0);
  assert.ok(
    f.calls
      .filter((c) => c.url.pathname.includes("/object/list/"))
      .some((c) => JSON.parse(c.request.body).prefix.endsWith("/orphan-folder")),
  );
  assert.ok(
    f.calls.filter((c) => c.url.pathname.includes("/phone_recordings")).length > 4,
    "one-row pages do not falsely end scan",
  );
});
test("source metadata and conditional byte stream match the inventory revision and links", async () => {
  const f = fixture();
  const { inventory } = await f.source.inventory();
  const entry = inventory.objects[0];
  assert.deepEqual(await f.source.metadata(entry), entry);
  const chunks = [];
  for await (const b of await f.source.read(entry)) chunks.push(b);
  assert.deepEqual(Buffer.concat(chunks), f.files.get(entry.sourceKey).bytes);
  f.rows.push({ id: id(105), tenant_id: tenant, storage_path: entry.sourceKey });
  await assert.rejects(f.source.read(entry), code("source_changed"));
});
test("source mutation between recursive passes cannot produce complete inventory", async () => {
  const f = fixture();
  f.changePass = true;
  await assert.rejects(f.source.inventory(), code("source_inventory_changed"));
});
test("duplicate storage pages and explicit request exhaustion fail instead of silently truncating inventory", async () => {
  const f = fixture();
  f.duplicate = true;
  await assert.rejects(f.source.inventory(), code("source_listing_unverified"));
  const bounded = fixture({ requestBudget: 3 });
  await assert.rejects(bounded.source.inventory(), code("source_request_budget_exhausted"));
  assert.equal(bounded.source.usage().requests, 3);
});
test("wrong tenant, public bucket and foreign recording pointer block inventory", async () => {
  for (const mode of ["wrongTenant", "privateBucket", "foreignPointer"]) {
    const f = fixture();
    if (mode === "privateBucket") f.privateBucket = false;
    else if (mode === "foreignPointer") f.rows[0].storage_path = "another-tenant/a.wav";
    else f.wrongTenant = true;
    await assert.rejects(f.source.inventory(), (e) => e instanceof RecordingBackupError);
    assert.equal(
      f.calls.some((c) => c.url.pathname.includes("/object/authenticated/")),
      false,
    );
  }
});
test("stale ETag and truncated byte stream cannot pass as the requested recording", async () => {
  const f = fixture();
  const { inventory } = await f.source.inventory();
  const entry = inventory.objects[0];
  f.badEtag = true;
  await assert.rejects(f.source.read(entry), code("source_download_unverified"));
  f.badEtag = false;
  f.truncate = true;
  await assert.rejects(async () => {
    for await (const b of await f.source.read(entry)) void b;
  }, code("source_byte_length_mismatch"));
});
test("source transport failure is safe and neither retried nor treated as an empty inventory", async () => {
  const f = fixture();
  f.status = 403;
  await assert.rejects(f.source.inventory(), code("source_response_unavailable"));
  assert.equal(f.calls.length, 1);
  const failing = fixture({
    credentials: async () => {
      throw Error("PRIVATE secret");
    },
  });
  await assert.rejects(failing.source.inspect(), code("source_request_unconfirmed"));
});
test("opted-in JSON reads recover known network interruption with the same deadline and counted budget", async () => {
  let failed = false;
  const signals = [];
  const f = fixture({
    readAttempts: 3,
    beforeRequest(u, request) {
      if (u.pathname === "/rest/v1/tenants") {
        signals.push(request.signal);
        if (!failed) {
          failed = true;
          throw Object.assign(TypeError("PRIVATE network failure"), {
            cause: { code: "UND_ERR_SOCKET" },
          });
        }
      }
    },
  });
  await f.source.inspect();
  assert.equal(signals.length, 2);
  assert.equal(signals[0], signals[1]);
  assert.equal(f.source.usage().readRetries, 1);
  assert.equal(f.source.usage().requests, 3);
  assert.ok(
    f.calls.every(
      (c) => c.url.origin === `https://${project}.supabase.co` && c.request.redirect === "error",
    ),
  );
});
test("partial JSON is discarded before retry and persistent transport failure consumes a bounded budget", async () => {
  const fetcher = async (url, request) => {
    if (new URL(url).pathname === "/rest/v1/tenants" && !fetcher.failed) {
      fetcher.failed = true;
      let sent = false;
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (!sent) {
              sent = true;
              controller.enqueue(new TextEncoder().encode('[{"id":'));
            } else
              controller.error(
                Object.assign(TypeError("PRIVATE body interruption"), {
                  cause: { code: "UND_ERR_SOCKET" },
                }),
              );
          },
        }),
      );
    }
    return new Response(
      JSON.stringify(
        new URL(url).pathname === "/rest/v1/tenants"
          ? [{ id: tenant }]
          : { id: "phone-recordings", name: "phone-recordings", public: false },
      ),
    );
  };
  const recovering = createRecordingSource(
    { tenantId: tenant, sourceProjectRef: project },
    {
      readAttempts: 3,
      credentials: async () => ({ apikey: "SYNTHETIC", token: "SYNTHETIC" }),
      fetcher,
    },
  );
  await recovering.inspect();
  assert.equal(recovering.usage().readRetries, 1);
  assert.equal(recovering.usage().requests, 3);
  let calls = 0;
  const unavailable = fixture({
    readAttempts: 3,
    beforeRequest() {
      calls++;
      throw Object.assign(Error("PRIVATE reset"), { code: "ECONNRESET" });
    },
  });
  await assert.rejects(unavailable.source.inspect(), code("source_request_unconfirmed"));
  assert.equal(calls, 3);
  assert.equal(unavailable.source.usage().requests, 3);
  assert.equal(unavailable.source.usage().readRetries, 2);
});
test("denial, redirects, malformed JSON and exhausted quota never become retryable empty success", async () => {
  for (const status of [401, 403, 404, 307]) {
    const f = fixture({ readAttempts: 3 });
    f.status = status;
    await assert.rejects(f.source.inspect(), code("source_response_unavailable"));
    assert.equal(f.calls.length, 1);
    assert.equal(f.source.usage().readRetries, 0);
  }
  let calls = 0;
  const malformed = fixture({
    readAttempts: 3,
    fetcher: async () => {
      calls++;
      return new Response("PRIVATE not JSON");
    },
  });
  await assert.rejects(malformed.source.inspect(), code("source_request_unconfirmed"));
  assert.equal(calls, 1);
  const quota = fixture({
    readAttempts: 3,
    requestBudget: 1,
    beforeRequest() {
      throw Object.assign(Error("PRIVATE reset"), { code: "ECONNRESET" });
    },
  });
  await assert.rejects(quota.source.inspect(), code("source_request_budget_exhausted"));
  assert.equal(quota.calls.length, 1);
  assert.equal(quota.source.usage().requests, 1);
});
test("transient HTTP failure can recover but caller cancellation stops before another request", async () => {
  const f = fixture({
    readAttempts: 3,
    beforeRequest() {
      f.status = f.calls.length === 1 ? 503 : null;
    },
  });
  await f.source.inspect();
  assert.equal(f.source.usage().readRetries, 1);
  const controller = new AbortController();
  let calls = 0;
  const cancelled = fixture({
    readAttempts: 3,
    signal: controller.signal,
    beforeRequest() {
      calls++;
      controller.abort();
      throw Object.assign(Error("PRIVATE reset"), { code: "ECONNRESET" });
    },
  });
  await assert.rejects(cancelled.source.inspect(), code("source_request_cancelled"));
  assert.equal(calls, 1);
  assert.equal(cancelled.source.usage().readRetries, 0);
});
test("credential timeout is not a transport read and is never retried", async () => {
  let loads = 0;
  const f = fixture({
    readAttempts: 3,
    credentials: async () => {
      loads++;
      throw Object.assign(Error("PRIVATE credential timeout"), { code: "ETIMEDOUT" });
    },
  });
  await assert.rejects(f.source.inspect(), code("source_request_unconfirmed"));
  assert.equal(loads, 1);
  assert.equal(f.calls.length, 0);
  assert.equal(f.source.usage().readRetries, 0);
});
test("invalid tenant or traversal key is rejected before any request", async () => {
  assert.throws(
    () =>
      createRecordingSource(
        { tenantId: tenant, sourceProjectRef: "evil.example" },
        { credentials: () => {} },
      ),
    code("source_binding_invalid"),
  );
  const f = fixture();
  await assert.rejects(
    f.source.metadata({
      tenantId: tenant,
      objectId: id(1),
      sourceKey: `${tenant}/../secret`,
      sourceVersion: "v1",
      size: 1,
      recordingIds: [],
    }),
    code("source_key_outside_scope"),
  );
  assert.equal(f.calls.length, 0);
});

test("Supabase source through official AWS SDK retains every listed file and restores byte-exact content and recording links", async () => {
  const { fixture: awsFixture, context } = await import("./test-support/s3-fixture.mjs");
  const { backupRecording, finalizeRecordingInventory, restoreRecording } =
    await import("./recording-backup-core.mjs");
  const { readFile, rm } = await import("node:fs/promises");
  const f = fixture(),
    aws = awsFixture();
  try {
    const { inventory, reconciliation } = await f.source.inventory();
    const ports = {
      source: f.source,
      destination: aws.destination,
      journal: aws.journal,
      now: aws.now,
    };
    for (const entry of inventory.objects) await backupRecording(entry, context, ports);
    const completed = await finalizeRecordingInventory(inventory, context, ports);
    assert.equal(completed.manifest.objects.length, 3);
    assert.equal(completed.manifest.recordingReferences, 2);
    assert.equal(completed.manifest.totalBytes, reconciliation.totalBytes);
    for (const receipt of completed.manifest.objects) {
      const restored = await restoreRecording(receipt, context, ports);
      try {
        assert.deepEqual(
          await readFile(restored.path),
          f.files.get(receipt.source.sourceKey).bytes,
        );
        assert.deepEqual(restored.recordingIds, receipt.source.recordingIds);
      } finally {
        await rm(restored.directory, { recursive: true, force: true });
      }
    }
    assert.equal(aws.objects.size, 7, "three recordings, three receipts and one manifest");
    assert.equal(
      reconciliation.missingObjectReferences.length,
      1,
      "missing source stays unresolved",
    );
    assert.equal(completed.manifest.playback, "not_verified");
  } finally {
    aws.close();
  }
});

test("inventory limits metadata reads to four and preserves listing order despite reversed completion", async () => {
  let active = 0,
    peak = 0,
    calls = 0,
    releaseBatch;
  const pending = [];
  const firstBatch = new Promise((resolve) => {
    releaseBatch = resolve;
  });
  const f = fixture({
    beforeInfo: async () => {
      active++;
      peak = Math.max(peak, active);
      calls++;
      if (calls <= 4)
        await new Promise((resolve) => {
          pending.push(resolve);
          if (pending.length === 4) releaseBatch();
        });
      active--;
    },
  });
  for (let n = 4; n <= 9; n++) f.add(`${tenant}/batch-${n}.wav`, n);
  const running = f.source.inventory();
  await firstBatch;
  assert.equal(calls, 4);
  assert.equal(active, 4);
  for (const release of pending.reverse()) release();
  const { inventory } = await running;
  assert.equal(peak, 4);
  assert.equal(active, 0);
  assert.equal(inventory.objects.length, 9);
  assert.deepEqual(
    inventory.objects.map((o) => o.objectId),
    Array.from({ length: 9 }, (_, n) => id(n + 1)),
  );
});

test("failed metadata batch drains existing reads and never starts the next batch", async () => {
  let calls = 0,
    arrived;
  const pending = [];
  const firstBatch = new Promise((resolve) => {
    arrived = resolve;
  });
  const f = fixture({
    beforeInfo: async () => {
      calls++;
      if (calls === 1) throw Error("PRIVATE provider detail");
      await new Promise((resolve) => {
        pending.push(resolve);
        if (pending.length === 3) arrived();
      });
    },
  });
  for (let n = 4; n <= 9; n++) f.add(`${tenant}/batch-${n}.wav`, n);
  let settled = false;
  const running = f.source.inventory().finally(() => {
    settled = true;
  });
  const rejected = assert.rejects(running, code("source_request_unconfirmed"));
  await firstBatch;
  assert.equal(calls, 4);
  assert.equal(settled, false);
  for (const release of pending) release();
  await rejected;
  assert.equal(settled, true);
  assert.equal(calls, 4);
});
