/** Prepare an age-encrypted LIVE Edge credential package; never stage plaintext. */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, openSync, closeSync, unlinkSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { savedCliToken } from "../verify/learn-test-readiness.mjs";

const PROJECT = "tgbnakbxwcqjeimygroz";
const SOURCE_MANIFEST = "4008cc502a41f5948cfea8e2d06fa3be26ff4f4f7828839f707724b7c49f1488";
const AGE = "/private/tmp/serviceos-age-1.3.2/age";
const AGE_KEYGEN = "/private/tmp/serviceos-age-1.3.2/age-keygen";
const AGE_SHA256 = "4012dfc2725883beafb710894af4f599b7a94f8c8e0f51f02cc96ab8df33915e";
const NAMES = new Set([
  "GOOGLE_CLIENT_SECRET", "GOOGLE_WORKSPACE_PRIVATE_KEY",
  "LEARN_COMMUSOFT_WORKER_KEY", "LEARN_QUICKBOOKS_WORKER_KEY",
  "LEARN_SLACK_EVENTS_SIGNING_SECRET", "LEARN_SLACK_WORKER_KEY",
  "MARKETING_TRACKING_SECRET", "OPENAI_API_KEY", "OPENAI_EMMA_REVIEW_KEY",
  "OPENFOLK_CONTROLPLANE_KEY", "PHONE_OPERATIONS_WEBHOOK_SECRET",
  "RECEPTIONIST_SLACK_DRUMMONDS", "RECEPTIONIST_VAPI_DRUMMONDS",
  "RESEND_API_KEY", "SIMWOOD_PASSWORD", "SIMWOOD_USERNAME",
]);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function checkAge() {
  if (sha(readFileSync(AGE)) !== AGE_SHA256) throw Error("Pinned age binary changed");
}
function validateInput(values, digests) {
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw Error("Credential input shape invalid");
  const selectedNames = Object.keys(values).sort();
  if (selectedNames.length < 1 || selectedNames.length > NAMES.size ||
      selectedNames.some(name => !NAMES.has(name)))
    throw Error("Credential selection outside reviewed names");
  for (const name of selectedNames) {
    const item = values[name];
    if (!item || typeof item !== "object" ||
        typeof item.value !== "string" || item.value.length < 1 ||
        Buffer.byteLength(item.value) > 65536 ||
        typeof item.sourceRef !== "string" || item.sourceRef.length < 1 ||
        item.sourceRef.length > 300 ||
        !/^[a-f0-9]{64}$/.test(digests.get(name) ?? "") ||
        sha(item.value) !== digests.get(name))
      throw Error("Selected credential failed active-digest or shape check");
  }
  return selectedNames;
}
function encrypt(values, digests, recipient, output) {
  checkAge();
  if (!/^age1[0-9a-z]{58}$/.test(recipient)) throw Error("Recipient invalid");
  const selectedNames = validateInput(values, digests);
  const payload = {
    format: "serviceos-build01-edge-credential-package/1",
    project: PROJECT, sourceManifestSha256: SOURCE_MANIFEST,
    packedAtUtc: new Date().toISOString(), recipient,
    selected: Object.fromEntries(selectedNames.map(name => [name, {
      value: values[name].value,
      sourceRef: values[name].sourceRef,
      activeSha256: digests.get(name),
    }])),
  };
  const plain = Buffer.from(JSON.stringify(payload));
  let fd;
  try {
    fd = openSync(output, "wx", 0o600);
    const result = spawnSync(AGE,
      ["--encrypt", "--recipient", recipient, "--output", "-"],
      { input: plain, stdio: ["pipe", fd, "pipe"], timeout: 30000, maxBuffer: 32768 });
    if (result.status !== 0) throw Error("Pinned age encryption failed");
    closeSync(fd); fd = undefined;
    const meta = statSync(output);
    if (!meta.isFile() || (meta.mode & 0o077) !== 0 || meta.size < 100 || meta.size > 2 * 1024 * 1024)
      throw Error("Encrypted package shape invalid");
    return { bytes: meta.size, sha256: sha(readFileSync(output)), selectedCount: selectedNames.length };
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(output); } catch { /* output may not exist */ }
    throw error;
  } finally {
    plain.fill(0);
  }
}
async function activeDigests() {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/secrets`, {
    headers: { Authorization: `Bearer ${savedCliToken()}` },
    redirect: "error", signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`LIVE digest read failed (HTTP ${response.status})`);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length > 200 || rows.some(row =>
    typeof row.name !== "string" || !/^[a-f0-9]{64}$/.test(row.value ?? "")))
    throw Error("LIVE digest response changed");
  return new Map(rows.map(row => [row.name, row.value]));
}
async function readBoundedStdin() {
  const parts = [];
  let size = 0;
  for await (const part of process.stdin) {
    size += part.length;
    if (size > 1024 * 1024) throw Error("Credential input too large");
    parts.push(part);
  }
  if (size < 2) throw Error("Credential input missing");
  const buffer = Buffer.concat(parts);
  try { return JSON.parse(buffer.toString("utf8")); }
  finally { buffer.fill(0); for (const part of parts) part.fill(0); }
}
async function syntheticSelfTest() {
  checkAge();
  const generated = spawnSync(AGE_KEYGEN, [], { encoding: "utf8", timeout: 10000, maxBuffer: 32768 });
  if (generated.status !== 0) throw Error("Synthetic recipient generation failed");
  const identity = generated.stdout.match(/AGE-SECRET-KEY-[A-Z0-9]+/)?.[0];
  const recipient = generated.stderr.match(/age1[0-9a-z]{58}/)?.[0] ??
    generated.stdout.match(/age1[0-9a-z]{58}/)?.[0];
  if (!identity || !recipient) throw Error("Synthetic recipient shape invalid");
  const output = resolve(".verification-results", `synthetic-edge-credentials-${randomUUID()}.age`);
  const values = {
    LEARN_SLACK_EVENTS_SIGNING_SECRET: { value: "synthetic-signing-secret-never-live", sourceRef: "synthetic:test" },
    GOOGLE_WORKSPACE_PRIVATE_KEY: { value: "synthetic-private-key-never-live", sourceRef: "synthetic:test" },
  };
  const digests = new Map(Object.entries(values).map(([name, row]) => [name, sha(row.value)]));
  try {
    const prepared = encrypt(values, digests, recipient, output);
    const recovered = spawnSync(AGE, ["--decrypt", "--identity", "-", "--output", "-", output],
      { input: Buffer.from(identity + "\n"), encoding: null, timeout: 10000, maxBuffer: 1024 * 1024 });
    if (recovered.status !== 0) throw Error("Synthetic isolated decrypt failed");
    const parsed = JSON.parse(recovered.stdout.toString("utf8"));
    recovered.stdout.fill(0);
    if (parsed.format !== "serviceos-build01-edge-credential-package/1" ||
        parsed.project !== PROJECT || Object.keys(parsed.selected).length !== 2 ||
        Object.keys(values).some(name => parsed.selected[name]?.value !== values[name].value))
      throw Error("Synthetic package roundtrip differed");
    console.log(JSON.stringify({ state: "synthetic_encrypt_decrypt_verified",
      selectedCount: prepared.selectedCount, encryptedBytes: prepared.bytes,
      encryptedSha256: prepared.sha256, plaintextFileCreated: false,
      realCredentialRead: false, productionDataWrites: false }));
  } finally {
    try { unlinkSync(output); } catch { /* already removed */ }
  }
}
const mode = process.argv.slice(2).join(" ");
if (mode === "--synthetic-self-test") {
  await syntheticSelfTest();
} else if (mode === "--prepare-approved-live-copy") {
  const input = await readBoundedStdin();
  if (input?.project !== PROJECT || !input.selected) throw Error("Reviewed LIVE input binding missing");
  const publicRecipient = JSON.parse(readFileSync("infrastructure/database-backup/public-recipient.json", "utf8"));
  if (publicRecipient.project !== PROJECT || publicRecipient.format !== "age-x25519-recipient/1")
    throw Error("Reviewed recovery recipient changed");
  const digests = await activeDigests();
  const destination = resolve(".verification-results/build01-edge-secret-packages");
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const output = join(destination, `edge-credentials-${randomUUID()}.age`);
  const prepared = encrypt(input.selected, digests, publicRecipient.recipient, output);
  console.log(JSON.stringify({ state: "encrypted_package_prepared_locally",
    output, ...prepared, sourceManifestSha256: SOURCE_MANIFEST,
    realCredentialValuesReturned: false, productionDataWrites: false,
    offsiteCopyMade: false }));
} else {
  throw Error("Exact synthetic self-test or approved LIVE package mode required");
}
