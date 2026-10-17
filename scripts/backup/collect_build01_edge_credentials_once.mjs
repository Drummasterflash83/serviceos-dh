/** One supervised inventory of the approved Build 01 Edge credentials.
 * Exact 1Password items only; values never enter arguments, files or logs.
 * Matching values are piped directly to the pinned age package stage.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const PROJECT = "tgbnakbxwcqjeimygroz";
const OP = "/private/tmp/serviceos-op-2.40.0/op";
const OP_SHA256 = "7dff93952c49d25133c8a2487ab7072e656368d4e7089f055f119bc8d1066ae2";
const REQUIRED = [
  "GOOGLE_CLIENT_SECRET", "GOOGLE_WORKSPACE_PRIVATE_KEY",
  "LEARN_QUICKBOOKS_WORKER_KEY", "LEARN_SLACK_EVENTS_SIGNING_SECRET",
  "OPENAI_API_KEY", "OPENFOLK_CONTROLPLANE_KEY",
  "PHONE_OPERATIONS_WEBHOOK_SECRET", "SIMWOOD_USERNAME", "SIMWOOD_PASSWORD",
];
const CHECK_ONLY = ["GOOGLE_CLIENT_ID", "GOOGLE_WORKSPACE_CLIENT_ID"];
const sha = value => createHash("sha256").update(value).digest("hex");
const need = (ok, code) => { if (!ok) throw Error(code); };
const env = { PATH: "/usr/bin:/bin", HOME: process.env.HOME,
  LANG: "en_US.UTF-8", ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}) };

async function digests() {
  const tokenModule = await import("../verify/learn-test-readiness.mjs");
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/secrets`, {
    headers: { Authorization: `Bearer ${tokenModule.savedCliToken()}` },
    redirect: "error", signal: AbortSignal.timeout(30000),
  });
  need(response.ok, "active_digest_read_unavailable");
  const rows = await response.json();
  need(Array.isArray(rows) && rows.length < 200, "active_digest_shape_changed");
  const result = new Map(rows.map(row => [row.name, row.value]));
  need([...REQUIRED, ...CHECK_ONLY].every(name => /^[a-f0-9]{64}$/.test(result.get(name) ?? "")),
    "reviewed_digest_missing");
  return result;
}

function item(binding, id, expectedTitle) {
  const result = spawnSync(OP, ["item", "get", id, "--account", binding.accountId,
    "--vault", binding.vaultId, "--format=json"], {
    env, encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  need(result.status === 0, "onepassword_read_unconfirmed");
  let value;
  try { value = JSON.parse(result.stdout); }
  catch { throw Error("onepassword_item_invalid"); }
  need(value?.id === id && value?.vault?.id === binding.vaultId &&
    value?.title === expectedTitle && Array.isArray(value.fields) &&
    new Set(value.fields.map(field => field.id)).size === value.fields.length,
  "onepassword_item_binding_changed");
  return value;
}

function candidates(value, sourceRef, depth = 0) {
  if (depth > 4) return [];
  if (typeof value === "string") {
    const found = [{ value, sourceRef }];
    if (value.length > 1 && value.length < 100000 && /^[\s]*[\[{]/.test(value)) {
      try { found.push(...candidates(JSON.parse(value), sourceRef, depth + 1)); }
      catch { /* Ordinary secret string, not a JSON container. */ }
    }
    return found;
  }
  if (Array.isArray(value)) return value.flatMap((entry, index) =>
    candidates(entry, `${sourceRef}[${index}]`, depth + 1));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, entry]) =>
    candidates(entry, `${sourceRef}.${key}`, depth + 1));
  return [];
}

async function main() {
  need(process.argv.slice(2).join(" ") === "--approved-one-time-copy",
    "approved_exact_mode_required");
  need(sha(readFileSync(OP)) === OP_SHA256, "onepassword_binary_pin_changed");
  const active = await digests();
  const binding = JSON.parse(readFileSync(
    ".verification-results/database-backup-onepassword-binding.json", "utf8"));
  need(binding.title === "Openfolk ServiceOS" &&
    /^[a-z0-9]{26}$/.test(binding.itemId ?? "") &&
    /^[a-z0-9]{26}$/.test(binding.vaultId ?? "") &&
    /^[A-Z0-9]{26}$/.test(binding.accountId ?? ""), "onepassword_binding_invalid");
  const collected = [];
  const service = item(binding, binding.itemId, "Openfolk ServiceOS");
  need(service.category === "SECURE_NOTE", "onepassword_note_changed");
  for (const field of service.fields) {
    if (typeof field?.id === "string" && typeof field?.value === "string")
      collected.push(...candidates(field.value, `1password:${binding.itemId}:${field.id}`));
  }
  const birchillsBinding = JSON.parse(readFileSync(".verification-results/birchills-item-binding.json", "utf8"));
  need(Array.isArray(birchillsBinding) && birchillsBinding.length === 1 &&
    birchillsBinding[0].vault === binding.vaultId &&
    birchillsBinding[0].title === "Birchills" &&
    /^[a-z0-9]{26}$/.test(birchillsBinding[0].id ?? ""),
  "birchills_binding_changed");
  const birchills = item(binding, birchillsBinding[0].id, "Birchills");
  for (const field of birchills.fields) {
    if (typeof field?.id === "string" && typeof field?.value === "string")
      collected.push(...candidates(field.value, `1password:${birchills.id}:${field.id}`));
  }
  const matched = {};
  const checkOnlyMatched = [];
  for (const name of [...REQUIRED, ...CHECK_ONLY]) {
    const hits = collected.filter(row => sha(row.value) === active.get(name));
    if (hits.length > 0 && new Set(hits.map(hit => hit.value)).size === 1) {
      if (REQUIRED.includes(name)) matched[name] = hits[0];
      else checkOnlyMatched.push(name);
    }
  }
  const missing = REQUIRED.filter(name => !matched[name]);
  need(Object.keys(matched).length > 0, "no_reviewed_credential_source_match");
  const input = Buffer.from(JSON.stringify({ project: PROJECT, selected: matched }));
  let stage;
  try {
    stage = spawnSync(process.execPath,
      ["scripts/backup/stage_build01_edge_secret_package.mjs", "--prepare-approved-live-copy"],
      { input, encoding: "utf8", timeout: 90000, maxBuffer: 32768,
        stdio: ["pipe", "pipe", "pipe"] });
  } finally { input.fill(0); }
  need(stage.status === 0, "reviewed_credential_encryption_unconfirmed");
  let result;
  try { result = JSON.parse(stage.stdout); }
  catch { throw Error("reviewed_package_receipt_invalid"); }
  need(result.state === "encrypted_package_prepared_locally" &&
    result.selectedCount === Object.keys(matched).length,
  "reviewed_package_receipt_mismatch");
  console.log(JSON.stringify({ state: missing.length
      ? "partial_reviewed_credentials_encrypted_locally"
      : "reviewed_credentials_encrypted_locally",
    selectedNames: Object.keys(matched).sort(), missingNames: missing,
    nonsecretIdentifiersMatched: checkOnlyMatched.sort(),
    encryptedBytes: result.bytes, encryptedSha256: result.sha256,
    encryptedPath: result.output, sourceManifestSha256: result.sourceManifestSha256,
    sourceItems: ["Openfolk ServiceOS", "Birchills"],
    plaintextFilesCreated: false, secretValuesPrinted: false,
    offsiteCopyMade: false, productionDataWrites: false }));
  if (missing.length) process.exitCode = 2;
}

main().catch(error => {
  const allowed = new Set(["approved_exact_mode_required", "onepassword_binary_pin_changed",
    "active_digest_read_unavailable", "active_digest_shape_changed", "reviewed_digest_missing",
    "onepassword_binding_invalid", "onepassword_read_unconfirmed", "onepassword_item_invalid",
    "onepassword_item_binding_changed", "onepassword_note_changed", "birchills_binding_changed",
    "no_reviewed_credential_source_match", "reviewed_credential_encryption_unconfirmed",
    "reviewed_package_receipt_invalid", "reviewed_package_receipt_mismatch"]);
  console.error(JSON.stringify({ state: "reviewed_credential_copy_not_prepared",
    code: allowed.has(error.message) ? error.message : "controlled_read_unconfirmed",
    secretValuesPrinted: false }));
  process.exitCode = 1;
});
