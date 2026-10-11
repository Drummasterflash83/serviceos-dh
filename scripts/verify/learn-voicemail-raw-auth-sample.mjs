/** One original Gmail notification, cryptographically checked locally. Read-only. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { savedCliToken } from "./learn-test-readiness.mjs";
import { getDelegatedToken } from "../../supabase/functions/_shared/google_workspace.ts";
const retry = process.argv.includes("--retry-after-local-fix");
if (
  process.argv.slice(2).join(" ") !==
  "--read-only-production-and-google" + (retry ? " --retry-after-local-fix" : "")
)
  throw Error("Explicit read-only scope required");
const project = "tgbnakbxwcqjeimygroz",
  tenant = "00000000-0000-0000-0000-000000000001";
const samples = JSON.parse(
  readFileSync(".verification-results/voicemail-gmail-sample-private.json"),
);
if (samples.length !== 3) throw Error("Verified three-message sample required");
const sample = samples[0];
if (!/^[a-f0-9]{1,64}$/i.test(sample.gmailId)) throw Error("Unexpected provider ID");
const key = JSON.parse(
  readFileSync("/Users/chrisdrummond/Downloads/ServiceOS Workspace Connector.json", "utf8"),
);
const q = (v) => "'" + String(v).replaceAll("'", "''") + "'";
async function bounded(r, max) {
  if (!r.ok) throw Error("Read unavailable HTTP " + r.status);
  const chunks = [];
  let bytes = 0;
  for await (const c of r.body) {
    bytes += c.byteLength;
    if (bytes > max) throw Error("Response bound exceeded");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
const scope = await bounded(
  await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `select c.domain,c.service_account_email,c.service_account_client_id from google_workspace_connections c join email_accounts a on a.tenant_id=c.tenant_id join email_messages m on m.tenant_id=a.tenant_id where c.tenant_id=${q(tenant)} and c.status='active' and a.id=${q(sample.accountId)} and a.status='active_dwd' and a.email_address=${q(sample.mailbox)} and m.id=${q(sample.sourceId)} and m.provider_message_id=${q(sample.gmailId)} and lower(split_part(a.email_address,'@',2))=lower(c.domain)`,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  }),
  65536,
);
const matches = scope.filter(
  (c) =>
    c.service_account_email === key.client_email &&
    String(c.service_account_client_id) === key.client_id,
);
if (matches.length !== 1) throw Error("Scope no longer matches");

const stem = ".verification-results/voicemail-raw-auth-sample" + (retry ? "-v2" : "");
writeFileSync(
  stem + "-journal.json",
  JSON.stringify({
    startedAt: new Date().toISOString(),
    project,
    tenant,
    sourceId: sample.sourceId,
    maxRawMessageRequests: 1,
    maxRawBytes: 1048576,
    storageUploads: 0,
  }),
  { flag: "wx", mode: 0o600 },
);
const delegated = await getDelegatedToken(
  {
    clientEmail: key.client_email,
    privateKey: key.private_key,
    subject: sample.mailbox,
    domain: matches[0].domain,
  },
  ["https://www.googleapis.com/auth/gmail.readonly"],
);
const url = new URL(
  `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(sample.gmailId)}`,
);
url.searchParams.set("format", "raw");
url.searchParams.set("fields", "id,raw,internalDate");
const data = await bounded(
  await fetch(url, {
    headers: { Authorization: `Bearer ${delegated.accessToken}` },
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  }),
  1500000,
);
if (
  data.id !== sample.gmailId ||
  typeof data.raw !== "string" ||
  !/^[A-Za-z0-9_-]+={0,2}$/.test(data.raw)
)
  throw Error("Raw source identity differs");
const bytes = Buffer.from(data.raw, "base64url");
if (bytes.length > 1048576) throw Error("Raw byte bound exceeded");
let report;
try {
  let verified;
  try {
    verified = JSON.parse(
      execFileSync(process.execPath, ["scripts/verify/learn-voicemail-dkim-probe.mjs"], {
        input: bytes,
        encoding: "utf8",
        env: {},
        timeout: 30000,
        maxBuffer: 65536,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
  } catch (e) {
    writeFileSync(stem + "-failure-private.txt", String(e.stderr ?? "Child failure"), {
      flag: "wx",
      mode: 0o600,
    });
    throw Error("Isolated signature verifier failed; private child output withheld");
  }
  report = {
    state: "single_original_message_signature_checked",
    observedAt: new Date().toISOString(),
    projectRef: project,
    tenantId: tenant,
    sourceFingerprint: createHash("sha256").update(`${tenant}:${sample.sourceId}`).digest("hex"),
    rawBytes: bytes.length,
    rawSha256: createHash("sha256").update(bytes).digest("hex"),
    verification: verified,
    tokenRequests: 1,
    rawMessageRequests: 1,
    productionWrites: 0,
    storageUploads: 0,
    accessChanges: 0,
    credentialUploads: 0,
    rawPersisted: false,
  };
} finally {
  bytes.fill(0);
  data.raw = null;
}
writeFileSync(stem + "-result.json", JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(JSON.stringify(report, null, 2));
