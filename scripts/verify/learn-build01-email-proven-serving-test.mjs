/** Exercise the exact downloaded serving-source patch with synthetic mailboxes. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { patchProvenSchedulerModule } from "./learn-build01-email-proven-deployed-overlay.mjs";

const root = ".verification-results/build01-email-proven-test-source/supabase/functions/email-workspace-scheduled-sync";
const files = [
  ["_shared/workspace_scheduler_selection.ts", "functions/_shared/workspace_scheduler_selection.ts"],
  ["_shared/email_scheduler_health.ts", "functions/_shared/email_scheduler_health.ts"],
  ["email-workspace-scheduled-sync/index.ts", "index.ts"],
];
const code = files.map(([key, relative]) => (key === "_shared/email_scheduler_health.ts"
  ? readFileSync(join(root, relative), "utf8")
  : patchProvenSchedulerModule(key, readFileSync(join(root, relative), "utf8")))
  .replace(/^import .*;\n/gm, "")
  .replace(/\bexport /g, "")
).join("\n");
const tenant = "test-tenant", blocked = "held-account", proven = "proven-account",
  ready = "ready-account";
const records = {
  google_workspace_connections: [{ tenant_id: tenant }],
  email_accounts: [
    { id: blocked, tenant_id: tenant, email_address: "held@example.invalid", status: "active_dwd", provider: "gmail" },
    { id: proven, tenant_id: tenant, email_address: "proven@example.invalid", status: "active_dwd", provider: "gmail" },
    { id: ready, tenant_id: tenant, email_address: "ready@example.invalid", status: "active_dwd", provider: "gmail" },
  ],
  google_workspace_mailboxes: [
    { tenant_id: tenant, email_address: "held@example.invalid", status: "active",
      sync_enabled: true, mailbox_type: "user", directory_identity_conflict: false },
    { tenant_id: tenant, email_address: "ready@example.invalid", status: "active",
      sync_enabled: true, mailbox_type: "user", directory_identity_conflict: false },
    { tenant_id: tenant, email_address: "proven@example.invalid", status: "active",
      sync_enabled: true, mailbox_type: "user", directory_identity_conflict: false },
  ],
  email_ingestion_checkpoints: [
    { tenant_id: tenant, email_account_id: blocked, stream: "recent", generation: "gen-1",
      revision: 7, state: "blocked", block_code: "persistence_failed" },
    { tenant_id: tenant, email_account_id: proven, stream: "recent", generation: "gen-2",
      revision: 9, state: "blocked", block_code: "admin_delegation_missing" },
  ],
  audit_logs: [{ tenant_id: tenant, resource_type: "email_account",
    resource_id: proven, action: "learn.email.mailbox_source_probe_result",
    status: "success", created_at: new Date().toISOString(),
    detail: { code: "provider_verified", checkpoint_generation: "gen-2",
      checkpoint_revision: 9, mailbox_content_read: false,
      request_audit_id: "synthetic-request" } }],
};
const inserted = [], queued = [];
const fakeClient = {
  from(table) {
    const filters = [];
    const query = {
      select() { return this; },
      neq(column, value) { filters.push(row => row[column] !== value); return this; },
      eq(column, value) { filters.push(row => row[column] === value); return this; },
      in(column, values) { filters.push(row => values.includes(row[column])); return this; },
      order() { return this; },
      limit() { return this; },
      range(start, end) { this.rangeValue = [start, end]; return this; },
      maybeSingle() {
        if (table === "email_sync_runs")
          return Promise.resolve({ data: { completed_at: new Date().toISOString() }, error: null });
        const rows = (records[table] ?? []).filter(row => filters.every(fn => fn(row)));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(resolve, reject) {
        const rows = (records[table] ?? []).filter(row => filters.every(fn => fn(row)));
        const [start, end] = this.rangeValue ?? [0, rows.length - 1];
        return Promise.resolve({ data: rows.slice(start, end + 1), error: null }).then(resolve, reject);
      },
    };
    return {
      ...query,
      insert(row) { inserted.push({ table, row }); return Promise.resolve({ error: null }); },
    };
  },
};
let handler;
const fakeDeno = {
  env: { get(key) {
    return ({ EMAIL_WORKSPACE_SCHEDULE_SECRET: "synthetic-secret",
      SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-key" })[key];
  } },
  serve(fn) { handler = fn; },
};
new Function("Deno", "createClient", "enqueueJob", code)(
  fakeDeno, () => fakeClient,
  async (_client, input) => { queued.push(input); return { id: `synthetic-${queued.length}` }; },
);
assert.equal(typeof handler, "function");
const response = await handler(new Request("https://example.invalid", {
  method: "POST", headers: { "x-schedule-secret": "synthetic-secret" },
}));
assert.equal(response.status, 200);
const body = await response.json();
assert.equal(body.success, true);
assert.equal(body.held_recovery, 1);
assert.equal(body.queued, 2);
assert.deepEqual(queued.map(item => item.payload?.email_account_id), [proven, ready]);
assert.equal(inserted.length, 1);
assert.equal(inserted[0].row.status, "failed");
assert.equal(inserted[0].row.metadata.held_recovery, 1);
assert.equal(inserted[0].row.metadata.queued, 2);
queued.length = 0;
inserted.length = 0;
records.audit_logs[0].status = "failed";
const denied = await handler(new Request("https://example.invalid", {
  method: "POST", headers: { "x-schedule-secret": "synthetic-secret" },
}));
assert.equal(denied.status, 200);
const deniedBody = await denied.json();
assert.equal(deniedBody.held_recovery, 2);
assert.deepEqual(queued.map(item => item.payload?.email_account_id), [ready]);
assert.equal(inserted[0].row.metadata.held_recovery, 2);
console.log(JSON.stringify({ state: "serving_source_synthetic_pass", held: 1,
  provenDelegationQueued: 1, ordinaryEligibleQueued: 1,
  laterFailedProofHeld: true, heartbeatShowsFailure: true, providerRequests: 0 }));
