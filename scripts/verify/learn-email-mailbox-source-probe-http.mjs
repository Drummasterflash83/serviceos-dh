/** Hosted acceptance and one exact read-only LIVE provider proof. No raw IDs/keys/content printed. */
import assert from "node:assert/strict";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const LIVE_PROJECT = "tgbnakbxwcqjeimygroz";
const TENANT = "00000000-0000-0000-0000-000000000001";
const NAME = "learn-email-mailbox-source-probe";
const mode = process.argv.slice(2).join(" ");
const project = mode === "--test-negative" ? TEST_PROJECT :
  ["--live-negative", "--live-held-profile", "--live-held-profiles"].includes(mode) ? LIVE_PROJECT : null;
if (!project) throw Error("Explicit hosted TEST or LIVE diagnostic acceptance required");
const mgmtToken = savedCliToken();
async function management(path, body) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${mgmtToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw Error(`Management read unavailable (${response.status})`);
  return response.json();
}
const endpoint = (await management(`/functions/${NAME}`));
assert.equal(endpoint.slug, NAME);
assert.equal(endpoint.verify_jwt, true);
assert.equal(endpoint.status, "ACTIVE");
const keys = await management("/api-keys?reveal=true");
const service = keys.filter((item) => item.name === "service_role");
assert.equal(service.length, 1);
const key = service[0].api_key;
assert.equal(typeof key, "string");
assert.ok(key.length > 20);
if (key.split(".").length === 3) {
  const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url"));
  assert.equal(claims.ref, project);
  assert.equal(claims.role, "service_role");
  assert.ok(claims.exp * 1000 > Date.now());
} else assert.match(key, /^sb_secret_/);
const url = `https://${project}.supabase.co/functions/v1/${NAME}`;
async function invoke(method, body, variant) {
  const headers = { "Content-Type": "application/json" };
  if (variant !== "none") headers.Authorization = `Bearer ${key}`;
  if (variant === "full") {
    headers["x-serviceos-internal-key"] = key;
    headers["x-internal-tenant-id"] = TENANT;
  }
  const response = await fetch(url, { method, headers, body: body === null ? undefined :
    JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(30000) });
  const payload = await response.json().catch(() => null);
  if (response.status !== 401)
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  return { status: response.status, code: payload?.code ?? null, ok: payload?.ok ?? null };
}
if (mode !== "--live-held-profile" && mode !== "--live-held-profiles") {
  const checks = [
    ["missing_service", await invoke("POST", { account_id: crypto.randomUUID() }, "none"), 401, null],
    ["missing_internal", await invoke("POST", { account_id: crypto.randomUUID() }, "bearer"), 403, "forbidden"],
    ["invalid_body", await invoke("POST", {}, "full"), 400, "invalid_request"],
    ["not_held", await invoke("POST", { account_id: crypto.randomUUID() }, "full"), 409, "hold_changed"],
    ["method_guard", await invoke("GET", null, "full"), 405, "method_not_allowed"],
  ];
  for (const [name, actual, status, code] of checks) {
    assert.equal(actual.status, status, name);
    if (code !== null) assert.equal(actual.code, code, name);
  }
  console.log(JSON.stringify({ project, state: "negative_boundary_passed", checks: checks.map(([name]) => name),
    providerRequests: 0, customerContentReturned: false }));
} else {
  async function sql(query) {
    const rows = await management("/database/query/read-only", { query });
    assert.ok(Array.isArray(rows));
    return rows;
  }
  const held = await sql(`select c.email_account_id::text account_id,c.generation::text generation,
    c.revision::int revision from public.email_ingestion_checkpoints c
    where c.tenant_id='${TENANT}'::uuid and c.stream='recent' and c.state='blocked'
      and c.block_code='admin_delegation_missing' order by c.email_account_id limit 3`);
  const expected = mode === "--live-held-profile" ? 1 : 2;
  assert.equal(held.length, expected, `exactly ${expected} held mailbox(es) required`);
  const outcomes = [];
  for (const item of held) {
    assert.match(item.account_id, /^[a-f0-9-]{36}$/i);
    const startedAt = new Date().toISOString();
    const result = await invoke("POST", { account_id: item.account_id }, "full");
    const audit = await sql(`select action,status,detail->>'code' code,
      detail->>'checkpoint_revision' revision from public.audit_logs where tenant_id='${TENANT}'::uuid
      and resource_type='email_account' and resource_id='${item.account_id}'
      and action in ('learn.email.mailbox_source_probe','learn.email.mailbox_source_probe_result')
      and created_at>='${startedAt}'::timestamptz order by created_at,id`);
    const after = await sql(`select generation::text generation,revision::int revision,state,block_code
      from public.email_ingestion_checkpoints where tenant_id='${TENANT}'::uuid
      and email_account_id='${item.account_id}'::uuid and stream='recent'`);
    assert.equal(after.length, 1);
    assert.equal(after[0].generation, item.generation);
    assert.equal(after[0].revision, item.revision);
    assert.equal(after[0].state, "blocked");
    assert.equal(after[0].block_code, "admin_delegation_missing");
    if (result.code !== "probe_cooldown") {
      assert.equal(audit.filter((row) => row.action === "learn.email.mailbox_source_probe").length, 1);
      assert.equal(audit.filter((row) => row.action === "learn.email.mailbox_source_probe_result").length, 1);
      assert.equal(audit.at(-1).code, result.code);
    }
    outcomes.push({ result, checkpointRevision: item.revision,
      checkpointUnchanged: true, auditRows: audit.length });
  }
  console.log(JSON.stringify({ project, state: "held_mailbox_provider_checked",
    heldMailboxCount: outcomes.length, outcomes, customerContentReturned: false,
    sourceProviderWrites: 0 }));
}
