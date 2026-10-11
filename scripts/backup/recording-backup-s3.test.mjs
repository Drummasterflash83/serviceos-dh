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
