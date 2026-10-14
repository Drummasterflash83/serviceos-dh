/** AWS transport for the private backup protocol. Construction performs no I/O.
 * Callers supply an approved credentials provider, never browser credentials. */
import * as S3 from "@aws-sdk/client-s3";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { createHash } from "node:crypto";
import { recordingContext, RecordingBackupError } from "./recording-backup-core.mjs";
import { databaseBackupBinding } from "./database-backup-template.mjs";
const MAX_JSON = 32 * 1024 * 1024;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const requireValue = (ok, code = "s3_response_unverified") => {
  if (!ok) throw new RecordingBackupError(code);
};
const iso = (v) => (v instanceof Date && Number.isFinite(v.getTime()) ? v.toISOString() : null);
const array = (v) => (Array.isArray(v) ? v : [v]);
const canonical = (v) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );
const safe = async (fn) => {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof RecordingBackupError) throw error;
    throw new RecordingBackupError("s3_request_unconfirmed");
  }
};
function policyVerified(policy, bucket) {
  const resource = `arn:aws:s3:::${bucket}`;
  const statements = array(policy?.Statement ?? []);
  const deny = (action, resources, condition) =>
    statements.some(
      (s) =>
        s.Effect === "Deny" &&
        s.Principal === "*" &&
        !s.NotAction &&
        !s.NotResource &&
        array(s.Action).includes(action) &&
        resources.every((r) => array(s.Resource).includes(r)) &&
        canonical(s.Condition) === canonical(condition),
    );
  return (
    deny("s3:*", [resource, `${resource}/*`], { Bool: { "aws:SecureTransport": "false" } }) &&
    deny("s3:PutObject", [`${resource}/*`], {
      StringNotEquals: { "s3:x-amz-server-side-encryption": "AES256" },
    }) &&
    deny("s3:PutObject", [`${resource}/*`], {
      Null: { "s3:if-none-match": "true" },
      Bool: { "s3:ObjectCreationOperation": "true" },
    })
  );
}
/** requestHandler is only a test seam; production defaults to bounded HTTPS. */
export function createRecordingS3(binding, options = {}) {
  return createPrivateS3(recordingContext(binding), 256 * 1024 * 1024, options);
}
/** Fixed database destination; no arbitrary bucket or source-credential fallback. */
export function createDatabaseS3(options = {}) {
  requireValue(
    /^arn:aws:iam::235099643372:user\/serviceos\/database-backup\/[A-Za-z0-9+=,.@_-]+$/.test(
      options.expectedPrincipalArn ?? "",
    ),
    "s3_database_principal_required",
  );
  return createPrivateS3({ ...databaseBackupBinding }, 1024 ** 3, options, 480000);
}
function createPrivateS3(
  context,
  MAX_BYTES,
  {
    credentials,
    requestHandler,
    now = Date.now,
    expectedPrincipalArn,
    signal,
    readAttempts = 1,
  } = {},
  objectTransferMs = 120000,
) {
  requireValue(typeof credentials === "function", "s3_credentials_provider_required");
  requireValue(
    Number.isInteger(readAttempts) && readAttempts >= 1 && readAttempts <= 3,
    "s3_read_attempts_invalid",
  );
  const abortAfter = (ms) =>
    signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
  const options = {
    region: "eu-west-2",
    credentials,
    maxAttempts: 1,
    // Provider diagnostics may contain private request details; expose safe codes only.
    logger: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
    requestHandler:
      requestHandler ?? new NodeHttpHandler({ connectionTimeout: 10000, socketTimeout: 120000 }),
  };
  const s3 = new S3.S3Client({
    ...options,
    endpoint: "https://s3.eu-west-2.amazonaws.com",
    forcePathStyle: true,
    followRegionRedirects: false,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const sts = new STSClient({ ...options, endpoint: "https://sts.eu-west-2.amazonaws.com" });
  const bucket = { Bucket: context.bucket, ExpectedBucketOwner: context.accountId };
  let inspectedAt = null;
  let readRequestRetries = 0,
    journalReadRetries = 0;
  const readCommands = new Set([
    S3.GetBucketLocationCommand,
    S3.GetPublicAccessBlockCommand,
    S3.GetBucketOwnershipControlsCommand,
    S3.GetBucketVersioningCommand,
    S3.GetBucketEncryptionCommand,
    S3.GetObjectLockConfigurationCommand,
    S3.GetBucketPolicyCommand,
    S3.ListObjectsV2Command,
    S3.HeadObjectCommand,
    S3.GetObjectCommand,
  ]);
  const transportFailure = (e) =>
    ["TimeoutError", "RequestTimeout"].includes(e?.name) ||
    ["ETIMEDOUT", "ESOCKETTIMEDOUT", "ECONNRESET", "EPIPE"].includes(e?.code);
  const keyValid = (key) => {
    requireValue(typeof key === "string" && key.startsWith(context.prefix), "s3_key_outside_scope");
    const suffix = key.slice(context.prefix.length);
    requireValue(
      /^(objects\/[a-f0-9]{64}\/[a-f0-9]{64}|receipts\/[a-f0-9]{64}\.json|manifests\/[a-f0-9-]{36}\.json)$/.test(
        suffix,
      ),
      "s3_key_outside_scope",
    );
  };
  const versionValid = (v) =>
    requireValue(
      typeof v === "string" && v.length > 0 && v.length <= 1024 && v !== "null",
      "s3_version_required",
    );
  // Only the fixed database factory receives the eight-minute object budget.
  // Metadata/journal calls, recording limits and idle/connect timeouts stay fixed.
  const transferBudget = (key) =>
    key.startsWith(context.prefix + "objects/") ? objectTransferMs : 120000;
  const send = async (Command, input, timeoutMs = 120000) => {
    const deadline = AbortSignal.timeout(timeoutMs);
    const abortSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    for (let attempt = 1; ; attempt++) {
      try {
        return await s3.send(new Command({ ...bucket, ...input }), { abortSignal });
      } catch (error) {
        // These fixed codes retain useful failure classification without exposing
        // keys, headers, credentials, response bodies or SDK exception messages.
        if (signal?.aborted) throw new RecordingBackupError("s3_request_cancelled");
        if (deadline.aborted) throw new RecordingBackupError("s3_request_deadline_exceeded");
        if (readCommands.has(Command) && transportFailure(error) && attempt < readAttempts) {
          readRequestRetries++;
          continue;
        }
        if (
          ["TimeoutError", "RequestTimeout"].includes(error?.name) ||
          ["ETIMEDOUT", "ESOCKETTIMEDOUT"].includes(error?.code)
        )
          throw new RecordingBackupError("s3_transport_timeout");
        throw error;
      }
    }
  };
  const inspect = () =>
    safe(async () => {
      // Refresh per minute at most. Each request is still bound by ExpectedBucketOwner.
      if (inspectedAt === null || now() < inspectedAt || now() - inspectedAt >= 60000) {
        const identity = await sts.send(new GetCallerIdentityCommand({}), {
          abortSignal: abortAfter(30000),
        });
        requireValue(identity.Account === context.accountId, "s3_account_mismatch");
        requireValue(
          expectedPrincipalArn === undefined || identity.Arn === expectedPrincipalArn,
          "s3_principal_mismatch",
        );
        // Deliberately serial: a failed gate prevents all subsequent work.
        const location = await send(S3.GetBucketLocationCommand, {});
        requireValue(location.LocationConstraint === context.region, "s3_region_mismatch");
        const access = await send(S3.GetPublicAccessBlockCommand, {});
        requireValue(
          [
            "BlockPublicAcls",
            "IgnorePublicAcls",
            "BlockPublicPolicy",
            "RestrictPublicBuckets",
          ].every((k) => access.PublicAccessBlockConfiguration?.[k] === true),
          "s3_public_access_unverified",
        );
        const ownership = await send(S3.GetBucketOwnershipControlsCommand, {});
        requireValue(
          ownership.OwnershipControls?.Rules?.length === 1 &&
            ownership.OwnershipControls.Rules[0].ObjectOwnership === "BucketOwnerEnforced",
          "s3_ownership_unverified",
        );
        const versioning = await send(S3.GetBucketVersioningCommand, {});
        requireValue(versioning.Status === "Enabled", "s3_versioning_unverified");
        const encryption = await send(S3.GetBucketEncryptionCommand, {});
        const rules = encryption.ServerSideEncryptionConfiguration?.Rules;
        requireValue(
          rules?.length === 1 &&
            rules[0].ApplyServerSideEncryptionByDefault?.SSEAlgorithm === "AES256",
          "s3_encryption_unverified",
        );
        const lock = await send(S3.GetObjectLockConfigurationCommand, {});
        const retention = lock.ObjectLockConfiguration?.Rule?.DefaultRetention;
        requireValue(
          lock.ObjectLockConfiguration?.ObjectLockEnabled === "Enabled" &&
            retention?.Mode === "GOVERNANCE" &&
            retention.Days === 30 &&
            retention.Years === undefined,
          "s3_retention_unverified",
        );
        const policy = await send(S3.GetBucketPolicyCommand, {});
        requireValue(
          typeof policy.Policy === "string" &&
            policy.Policy.length <= 32768 &&
            policyVerified(JSON.parse(policy.Policy), context.bucket),
          "s3_policy_unverified",
        );
        inspectedAt = now();
      }
      return {
        ...context,
        private: true,
        tlsRequired: true,
        versioning: "Enabled",
        encryption: "AES256",
        retentionMode: "GOVERNANCE",
        retentionDays: 30,
        conditionalWritesRequired: true,
      };
    });
  const describe = (key, result) => {
    versionValid(result.VersionId);
    requireValue(
      !result.DeleteMarker &&
        Number.isSafeInteger(result.ContentLength) &&
        result.ContentLength >= 0 &&
        result.ContentLength <= MAX_BYTES &&
        /^[a-f0-9]{64}$/.test(result.Metadata?.sha256 ?? "") &&
        result.ServerSideEncryption === "AES256" &&
        result.ObjectLockMode === "GOVERNANCE" &&
        iso(result.LastModified) &&
        iso(result.ObjectLockRetainUntilDate) &&
        result.ObjectLockRetainUntilDate.getTime() >=
          result.LastModified.getTime() + 30 * 86400000 - 1000,
      "s3_object_unverified",
    );
    return {
      key,
      versionId: result.VersionId,
      size: result.ContentLength,
      sha256: result.Metadata.sha256,
      encryption: result.ServerSideEncryption,
      retentionMode: result.ObjectLockMode,
      createdAt: iso(result.LastModified),
      retainUntil: iso(result.ObjectLockRetainUntilDate),
    };
  };
  const head = (key, versionId) =>
    safe(async () => {
      keyValid(key);
      if (versionId !== undefined) versionValid(versionId);
      await inspect();
      const result = await send(S3.HeadObjectCommand, {
        Key: key,
        ...(versionId ? { VersionId: versionId } : {}),
      });
      const value = describe(key, result);
      if (versionId) requireValue(value.versionId === versionId, "s3_version_mismatch");
      return value;
    });
  const find = (key) =>
    safe(async () => {
      keyValid(key);
      await inspect();
      // Prefix-scoped ListBucket permission need not authorise absence disclosure
      // through HEAD. Use an exact-prefix, single-result list before HEAD instead.
      const listing = await send(S3.ListObjectsV2Command, { Prefix: key, MaxKeys: 1 });
      const items = listing.Contents ?? [];
      requireValue(
        listing.Prefix === key &&
          listing.MaxKeys === 1 &&
          items.length <= 1 &&
          listing.KeyCount === items.length &&
          items.every((item) => typeof item.Key === "string" && item.Key.startsWith(key)),
        "s3_listing_unverified",
      );
      if (!items.length || items[0].Key !== key) return null;
      // Disappearance or denied access after listing is uncertainty, not absence.
      return head(key);
    });
  const read = (key, versionId) =>
    safe(async () => {
      keyValid(key);
      versionValid(versionId);
      await inspect();
      const budgetMs = transferBudget(key),
        started = performance.now();
      const result = await send(S3.GetObjectCommand, { Key: key, VersionId: versionId }, budgetMs);
      try {
        describe(key, result);
        requireValue(result.VersionId === versionId, "s3_version_mismatch");
      } catch (e) {
        result.Body?.destroy?.();
        throw e;
      }
      const body = result.Body;
      requireValue(body && typeof body[Symbol.asyncIterator] === "function", "s3_stream_missing");
      // The absolute deadline covers stream consumption, not only response headers.
      return (async function* () {
        let timeout, cancel;
        const deadline = new Promise((_, reject) => {
          timeout = setTimeout(
            () => {
              body.destroy?.();
              reject(new RecordingBackupError("s3_stream_timeout"));
            },
            Math.max(1, budgetMs - (performance.now() - started)),
          );
          timeout.unref?.();
          cancel = () => {
            body.destroy?.();
            reject(new RecordingBackupError("s3_request_cancelled"));
          };
          if (signal?.aborted) cancel();
          else signal?.addEventListener("abort", cancel, { once: true });
        });
        const iterator = body[Symbol.asyncIterator]();
        let bytes = 0;
        try {
          while (true) {
            const item = await Promise.race([iterator.next(), deadline]);
            if (item.done) break;
            requireValue(item.value instanceof Uint8Array, "s3_stream_invalid");
            bytes += item.value.byteLength;
            requireValue(bytes <= result.ContentLength, "s3_stream_size_mismatch");
            yield item.value;
          }
          requireValue(bytes === result.ContentLength, "s3_stream_size_mismatch");
        } catch (error) {
          if (signal?.aborted) throw new RecordingBackupError("s3_request_cancelled");
          if (error instanceof RecordingBackupError) throw error;
          if (performance.now() - started >= budgetMs)
            throw new RecordingBackupError("s3_stream_timeout");
          if (
            ["TimeoutError", "RequestTimeout"].includes(error?.name) ||
            ["ETIMEDOUT", "ESOCKETTIMEDOUT"].includes(error?.code)
          )
            throw new RecordingBackupError("s3_transport_timeout");
          throw new RecordingBackupError("s3_stream_unconfirmed");
        } finally {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", cancel);
          body.destroy?.();
        }
      })();
    });
  const put = (request) =>
    safe(async () => {
      keyValid(request?.key);
      requireValue(
        request.ifNoneMatch === "*" &&
          request.encryption === "AES256" &&
          /^[a-f0-9]{64}$/.test(request.sha256 ?? "") &&
          request.checksumSHA256 === Buffer.from(request.sha256, "hex").toString("base64") &&
          Number.isSafeInteger(request.size) &&
          request.size >= 0 &&
          request.size <= MAX_BYTES &&
          typeof request.body === "function",
        "s3_upload_invalid",
      );
      await inspect();
      const body = request.body();
      let result;
      try {
        result = await send(
          S3.PutObjectCommand,
          {
            Key: request.key,
            Body: body,
            ContentLength: request.size,
            ContentType: request.key.endsWith(".json")
              ? "application/json"
              : "application/octet-stream",
            IfNoneMatch: "*",
            ServerSideEncryption: "AES256",
            ChecksumAlgorithm: "SHA256",
            ChecksumSHA256: request.checksumSHA256,
            Metadata: { sha256: request.sha256 },
          },
          transferBudget(request.key),
        );
      } finally {
        body?.destroy?.();
      }
      versionValid(result.VersionId);
      requireValue(
        result.ServerSideEncryption === "AES256" &&
          result.ChecksumSHA256 === request.checksumSHA256,
        "s3_upload_unverified",
      );
      // Do not infer retention from the request. Read the exact stored version.
      return head(request.key, result.VersionId);
    });
  const destination = {
    inspect,
    recovery: () => ({ readRequestRetries, journalReadRetries }),
    find,
    version: (key, id) => head(key, id),
    read,
    put,
  };
  async function loadJsonOnce(key) {
    const version = await destination.find(key);
    if (!version) return null;
    requireValue(version.size <= MAX_JSON, "s3_journal_too_large");
    const chunks = [];
    for await (const chunk of await destination.read(key, version.versionId)) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    requireValue(sha(bytes) === version.sha256, "s3_journal_digest_mismatch");
    return JSON.parse(bytes.toString("utf8"));
  }
  async function loadJson(key) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await loadJsonOnce(key);
      } catch (e) {
        if (
          signal?.aborted ||
          attempt >= readAttempts ||
          !(e instanceof RecordingBackupError) ||
          !["s3_transport_timeout", "s3_stream_timeout", "s3_stream_unconfirmed"].includes(e.code)
        )
          throw e;
        journalReadRetries++;
      }
    }
  }
  async function saveJson(key, value) {
    const prior = await loadJson(key);
    if (prior !== null) return prior;
    const bytes = Buffer.from(JSON.stringify(value));
    requireValue(bytes.length <= MAX_JSON, "s3_journal_too_large");
    const digest = sha(bytes);
    // Any uncertain write stops. A later invocation reads/verifies the object.
    await destination.put({
      key,
      size: bytes.length,
      sha256: digest,
      checksumSHA256: Buffer.from(digest, "hex").toString("base64"),
      ifNoneMatch: "*",
      encryption: "AES256",
      body: () => bytes,
    });
    const saved = await loadJson(key);
    requireValue(canonical(saved) === canonical(value), "s3_journal_conflict");
    return saved;
  }
  const receiptKey = (id) => {
    requireValue(/^[a-f0-9]{64}$/.test(id ?? ""), "s3_journal_identity_invalid");
    return `${context.prefix}receipts/${id}.json`;
  };
  const manifestKey = (id) => {
    requireValue(
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id ?? ""),
      "s3_journal_identity_invalid",
    );
    return `${context.prefix}manifests/${id}.json`;
  };
  const journal = {
    load: (id) => safe(() => loadJson(receiptKey(id))),
    saveIfAbsent: (id, value) => safe(() => saveJson(receiptKey(id), value)),
    loadManifest: (id) => safe(() => loadJson(manifestKey(id))),
    saveManifestIfAbsent: (id, value) => safe(() => saveJson(manifestKey(id), value)),
  };
  return {
    destination,
    journal,
    close: () => {
      s3.destroy();
      sts.destroy();
    },
  };
}
