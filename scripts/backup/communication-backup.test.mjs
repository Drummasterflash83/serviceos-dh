import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { fixture, context, time } from "./test-support/s3-fixture.mjs";
import {
  communicationBudget,
  communicationBuckets,
  runCommunicationBackup,
  readCommunicationHealth,
} from "./run-drummonds-communication-backups.mjs";
import { runDailyBackup } from "./run-drummonds-recording-daily.mjs";
import { resolveCommunicationSourceCredential } from "./communication-backup-live.mjs";
const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const sha = (b) => createHash("sha256").update(b).digest("hex");
async function setup(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "communication-synthetic-"))),
    bytes = Buffer.from("synthetic-voicemail-original");
  const f = fixture(),
    entries = Object.fromEntries(communicationBuckets.map((b) => [b, []]));
  let serial = 1000,
    opened = 0;
  const state = {
    root,
    bytes,
    f,
    entries,
    failBucket: null,
    pause: null,
    started: null,
  };
  state.addPair = (n) => {
    entries["learn-voicemail-sources"].push({
      tenantId: context.tenantId,
      objectId: id(100 + n),
      sourceKey: `${context.tenantId}/${id(n)}/${id(200 + n)}.eml`,
      sourceVersion: "v1",
      size: bytes.length,
      recordingIds: [id(200 + n)],
      sourceBucket: "learn-voicemail-sources",
      sourceContentSha256: sha(bytes),
    });
    entries["receptionist-voicemails"].push({
      tenantId: context.tenantId,
      objectId: id(300 + n),
      sourceKey: `${context.tenantId}/${id(2)}/${id(n)}`,
      sourceVersion: "v1",
      size: bytes.length,
      recordingIds: [id(n)],
      sourceBucket: "receptionist-voicemails",
      sourceContentSha256: sha(bytes),
    });
  };
  entries["phone-recordings"].push({
    ...f.entry,
    sourceKey: context.tenantId + "/phone.wav",
    size: bytes.length,
  });
  state.addPair(20);
  state.session = async (_signal, budget) => {
    opened++;
    state.started?.();
    if (state.pause) await state.pause;
    return {
      close() {},
      async ports(bucket) {
        if (state.failBucket === bucket) throw Error("PRIVATE secret");
        return {
          ...f,
          now: () => time,
          close() {},
          source: {
            inventory: async () => {
              budget.sourceRequest();
              return {
                inventory: {
                  contract: "recording-inventory/1",
                  runId: id(serial++),
                  tenantId: context.tenantId,
                  sourceProjectRef: context.sourceProjectRef,
                  observedAt: new Date(time - 1000).toISOString(),
                  listingComplete: true,
                  sourceSnapshot: "non_atomic",
                  objects: structuredClone(entries[bucket]),
                },
                reconciliation: {
                  contract: "recording-source-reconciliation/1",
                  tenantId: context.tenantId,
                  sourceProjectRef: context.sourceProjectRef,
                  objects: entries[bucket].length,
                  totalBytes: entries[bucket].length * bytes.length,
                  recordingRows: entries[bucket].length,
                  rowsWithoutStoragePointer: 0,
                  unreferencedObjects: 0,
                  missingObjectReferences: [],
                  ...(bucket === "phone-recordings"
                    ? {}
                    : {
                        sourceBucket: bucket,
                        preparedReferences: state.prepared ?? 0,
                      }),
                },
              };
            },
            metadata: async (e) => {
              budget.sourceRequest();
              return structuredClone(entries[bucket].find((x) => x.objectId === e.objectId));
            },
            read: async () => {
              budget.sourceRequest();
              return Readable.from([bytes]);
            },
            usage: () => budget.usage(),
          },
        };
      },
    };
  };
  state.opened = () => opened;
  state.run = (options) =>
    runCommunicationBackup({
      root,
      context,
      now: () => time,
      createSession: state.session,
      ...options,
    });
  t.after(async () => {
    f.close();
    await rm(root, { recursive: true, force: true });
  });
  return state;
}
test("three real protocol manifests dedup repeats and include late historical arrivals on next full inventory", async (t) => {
  const x = await setup(t);
  const first = await x.run();
  assert.equal(first.pair.matchedPairs, 1);
  assert.equal(first.budget.objects, 3);
  const phonePath = join(x.root, "recording-daily", "last-success.json");
  assert.equal(
    JSON.parse(await readFile(phonePath)).runId,
    first.buckets["phone-recordings"].runId,
  );
  const writes = () =>
    x.f.calls.filter((c) => c.method === "PUT" && c.path.includes("/objects/")).length;
  assert.equal(writes(), 3);
  const second = await x.run();
  assert.equal(second.budget.objects, 0);
  assert.equal(writes(), 3);
  // Older provider dates are deliberately irrelevant: full source listing is fresh.
  x.addPair(21);
  const third = await x.run();
  assert.equal(third.pair.matchedPairs, 2);
  assert.equal(third.budget.objects, 2);
  assert.equal(writes(), 5);
  assert.equal(
    (await readCommunicationHealth(x.root, time + 1000)).status,
    "observed_inventory_verified",
  );
  assert.equal(
    (await readCommunicationHealth(x.root, time + 31 * 3600000)).reason,
    "inventory_overdue",
  );
  assert.equal(third.backupComplete, false);
});
test("global new-object and byte limits cannot multiply per bucket or publish an aggregate", async (t) => {
  for (const limits of [{ objects: 2 }, { bytes: 60 }]) {
    const x = await setup(t);
    await assert.rejects(x.run({ limits }), {
      code: "communication_new_data_limit",
    });
    await assert.rejects(stat(join(x.root, "communication-daily", "last-success.json")), {
      code: "ENOENT",
    });
    assert.equal(
      x.f.calls.filter((c) => c.method === "PUT" && c.path.includes("/objects/")).length,
      2,
    );
  }
});
test("shared source-request budget fails across buckets without publishing partial success", async (t) => {
  const x = await setup(t);
  await assert.rejects(x.run({ limits: { requests: 7 } }), {
    code: "communication_request_limit",
  });
  const attempt = JSON.parse(
    await readFile(join(x.root, "communication-daily", "last-attempt.json")),
  );
  assert.equal(attempt.budget.requests, 7);
  assert.deepEqual(attempt.completedBuckets, ["phone-recordings"]);
  assert.equal((await readCommunicationHealth(x.root, time + 1000)).status, "attention");
  await assert.rejects(stat(join(x.root, "recording-daily", "daily.lock")), {
    code: "ENOENT",
  });
});
test("one-sided arrival, prepared refs and one bucket failure preserve aggregate last-success and report attention", async (t) => {
  for (const mode of ["mismatch", "prepared", "failure"]) {
    const x = await setup(t);
    await x.run();
    const file = join(x.root, "communication-daily", "last-success.json"),
      before = await readFile(file, "utf8");
    if (mode === "mismatch") {
      x.addPair(21);
      x.entries["receptionist-voicemails"].pop();
    }
    if (mode === "prepared") x.prepared = 1;
    if (mode === "failure") x.failBucket = "learn-voicemail-sources";
    await assert.rejects(x.run());
    assert.equal(await readFile(file, "utf8"), before);
    const health = await readCommunicationHealth(x.root, time + 1000);
    assert.equal(health.status, "attention");
    assert.equal(health.reason, "latest_run_failed");
    assert.doesNotMatch(JSON.stringify(health), /PRIVATE/);
  }
});
test("supervisor lock blocks old phone runner and another supervisor before credentials; stale fake lease rejected", async (t) => {
  const x = await setup(t);
  let release, ready;
  const started = new Promise((r) => (ready = r));
  x.pause = new Promise((r) => (release = r));
  x.started = ready;
  const first = x.run();
  await started;
  let oldOpened = 0;
  await assert.rejects(
    runDailyBackup({
      directory: join(x.root, "recording-daily"),
      binding: context,
      createPorts: async () => {
        oldOpened++;
      },
    }),
    { code: "daily_already_locked" },
  );
  await assert.rejects(x.run(), { code: "daily_already_locked" });
  assert.equal(x.opened(), 1);
  assert.equal(oldOpened, 0);
  await assert.rejects(
    runDailyBackup({
      directory: join(x.root, "recording-daily"),
      binding: context,
      lockLease: {},
      createPorts: async () => {
        oldOpened++;
      },
    }),
    { code: "daily_lease_invalid" },
  );
  assert.equal(oldOpened, 0);
  release();
  await first;
  await assert.rejects(stat(join(x.root, "recording-daily", "daily.lock")), {
    code: "ENOENT",
  });
});
test("cancelled supervisor never opens credentials or leaves a lock", async (t) => {
  const x = await setup(t);
  await assert.rejects(x.run({ signal: AbortSignal.abort() }), {
    code: "communication_cancelled",
  });
  assert.equal(x.opened(), 0);
});
test("budget reservations are atomic and bounded", () => {
  const b = communicationBudget({ objects: 3, bytes: 10, requests: 2 });
  b.reserveNewData({ objects: 2, bytes: 6 });
  assert.throws(() => b.reserveNewData({ objects: 2, bytes: 1 }), {
    code: "communication_new_data_limit",
  });
  assert.equal(b.usage().objects, 2);
  b.sourceRequest();
  b.sourceRequest();
  assert.throws(() => b.sourceRequest(), {
    code: "communication_request_limit",
  });
  assert.throws(() => communicationBudget({ requests: 100001 }), {
    code: "communication_limits_invalid",
  });
});
test("credential resolver binds exact project and runtime fingerprint, never name or fallback", async () => {
  const key = "SYNTHETIC-MODERN",
    project = {
      id: "tgbnakbxwcqjeimygroz",
      organization_id: "nmhqcjrjrtwsvlcvqqnh",
      status: "ACTIVE_HEALTHY",
    };
  for (const mode of [
    "good",
    "wrongProject",
    "mismatch",
    "duplicateKey",
    "duplicateRuntime",
    "missingRuntime",
  ]) {
    const calls = [];
    const management = async (path) => {
      calls.push(path);
      if (path === "")
        return {
          ...project,
          ...(mode === "wrongProject" ? { id: "other" } : {}),
        };
      if (path.startsWith("/api-keys"))
        return [
          { name: "service_role", api_key: "OLD-SYNTHETIC" },
          { name: "new-api-key", api_key: key },
          ...(mode === "duplicateKey" ? [{ api_key: key }] : []),
        ];
      return mode === "missingRuntime"
        ? []
        : [
            {
              name: "SUPABASE_SERVICE_ROLE_KEY",
              digest: sha(mode === "mismatch" ? "different" : key),
            },
            ...(mode === "duplicateRuntime"
              ? [{ name: "SUPABASE_SERVICE_ROLE_KEY", digest: sha(key) }]
              : []),
          ];
    };
    if (mode === "good") assert.equal(await resolveCommunicationSourceCredential(management), key);
    else await assert.rejects(resolveCommunicationSourceCredential(management));
    assert.equal(calls.length, mode === "wrongProject" ? 1 : 3);
  }
});

test("future health timestamps and coverage regression cannot refresh aggregate success", async (t) => {
  const x = await setup(t);
  await x.run();
  const file = join(x.root, "communication-daily", "last-success.json");
  const original = await readFile(file, "utf8"),
    prior = JSON.parse(original);
  prior.verifiedAt = new Date(time + 5000).toISOString();
  await writeFile(file, JSON.stringify(prior), { mode: 0o600 });
  assert.equal(
    (await readCommunicationHealth(x.root, time + 1000)).reason,
    "inventory_time_invalid",
  );
  await assert.rejects(x.run(), {
    code: "communication_clock_or_coverage_regressed",
  });
  assert.equal(JSON.parse(await readFile(file, "utf8")).verifiedAt, prior.verifiedAt);
});

test("production manual recording and voicemail paths share the daily lock before credential access", async (t) => {
  const { binding } = await import("./drummonds-recording-backup-access.mjs");
  const { withDailyLease, productionCommunicationLockDirectory } =
    await import("./communication-backup-lock.mjs");
  const { runRecordingBackup } = await import("./recording-backup-runner.mjs");
  const { executeVoicemailBackup } = await import("./voicemail-backup-execution.mjs");
  let opened = 0;
  await withDailyLease(productionCommunicationLockDirectory, async () => {
    for (const mode of ["copy", "finalize"]) {
      await assert.rejects(
        runRecordingBackup({
          binding,
          mode,
          createPorts: async () => {
            opened++;
          },
        }),
        { code: "daily_already_locked" },
      );
      await assert.rejects(
        executeVoicemailBackup({
          scope: { context: binding },
          mode,
          createWriterPorts: async () => {
            opened++;
          },
        }),
        { code: "daily_already_locked" },
      );
    }
  });
  assert.equal(opened, 0);
  await assert.rejects(stat(join(productionCommunicationLockDirectory, "daily.lock")), {
    code: "ENOENT",
  });
});

test("manual voicemail outer lease is reused by its nested batch, blocks daily work, and releases after terminal failure", async (t) => {
  const { binding } = await import("./drummonds-recording-backup-access.mjs");
  const { productionCommunicationLockDirectory } = await import("./communication-backup-lock.mjs");
  const { executeVoicemailBackup } = await import("./voicemail-backup-execution.mjs");
  const { withDailyLease } = await import("./communication-backup-lock.mjs");
  const root = await realpath(await mkdtemp(join(tmpdir(), "manual-shared-lock-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bucket = "learn-voicemail-sources",
    inventory = {
      contract: "recording-inventory/1",
      runId: id(999),
      tenantId: binding.tenantId,
      sourceProjectRef: binding.sourceProjectRef,
      observedAt: new Date().toISOString(),
      listingComplete: true,
      sourceSnapshot: "non_atomic",
      objects: [],
    };
  const raw = JSON.stringify(inventory);
  await writeFile(join(root, "inventory.json"), raw, { mode: 0o600 });
  let ready,
    release,
    opened = 0;
  const started = new Promise((r) => (ready = r)),
    waiting = new Promise((r) => (release = r));
  const running = executeVoicemailBackup({
    scope: {
      context: binding,
      scopes: [
        {
          directory: root,
          inventory,
          spec: { sourceBucket: bucket, inventoryFileSha256: sha(raw) },
        },
      ],
    },
    mode: "copy",
    bucket,
    evidenceRoot: join(root, "evidence"),
    createWriterPorts: async () => {
      opened++;
      ready();
      await waiting;
      throw Error("synthetic terminal failure");
    },
  });
  await started;
  await assert.rejects(
    runDailyBackup({
      directory: productionCommunicationLockDirectory,
      binding,
      createPorts: () => {
        throw Error("must not run");
      },
    }),
    { code: "daily_already_locked" },
  );
  await assert.rejects(
    withDailyLease(productionCommunicationLockDirectory, () => {
      throw Error("must not run");
    }),
    { code: "daily_already_locked" },
  );
  await assert.rejects(
    runCommunicationBackup({
      root: join(productionCommunicationLockDirectory, ".."),
      context: binding,
      createSession: () => {
        throw Error("must not run");
      },
    }),
    { code: "daily_already_locked" },
  );
  assert.equal(
    opened,
    1,
    "nested batch reached factory exactly once, without deadlocking its own outer lease",
  );
  release();
  await assert.rejects(running);
  await assert.rejects(stat(join(productionCommunicationLockDirectory, "daily.lock")), {
    code: "ENOENT",
  });
});

test("all 510 established voicemail receipts fit a zero-new-data daily repeat despite the 400-new-object cap", async (t) => {
  const { backupRecording } = await import("./recording-backup-core.mjs");
  const x = await setup(t);
  for (let n = 21; n < 275; n++) x.addPair(n);
  assert.equal(
    x.entries["learn-voicemail-sources"].length + x.entries["receptionist-voicemails"].length,
    510,
  );
  const session = await x.session(AbortSignal.timeout(60000), communicationBudget());
  for (const bucket of communicationBuckets) {
    const ports = await session.ports(bucket);
    const entries = x.entries[bucket];
    for (let start = 0; start < entries.length; start += 4)
      await Promise.all(
        entries.slice(start, start + 4).map((e) => backupRecording(e, context, ports)),
      );
  }
  const before = x.f.calls.filter((c) => c.method === "PUT" && c.path.includes("/objects/")).length;
  const result = await x.run();
  assert.equal(result.pair.matchedPairs, 255);
  assert.equal(result.budget.objects, 0);
  assert.equal(result.budget.bytes, 0);
  assert.equal(
    x.f.calls.filter((c) => c.method === "PUT" && c.path.includes("/objects/")).length,
    before,
  );
});
