import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { createRecordingS3 } from "../recording-backup-s3.mjs";
import { recordingBackupTemplate } from "../recording-backup-template.mjs";
const tenant = "00000000-0000-0000-0000-000000000001";
export const context = {
  tenantId: tenant,
  sourceProjectRef: "tgbnakbxwcqjeimygroz",
  accountId: "123456789012",
  region: "eu-west-2",
  bucket: "openfolk-synthetic-recordings",
  prefix: `tenants/${tenant}/`,
};
export const time = Date.parse("2026-10-11T12:00:00Z");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const xml = (root, body) =>
  `<${root} xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${body}</${root}>`;
export function fixture() {
  const calls = [],
    objects = new Map();
  let serial = 0,
    loss = false,
    corrupt = false,
    region = context.region,
    account = context.accountId,
    clock = time;
  let failList = null,
    nullVersion = false,
    invalidPolicy = false;
  const policy = recordingBackupTemplate().Resources.RecordingPolicy.Properties.PolicyDocument;
  const resolvedPolicy = JSON.parse(
    JSON.stringify(policy, (_k, v) => {
      if (v?.["Fn::GetAtt"]) return `arn:aws:s3:::${context.bucket}`;
      if (v?.["Fn::Sub"]) return `arn:aws:s3:::${context.bucket}/*`;
      return v;
    }),
  );
  const headers = (record) => ({
    "content-length": String(record.bytes.length),
    "x-amz-version-id": nullVersion ? "null" : record.id,
    "x-amz-server-side-encryption": "AES256",
    "x-amz-meta-sha256": sha(record.bytes),
    "last-modified": new Date(time).toUTCString(),
    "x-amz-object-lock-mode": "GOVERNANCE",
    "x-amz-object-lock-retain-until-date": new Date(time + 30 * 86400000).toISOString(),
  });
  function response(statusCode, body = "", extra = {}) {
    return {
      response: {
        statusCode,
        headers: { "content-type": "application/xml", ...extra },
        body: Readable.from([Buffer.from(body)]),
      },
    };
  }
  const handler = {
    destroy() {},
    async handle(req) {
      calls.push(req);
      assert.equal(req.protocol, "https:");
      assert.ok(
        req.headers.authorization.startsWith("AWS4-HMAC-SHA256 "),
        "Official SDK signs synthetic request",
      );
      assert.ok(req.headers.authorization.includes("/eu-west-2/"));
      if (req.hostname === "sts.eu-west-2.amazonaws.com")
        return response(
          200,
          `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Account>${account}</Account><Arn>arn:aws:iam::${account}:role/synthetic</Arn><UserId>synthetic</UserId></GetCallerIdentityResult></GetCallerIdentityResponse>`,
        );
      assert.equal(req.hostname, "s3.eu-west-2.amazonaws.com");
      assert.equal(req.headers["x-amz-expected-bucket-owner"], context.accountId);
      const q = req.query || {};
      if ("location" in q) return response(200, xml("LocationConstraint", region));
      if ("publicAccessBlock" in q)
        return response(
          200,
          xml(
            "PublicAccessBlockConfiguration",
            ["BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets"]
              .map((k) => `<${k}>true</${k}>`)
              .join(""),
          ),
        );
      if ("ownershipControls" in q)
        return response(
          200,
          xml(
            "OwnershipControls",
            "<Rule><ObjectOwnership>BucketOwnerEnforced</ObjectOwnership></Rule>",
          ),
        );
      if ("versioning" in q)
        return response(200, xml("VersioningConfiguration", "<Status>Enabled</Status>"));
      if ("encryption" in q)
        return response(
          200,
          xml(
            "ServerSideEncryptionConfiguration",
            "<Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>AES256</SSEAlgorithm></ApplyServerSideEncryptionByDefault></Rule>",
          ),
        );
      if ("object-lock" in q)
        return response(
          200,
          xml(
            "ObjectLockConfiguration",
            "<ObjectLockEnabled>Enabled</ObjectLockEnabled><Rule><DefaultRetention><Mode>GOVERNANCE</Mode><Days>30</Days></DefaultRetention></Rule>",
          ),
        );
      if ("policy" in q)
        return response(200, JSON.stringify(invalidPolicy ? { Statement: [] } : resolvedPolicy), {
          "content-type": "application/json",
        });
      if ("list-type" in q) {
        assert.equal(q["max-keys"], "1");
        assert.ok(q.prefix.startsWith(context.prefix));
        if (failList) return response(failList, "<Error><Code>AccessDenied</Code></Error>");
        const found = [...objects.keys()]
          .filter((key) => key.startsWith(q.prefix))
          .sort()
          .slice(0, 1);
        return response(
          200,
          xml(
            "ListBucketResult",
            `<Prefix>${q.prefix}</Prefix><MaxKeys>1</MaxKeys><KeyCount>${found.length}</KeyCount><IsTruncated>false</IsTruncated>` +
              found.map((key) => `<Contents><Key>${key}</Key></Contents>`).join(""),
          ),
        );
      }
      const key = decodeURIComponent(req.path.slice(context.bucket.length + 2));
      assert.ok(key.startsWith(context.prefix));
      let record = objects.get(key);
      if (req.method === "PUT") {
        assert.equal(req.headers["if-none-match"], "*");
        assert.equal(req.headers["x-amz-server-side-encryption"], "AES256");
        assert.equal(req.headers["x-amz-sdk-checksum-algorithm"], "SHA256");
        if (record) return response(412, "<Error><Code>PreconditionFailed</Code></Error>");
        const chunks = [];
        if (req.body instanceof Uint8Array) chunks.push(req.body);
        else for await (const chunk of req.body) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        assert.equal(Number(req.headers["content-length"]), bytes.length);
        assert.equal(
          req.headers["x-amz-checksum-sha256"],
          Buffer.from(sha(bytes), "hex").toString("base64"),
        );
        record = { id: `v${++serial}`, bytes };
        objects.set(key, record);
        if (loss) {
          loss = false;
          throw Error("PRIVATE lost response");
        }
        return response(200, "", {
          "x-amz-version-id": record.id,
          "x-amz-server-side-encryption": "AES256",
          "x-amz-checksum-sha256": req.headers["x-amz-checksum-sha256"],
        });
      }

      if (!record) return response(404, "<Error><Code>NoSuchKey</Code></Error>");
      if ("versionId" in q) assert.equal(q.versionId, record.id, "Only exact stored version read");
      if (req.method === "HEAD") return response(200, "", headers(record));
      assert.equal(req.method, "GET");
      assert.equal(q.versionId, record.id);
      return response(
        200,
        corrupt ? Buffer.alloc(record.bytes.length, 1) : record.bytes,
        headers(record),
      );
    },
  };
  const transport = createRecordingS3(context, {
    credentials: async () => ({ accessKeyId: "SYNTHETIC", secretAccessKey: "SYNTHETIC" }),
    requestHandler: handler,
    now: () => clock,
  });
  const bytes = Buffer.from("RIFF-synthetic-SDK-wire-recording");
  const entry = {
    tenantId: tenant,
    objectId: "00000000-0000-4000-8000-000000000002",
    sourceKey: "PRIVATE/call.wav",
    sourceVersion: "v1",
    size: bytes.length,
    recordingIds: ["00000000-0000-4000-8000-000000000003"],
  };
  const source = {
    metadata: async () => structuredClone(entry),
    read: async () => Readable.from([bytes]),
  };
  return {
    ...transport,
    calls,
    objects,
    bytes,
    entry,
    source,
    now: () => clock,
    set loss(v) {
      loss = v;
    },
    set corrupt(v) {
      corrupt = v;
    },
    set region(v) {
      region = v;
    },
    set account(v) {
      account = v;
    },
    set clock(v) {
      clock = v;
    },
    set failList(v) {
      failList = v;
    },
    set nullVersion(v) {
      nullVersion = v;
    },
    set invalidPolicy(v) {
      invalidPolicy = v;
    },
  };
}
