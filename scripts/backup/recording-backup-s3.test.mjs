import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { fixture, context, time } from "./test-support/s3-fixture.mjs";
import {
  backupRecording,
  restoreRecording,
  finalizeRecordingInventory,
  RecordingBackupError,
} from "./recording-backup-core.mjs";
const tenant = context.tenantId;
const errorCode = (code) => (e) =>
  e instanceof RecordingBackupError && e.code === code && !e.message.includes("PRIVATE");
test("official SDK signed requests copy audio, persist encrypted receipts/manifests and restore exact bytes", async () => {
  const f = fixture();
  try {
    assert.equal(f.calls.length, 0, "construction never makes requests");
    const copied = await backupRecording(f.entry, context, f);
    assert.equal(copied.state, "verified");
    const resumed = await backupRecording(f.entry, context, {
      ...f,
      source: {
        metadata: f.source.metadata,
        read: () => {
          throw Error("must not redownload");
        },
      },
    });
    assert.equal(resumed.recovered, true);
    const inventory = {
      contract: "recording-inventory/1",
      runId: "00000000-0000-4000-8000-000000000004",
      tenantId: tenant,
      sourceProjectRef: context.sourceProjectRef,
      observedAt: new Date(time).toISOString(),
      listingComplete: true,
      sourceSnapshot: "non_atomic",
      objects: [f.entry],
    };
    const result = await finalizeRecordingInventory(inventory, context, f);
    assert.equal(result.manifest.totalBytes, f.bytes.length);
    const recovered = await finalizeRecordingInventory(inventory, context, {
      ...f,
      source: {
        metadata: () => {
          throw Error("source gone");
        },
      },
    });
    assert.equal(recovered.recovered, true);
    const restored = await restoreRecording(copied.receipt, context, f);
    try {
      assert.deepEqual(await readFile(restored.path), f.bytes);
    } finally {
      await rm(restored.directory, { recursive: true, force: true });
    }
    assert.equal(f.objects.size, 3, "one audio, receipt and manifest");
    assert.equal(f.calls.filter((c) => c.method === "PUT").length, 3, "no overwrite on resume");
    assert.equal(
      f.calls.filter((c) => c.hostname.startsWith("sts.")).length,
      1,
      "inspection cached within minute",
    );
  } finally {
    f.close();
  }
});
test("lost S3 upload acknowledgement is not retried by SDK; next run verifies original object", async () => {
  const f = fixture();
  try {
    f.loss = true;
    await assert.rejects(backupRecording(f.entry, context, f), errorCode("s3_request_unconfirmed"));
    assert.equal(f.calls.filter((c) => c.method === "PUT").length, 1);
    await backupRecording(f.entry, context, f);
    assert.equal(f.objects.size, 2);
    assert.equal(f.calls.filter((c) => c.method === "PUT").length, 2, "only receipt added");
  } finally {
    f.close();
  }
});
test("wrong account, region or policy prevents any object request", async () => {
  for (const [property, value, code] of [
    ["account", "999999999999", "s3_account_mismatch"],
    ["region", "eu-west-1", "s3_region_mismatch"],
    ["invalidPolicy", true, "s3_policy_unverified"],
  ]) {
    const f = fixture();
    f[property] = value;
    try {
      await assert.rejects(backupRecording(f.entry, context, f), errorCode(code));
      assert.equal(f.calls.filter((c) => c.method === "PUT" || c.method === "HEAD").length, 0);
    } finally {
      f.close();
    }
  }
});
test("expired inspection cache rechecks effective bucket configuration before another copy", async () => {
  const f = fixture();
  try {
    await f.destination.inspect();
    f.clock = time + 60001;
    f.region = "eu-west-1";
    await assert.rejects(backupRecording(f.entry, context, f), errorCode("s3_region_mismatch"));
    assert.equal(f.objects.size, 0);
  } finally {
    f.close();
  }
});
test("403 and redirects are never interpreted as an absent key or retried", async () => {
  for (const status of [403, 301, 500]) {
    const f = fixture();
    f.failList = status;
    try {
      await assert.rejects(
        backupRecording(f.entry, context, f),
        errorCode("s3_request_unconfirmed"),
      );
      assert.equal(f.calls.filter((c) => c.query?.["list-type"]).length, 1);
      assert.equal(f.calls.filter((c) => c.method === "PUT").length, 0);
    } finally {
      f.close();
    }
  }
});
test("null versions and corrupt streamed bytes cannot become receipts", async () => {
  for (const mode of ["nullVersion", "corrupt"]) {
    const f = fixture();
    f[mode] = true;
    try {
      await assert.rejects(
        backupRecording(f.entry, context, f),
        (e) => e instanceof RecordingBackupError,
      );
      assert.equal(
        [...f.objects.keys()].some((k) => k.includes("/receipts/")),
        false,
      );
    } finally {
      f.close();
    }
  }
});
test("foreign keys and invalid identities are rejected before any signed request", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      f.destination.find("tenants/other/secret"),
      errorCode("s3_key_outside_scope"),
    );
    await assert.rejects(
      f.journal.loadManifest("../other"),
      errorCode("s3_journal_identity_invalid"),
    );
    await assert.rejects(
      f.destination.read(`${context.prefix}objects/${"a".repeat(64)}/${"b".repeat(64)}`, "null"),
      errorCode("s3_version_required"),
    );
    assert.equal(f.calls.length, 0);
  } finally {
    f.close();
  }
});
test("durable journal refuses corrupted response instead of returning JSON as verified", async () => {
  const f = fixture();
  try {
    const result = await backupRecording(f.entry, context, f);
    f.corrupt = true;
    await assert.rejects(
      f.journal.load(result.receipt.identity),
      errorCode("s3_journal_digest_mismatch"),
    );
  } finally {
    f.close();
  }
});

test("a different principal in the same AWS account cannot reach the backup bucket", async () => {
  const f = fixture({
    expectedPrincipalArn: `arn:aws:iam::${context.accountId}:user/approved-writer`,
  });
  try {
    await assert.rejects(f.destination.inspect(), { code: "s3_principal_mismatch" });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].hostname, "sts.eu-west-2.amazonaws.com");
  } finally {
    f.close();
  }
  const matched = fixture({
    expectedPrincipalArn: `arn:aws:iam::${context.accountId}:role/synthetic`,
  });
  try {
    assert.equal((await matched.destination.inspect()).accountId, context.accountId);
  } finally {
    matched.close();
  }
});

// Virtual signals exercise the real SDK without waiting minutes or using AWS.
test("database objects get eight minutes; recordings and database metadata retain two minutes", async (t) => {
  const budgets = [];
  t.mock.method(AbortSignal, "timeout", (ms) => {
    budgets.push(ms);
    return new AbortController().signal;
  });
  for (const database of [false, true]) {
    const f = fixture({ database });
    const { databaseBackupBinding } = await import("./database-backup-template.mjs");
    const ctx = database ? databaseBackupBinding : context;
    const bytes = Buffer.from("synthetic private object");
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(bytes).digest("hex");
    try {
      await f.destination.inspect();
      budgets.length = 0;
      const key = ctx.prefix + "objects/" + "a".repeat(64) + "/" + hash;
      const stored = await f.destination.put({
        key,
        size: bytes.length,
        sha256: hash,
        checksumSHA256: Buffer.from(hash, "hex").toString("base64"),
        encryption: "AES256",
        ifNoneMatch: "*",
        body: () => bytes,
      });
      assert.deepEqual(budgets, [database ? 480000 : 120000, 120000]);
      budgets.length = 0;
      for await (const _ of await f.destination.read(key, stored.versionId)) {
        /* drain */
      }
      assert.deepEqual(budgets, [database ? 480000 : 120000]);
      budgets.length = 0;
      await f.destination.put({
        key: ctx.prefix + "receipts/" + "c".repeat(64) + ".json",
        size: bytes.length,
        sha256: hash,
        checksumSHA256: Buffer.from(hash, "hex").toString("base64"),
        encryption: "AES256",
        ifNoneMatch: "*",
        body: () => bytes,
      });
      assert.deepEqual(budgets, [120000, 120000]);
    } finally {
      f.close();
    }
  }
});

async function deadlineTransport(t, mode, external) {
  const { createDatabaseS3 } = await import("./recording-backup-s3.mjs");
  const { databaseBackupBinding: binding, databaseBackupTemplate } =
    await import("./database-backup-template.mjs");
  const { Readable, PassThrough } = await import("node:stream");
  const principal = "arn:aws:iam::235099643372:user/serviceos/database-backup/synthetic";
  const policy = JSON.parse(
    JSON.stringify(
      databaseBackupTemplate().Resources.DatabasePolicy.Properties.PolicyDocument,
      (_k, v) =>
        v?.["Fn::GetAtt"]
          ? `arn:aws:s3:::${binding.bucket}`
          : v?.["Fn::Sub"]
            ? `arn:aws:s3:::${binding.bucket}/*`
            : v,
    ),
  );
  const calls = [],
    bodies = [];
  const response = (body, headers = {}) => ({
    response: {
      statusCode: 200,
      headers: { "content-type": "application/xml", ...headers },
      body: Readable.from([body]),
    },
  });
  const wrap = (root, body) =>
    `<${root} xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${body}</${root}>`;
  const handler = {
    destroy() {},
    async handle(req, { abortSignal } = {}) {
      calls.push(req);
      if (req.hostname.startsWith("sts."))
        return response(
          `<GetCallerIdentityResponse><GetCallerIdentityResult><Account>${binding.accountId}</Account><Arn>${principal}</Arn></GetCallerIdentityResult></GetCallerIdentityResponse>`,
        );
      const q = req.query ?? {};
      if ("location" in q) return response(wrap("LocationConstraint", binding.region));
      if ("publicAccessBlock" in q)
        return response(
          wrap(
            "PublicAccessBlockConfiguration",
            ["BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets"]
              .map((x) => `<${x}>true</${x}>`)
              .join(""),
          ),
        );
      if ("ownershipControls" in q)
        return response(
          wrap(
            "OwnershipControls",
            "<Rule><ObjectOwnership>BucketOwnerEnforced</ObjectOwnership></Rule>",
          ),
        );
      if ("versioning" in q)
        return response(wrap("VersioningConfiguration", "<Status>Enabled</Status>"));
      if ("encryption" in q)
        return response(
          wrap(
            "ServerSideEncryptionConfiguration",
            "<Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>AES256</SSEAlgorithm></ApplyServerSideEncryptionByDefault></Rule>",
          ),
        );
      if ("object-lock" in q)
        return response(
          wrap(
            "ObjectLockConfiguration",
            "<ObjectLockEnabled>Enabled</ObjectLockEnabled><Rule><DefaultRetention><Mode>GOVERNANCE</Mode><Days>30</Days></DefaultRetention></Rule>",
          ),
        );
      if ("policy" in q)
        return response(JSON.stringify(policy), { "content-type": "application/json" });
      if (mode === "socket")
        throw Object.assign(Error("PRIVATE TOKEN CUSTOMER BODY"), { name: "TimeoutError" });
      if (mode === "stream") {
        const body = new PassThrough();
        bodies.push(body);
        return {
          response: {
            statusCode: 200,
            headers: {
              "content-length": "4",
              "x-amz-version-id": "v1",
              "x-amz-server-side-encryption": "AES256",
              "x-amz-meta-sha256": "a".repeat(64),
              "last-modified": new Date(time).toUTCString(),
              "x-amz-object-lock-mode": "GOVERNANCE",
              "x-amz-object-lock-retain-until-date": new Date(time + 30 * 86400000).toISOString(),
            },
            body,
          },
        };
      }
      if (mode === "cancel") setImmediate(() => external.abort());
      return new Promise((_resolve, reject) => {
        const fail = () =>
          reject(Object.assign(Error("PRIVATE TOKEN CUSTOMER BODY"), { name: "AbortError" }));
        if (abortSignal.aborted) fail();
        else abortSignal.addEventListener("abort", fail, { once: true });
      });
    },
  };
  const transport = createDatabaseS3({
    credentials: async () => ({ accessKeyId: "SYNTHETIC", secretAccessKey: "SYNTHETIC" }),
    requestHandler: handler,
    expectedPrincipalArn: principal,
    signal: external?.signal,
    now: () => time,
  });
  t.after(() => transport.close());
  await transport.destination.inspect();
  return { ...transport, calls, bodies, binding, Readable };
}

test("database deadline and external cancellation stop one conditional upload, destroy stream, and expose fixed codes only", async (t) => {
  for (const mode of ["deadline", "cancel", "socket"]) {
    const external = new AbortController();
    const f = await deadlineTransport(t, mode, external);
    const original = AbortSignal.timeout;
    if (mode === "deadline")
      AbortSignal.timeout = (ms) => {
        assert.equal(ms, 480000);
        const c = new AbortController();
        setImmediate(() => c.abort());
        return c.signal;
      };
    const body = f.Readable.from([Buffer.from("test")]);
    const hash = "a".repeat(64);
    try {
      await assert.rejects(
        f.destination.put({
          key: f.binding.prefix + "objects/" + hash + "/" + hash,
          size: 4,
          sha256: hash,
          checksumSHA256: Buffer.from(hash, "hex").toString("base64"),
          encryption: "AES256",
          ifNoneMatch: "*",
          body: () => body,
        }),
        errorCode(
          {
            deadline: "s3_request_deadline_exceeded",
            cancel: "s3_request_cancelled",
            socket: "s3_transport_timeout",
          }[mode],
        ),
      );
      const writes = f.calls.filter((c) => c.method === "PUT");
      assert.equal(writes.length, 1);
      assert.equal(writes[0].headers["if-none-match"], "*");
      assert.equal(body.destroyed, true);
    } finally {
      AbortSignal.timeout = original;
    }
  }
});

test("database streamed download deadline is bounded and caller abort destroys unread body", async (t) => {
  for (const mode of ["deadline", "cancel"]) {
    const external = new AbortController();
    const f = await deadlineTransport(t, "stream", external);
    const timer = globalThis.setTimeout;
    if (mode === "deadline")
      t.mock.method(globalThis, "setTimeout", (fn, ms, ...args) => {
        if (ms > 470000 && ms <= 480000) return timer(fn, 5, ...args);
        return timer(fn, ms, ...args);
      });
    const iterable = await f.destination.read(
      f.binding.prefix + "objects/" + "a".repeat(64) + "/" + "b".repeat(64),
      "v1",
    );
    if (mode === "cancel") setImmediate(() => external.abort());
    try {
      await assert.rejects(
        async () => {
          for await (const _ of iterable) {
          }
        },
        errorCode(mode === "deadline" ? "s3_stream_timeout" : "s3_request_cancelled"),
      );
      assert.equal(f.bodies[0].destroyed, true);
    } finally {
      t.mock.restoreAll();
    }
  }
});
