/** Two synthetic private TEST objects only. No accounts, routes, grants or providers. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { readVoicemailCatalog, voicemailInstalledSnapshot } from "./learn-voicemail-catalog.mjs";
if (
  process.argv.slice(2).join(" ") !== "--synthetic-storage --existing-cli-login" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit synthetic TEST storage scope required");
const token = savedCliToken(),
  schema = await readVoicemailCatalog(token);
if (schema.fingerprint !== "f22d6c92600ca36b82360239594d4286")
  throw Error("Exact installed TEST 073 required");
const tenant = "ce730001-aaaa-4000-8000-000000000001",
  mailbox = "ce730001-aaaa-4000-8000-000000000002",
  intake = "ce730001-aaaa-4000-8000-000000000003",
  source = "ce730001-aaaa-4000-8000-000000000004";
const paths = [
  { bucket: "receptionist-voicemails", path: `${tenant}/${mailbox}/${intake}`, mime: "audio/mpeg" },
  {
    bucket: "learn-voicemail-sources",
    path: `${tenant}/${intake}/${source}.eml`,
    mime: "message/rfc822",
  },
];
const where = paths.map((p) => `(bucket_id='${p.bucket}' and name='${p.path}')`).join(" or ");
const inventory = `select bucket_id,name,metadata->>'size' as bytes from storage.objects where ${where} order by bucket_id,name`;
if ((await communicationQuery(token, inventory)).length)
  throw Error("Synthetic object paths already exist; inspect, do not overwrite");
const rows = await communicationQuery(
  token,
  `select (select count(*) from public.tenants where id='${tenant}')::int as tenants,(select count(*) from public.receptionist_voicemail_email_routes)::int as routes`,
);
if (rows[0]?.tenants !== 0 || rows[0]?.routes !== 0)
  throw Error("Absent synthetic tenant and disabled capture required");
const snapshot = voicemailInstalledSnapshot(schema.catalog.phone).replace(
  "from storage.objects s",
  `from storage.objects s where not (${where})`,
);
if (!snapshot.includes("where not ("))
  throw Error("Exact synthetic preservation exclusion missing");
const before = await communicationQuery(token, snapshot);
if (before.length !== 134) throw Error("Full preservation snapshot required");
const fixture = JSON.parse(
  execFileSync(process.execPath, ["scripts/verify/voicemail-auth/edge-fixture.mjs"], {
    encoding: "utf8",
    maxBuffer: 2000000,
  }),
);
// Synthetic MIME extraction uses exactly the same verified implementation.
const { extractSignedVoicemail } = await import("./voicemail-auth/signed-voicemail.mjs");
const raw = Buffer.from(fixture.raw);
const extracted = await extractSignedVoicemail(raw, {
  internalDate: "1791705600000",
  expectedMailbox: "synthetic@example.invalid",
  resolver: async (name, type) => {
    if (name !== fixture.dnsName || type !== "TXT") throw Error("Unexpected fixture DNS");
    return [[fixture.keyRecord]];
  },
});
const hash = (b) => createHash("sha256").update(b).digest("hex");
const bytes = [extracted.audio, raw];
const stem = ".verification-results/voicemail-storage-http";
const fd = openSync(stem + "-journal.json", "wx", 0o600);
try {
  writeSync(
    fd,
    JSON.stringify(
      {
        projectRef: TEST_PROJECT,
        startedAt: new Date().toISOString(),
        objects: paths.map((p, i) => ({ ...p, bytes: bytes[i].length, sha256: hash(bytes[i]) })),
        before,
      },
      null,
      2,
    ),
  );
  fsyncSync(fd);
} finally {
  closeSync(fd);
}
const keysResponse = await fetch(
  `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
  {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  },
);
if (!keysResponse.ok) throw Error("TEST credentials unavailable");
const keys = await keysResponse.json();
function key(name) {
  const found = keys.filter((k) => k.name === name);
  if (found.length !== 1) throw Error("Unique TEST key required");
  const v = found[0].api_key,
    c = JSON.parse(Buffer.from(v.split(".")[1], "base64url"));
  if (c.ref !== TEST_PROJECT || c.role !== name) throw Error("Credential target differs");
  return v;
}
const origin = `https://${TEST_PROJECT}.supabase.co`,
  options = {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, init) =>
        fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30000) }),
    },
  };
const admin = createClient(origin, key("service_role"), options),
  anon = createClient(origin, key("anon"), options);
const checks = [];
let failure = null;
try {
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    const upload = await admin.storage
      .from(p.bucket)
      .upload(p.path, bytes[i], { upsert: false, contentType: p.mime });
    // A lost upload reply is resolved by readback, never another upload.
    const downloaded = await admin.storage.from(p.bucket).download(p.path);
    if (downloaded.error || !downloaded.data) throw Error("Stored byte readback unconfirmed");
    const actual = new Uint8Array(await downloaded.data.arrayBuffer());
    const exact = actual.length === bytes[i].length && hash(actual) === hash(bytes[i]);
    actual.fill(0);
    if (!exact) throw Error("Stored byte mismatch");
    const denied = await anon.storage.from(p.bucket).download(p.path);
    const denialStatus = Number(denied.error?.statusCode ?? denied.error?.status);
    if (denied.data || !denied.error || ![400, 401, 403, 404].includes(denialStatus))
      throw Error("Anonymous storage denial unconfirmed");
    const publicResult = await fetch(`${origin}/storage/v1/object/public/${p.bucket}/${p.path}`, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    await publicResult.body?.cancel();
    if (![400, 401, 403, 404].includes(publicResult.status))
      throw Error("Public storage denial unconfirmed");
    checks.push({
      bucket: p.bucket,
      bytes: bytes[i].length,
      sha256: hash(bytes[i]),
      immutableUploadAcknowledged: !upload.error,
      readbackMatches: true,
      anonymousStatus: denialStatus,
      publicStatus: publicResult.status,
    });
  }
} catch (e) {
  failure = e.message;
} finally {
  raw.fill(0);
  extracted.audio.fill(0);
}
const after = await communicationQuery(token, snapshot),
  afterSchema = await readVoicemailCatalog(token),
  objects = await communicationQuery(token, inventory);
const stable = (r) => JSON.stringify([...r].sort((a, b) => a.name.localeCompare(b.name)));
const preserved =
  stable(before) === stable(after) && afterSchema.fingerprint === schema.fingerprint;
const report = {
  state:
    !failure && checks.length === 2 && objects.length === 2 && preserved
      ? "hosted_private_storage_verified"
      : "requires_inspection",
  observedAt: new Date().toISOString(),
  projectRef: TEST_PROJECT,
  checks,
  failure,
  preservedDatasets: preserved ? 134 : null,
  syntheticObjectsRetained: objects.length,
  syntheticPrefix: tenant,
  providerRequests: 0,
  usersCreated: 0,
  routesCreated: 0,
  voicemailRowsCreated: 0,
  productionChanged: false,
  limitations: [
    "Synthetic byte transport only; not a published voicemail, signed-in playback, provider coverage or independent backup acceptance.",
  ],
};
writeFileSync(stem + "-result.json", JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(JSON.stringify(report, null, 2));
if (report.state !== "hosted_private_storage_verified") process.exitCode = 1;
