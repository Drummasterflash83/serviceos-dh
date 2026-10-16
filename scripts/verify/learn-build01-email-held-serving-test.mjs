/** Exercise the exact downloaded serving-source patch with synthetic mailboxes. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { patchHeldSchedulerModule } from "./learn-build01-email-held-deployed-overlay.mjs";

const root = ".verification-results/build01-email-scheduler-test-source/supabase/functions/email-workspace-scheduled-sync";
const files = [
  ["_shared/workspace_scheduler_selection.ts", "functions/_shared/workspace_scheduler_selection.ts"],
  ["_shared/email_scheduler_health.ts", "functions/_shared/email_scheduler_health.ts"],
  ["email-workspace-scheduled-sync/index.ts", "index.ts"],
];
const code = files.map(([key, relative]) => patchHeldSchedulerModule(
  key, readFileSync(join(root, relative), "utf8"))
  .replace(/^import .*;\n/gm, "")
  .replace(/\bexport /g, "")
).join("\n");
const tenant = "test-tenant", blocked = "held-account", ready = "ready-account";
const records = {
  google_workspace_connections: [{ tenant_id: tenant }],
  email_accounts: [
    { id: blocked, tenant_id: tenant, email_address: "held@example.invalid", status: "active_dwd", provider: "gmail" },
    { id: ready, tenant_id: tenant, email_address: "ready@example.invalid", status: "active_dwd", provider: "gmail" },
  ],
  google_workspace_mailboxes: [
    { tenant_id: tenant, email_address: "held@example.invalid", status: "active",
      sync_enabled: true, mailbox_type: "user", directory_identity_conflict: false },
    { tenant_id: tenant, email_address: "ready@example.invalid", status: "active",
      sync_enabled: true, mailbox_type: "user", directory_identity_conflict: false },
  ],
  email_ingestion_checkpoints: [
    { tenant_id: tenant, email_account_id: blocked, stream: "recent", state: "blocked", block_code: "persistence_failed" },
  ],
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
        return Promise.resolve({ data: { completed_at: new Date().toISOString() }, error: null });
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
assert.equal(body.queued, 1);
assert.deepEqual(queued.map(item => item.payload?.email_account_id), [ready]);
assert.equal(inserted.length, 1);
assert.equal(inserted[0].row.status, "failed");
assert.equal(inserted[0].row.metadata.held_recovery, 1);
assert.equal(inserted[0].row.metadata.queued, 1);
console.log(JSON.stringify({ state: "serving_source_synthetic_pass", held: 1,
  eligibleQueued: 1, heartbeatShowsFailure: true, providerRequests: 0 }));
