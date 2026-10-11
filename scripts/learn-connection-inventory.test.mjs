import test from "node:test";
import assert from "node:assert/strict";
import { loadConnectionsAndEvidence } from "../supabase/functions/_shared/controlplane/connection_inventory.ts";
const tenant = "10000000-0000-4000-8000-000000000001";
const id = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n, values = {}) => ({ id: id(n), tenant_id: tenant, ...values });
const now = Date.parse("2026-10-11T00:00:00Z");
function database(records = {}, transform = (r) => r, cap = 137) {
  const calls = [];
  return {
    calls,
    from(table) {
      let rows = [...(records[table] ?? [])],
        columns = [],
        head = false,
        limit = Infinity,
        orders = [];
      const c = { table, head: false, filters: [] },
        q = {};
      q.select = (s, o) => {
        columns = s.split(",").map((s) => s.trim());
        head = o?.head === true;
        c.head = head;
        return q;
      };
      q.eq = (k, v) => {
        c.filters.push([k, v]);
        rows = rows.filter((r) => r[k] === v);
        return q;
      };
      q.in = (k, v) => {
        rows = rows.filter((r) => v.includes(r[k]));
        return q;
      };
      q.not = (k, op, v) => {
        assert.equal(op, "in");
        const vals = v.slice(1, -1).split(",");
        rows = rows.filter((r) => r[k] !== null && !vals.includes(r[k]));
        return q;
      };
      q.lte = (k, v) => {
        rows = rows.filter((r) => r[k] != null && Date.parse(r[k]) <= Date.parse(v));
        return q;
      };
      q.gt = (k, v) => {
        rows = rows.filter((r) => r[k] > v);
        return q;
      };
      q.order = (k, o) => {
        orders.push([k, o?.ascending !== false]);
        return q;
      };
      q.limit = (n) => {
        limit = n;
        return q;
      };
      q.then = (resolve, reject) => {
        calls.push(c);
        rows.sort((a, b) => {
          for (const [k, asc] of orders) {
            const diff = String(a[k]).localeCompare(String(b[k]));
            if (diff) return asc ? diff : -diff;
          }
          return 0;
        });
        return Promise.resolve(
          transform(
            {
              data: head
                ? null
                : rows
                    .slice(0, Math.min(limit, cap))
                    .map((r) => Object.fromEntries(columns.map((k) => [k, r[k]]))),
              count: rows.length,
              error: null,
            },
            c,
            calls,
          ),
        ).then(resolve, reject);
      };
      return q;
    },
  };
}
function fixture() {
  return {
    google_workspace_connections: [
      row(1, {
        domain: "example.invalid",
        status: "disabled",
        last_verified_at: "2026-09-01T00:00:00Z",
      }),
    ],
    provider_connections: [
      row(2, {
        provider: "sipcentric",
        status: "revoked",
        account_ref: "masked",
        configured_fields: ["api_key"],
        secret_refs: { api_key: "PRIVATE_SECRET_REFERENCE" },
        last_test: { ok: false, at: "2026-10-10T08:00:00Z", private: "PRIVATE_TEST_DETAIL" },
        revoked_at: "2026-10-10T09:00:00Z",
      }),
    ],
    google_workspace_mailboxes: [
      row(3, { email_address: "a@example.invalid", status: "active" }),
      row(4, { email_address: "outside@other.invalid", status: "active" }),
    ],
    telephony_inventory: [
      row(5, {
        provider: "sipcentric",
        provider_object_id: "opaque",
        canonical_type: "ddi",
        label: "Main",
        status: "active",
        discovery_source: "api",
      }),
    ],
    operating_profile_entries: [
      row(6, {
        scope_kind: "tenant",
        namespace: "controlplane",
        key: "email.approved_domains",
        value: { approved_domains: ["example.invalid"] },
      }),
    ],
    provider_connection_events: [
      row(7, {
        provider: "sipcentric",
        event: "discovery_completed",
        created_at: "2026-09-01T00:00:00Z",
      }),
      row(8, {
        provider: "sipcentric",
        event: "discovery_failed",
        created_at: "2026-10-01T00:00:00Z",
      }),
    ],
    phone_sync_runs: [
      row(9, {
        provider: "sipcentric",
        sync_type: "calls",
        status: "success",
        started_at: "2026-10-09T00:00:00Z",
        completed_at: "2026-10-09T01:00:00Z",
        records_processed: 12,
      }),
    ],
    email_sync_runs: [
      row(10, {
        provider: "google_workspace",
        sync_type: "workspace_discover",
        status: "success",
        started_at: "2026-10-09T00:00:00Z",
        completed_at: "2026-10-09T02:00:00Z",
        records_processed: 2,
      }),
    ],
  };
}
const run = (f) => loadConnectionsAndEvidence(database(f), tenant, now);
test("stored inventory cannot fabricate a default phone account or credential", async () => {
  const f = fixture();
  f.provider_connections = [row(99, { provider: "slack", status: "configured" })];
  const r = await run(f);
  assert.equal(r.connections.telephony.status, "not_configured");
  assert.equal(r.connections.telephony.account_ref, "");
  assert.equal(r.connections.telephony.underlying_provider, "");
  assert.equal(r.connections.telephony_accounts.length, 0);
  assert.equal(r.phoneEvidence.length, 1);
});
test("safe projection preserves revoked/disabled states and never returns secret references or test payloads", async () => {
  const r = await run(fixture());
  assert.equal(r.connections.google_workspace.status, "disabled");
  assert.equal(r.connections.google_workspace.imported, 1);
  assert.equal(r.connections.google_workspace.excluded, 1);
  assert.equal(r.connections.telephony.status, "revoked");
  assert.equal(r.connections.telephony.lifecycle.has_secrets, true);
  assert.equal(r.connections.telephony.lifecycle.last_test_status, "failed");
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_|secret_refs|private/);
});
test("each Phone provider keeps separate metadata, capabilities and evidence", async () => {
  const f = fixture();
  f.provider_connections.push(
    row(11, { provider: "simwood", status: "configured", account_ref: "second" }),
  );
  f.telephony_inventory.push(row(12, { provider: "simwood", canonical_type: "ddi" }));
  const r = await run(f);
  assert.equal(r.connections.telephony.status, "multiple_connections");
  assert.equal(r.connections.telephony_accounts.length, 2);
  assert.deepEqual(
    r.connections.telephony_accounts.map((p) => p.evidence_count),
    [1, 1],
  );
  assert.equal(r.connections.telephony_accounts[1].lifecycle.last_failed_discovery, null);
});
test("provider-scoped latest evidence is not displaced by 2503 newer unrelated events", async () => {
  const f = fixture();
  for (let n = 0; n < 2503; n++)
    f.provider_connection_events.push(
      row(100 + n, {
        provider: "other",
        event: "discovery_completed",
        created_at: "2026-10-10T00:00:00Z",
      }),
    );
  f.provider_connection_events.push(
    row(4000, {
      provider: "sipcentric",
      event: "discovery_completed",
      created_at: "2027-01-01T00:00:00Z",
    }),
  );
  const r = await run(f);
  assert.equal(r.connections.telephony.lifecycle.last_successful_discovery, "2026-09-01T00:00:00Z");
  assert.equal(r.connections.telephony.lifecycle.last_failed_discovery, "2026-10-01T00:00:00Z");
});
test("connection tests do not count as sync/discovery and latest completion is selected by completion time", async () => {
  const f = fixture();
  f.phone_sync_runs.push(
    row(11, {
      provider: "sipcentric",
      sync_type: "test_connection",
      status: "success",
      started_at: "2026-10-10T23:00:00Z",
      completed_at: "2026-10-10T23:01:00Z",
      records_processed: 0,
    }),
    row(12, {
      provider: "sipcentric",
      sync_type: "calls",
      status: "success",
      started_at: "2026-10-08T00:00:00Z",
      completed_at: "2026-10-10T01:00:00Z",
      records_processed: 5,
    }),
  );
  const r = await run(f);
  const l = r.connections.telephony.lifecycle;
  assert.equal(l.last_successful_sync, "2026-10-10T01:00:00Z");
  assert.equal(l.last_successful_discovery, "2026-09-01T00:00:00Z");
  assert.equal(l.discovery_counts.last_run_processed, 12);
  assert.equal(
    r.connections.google_workspace.lifecycle.last_successful_discovery,
    "2026-10-09T02:00:00Z",
  );
});
test("complete inventories survive lower caps and missing/duplicate domain boundaries cannot silently win", async () => {
  const f = fixture();
  f.google_workspace_mailboxes = Array.from({ length: 2503 }, (_, n) =>
    row(100 + n, { email_address: `p${n}@example.invalid`, status: "active" }),
  );
  f.telephony_inventory = Array.from({ length: 2503 }, (_, n) =>
    row(4000 + n, { provider: "sipcentric", canonical_type: "ddi" }),
  );
  const r = await run(f);
  assert.equal(r.connections.google_workspace.imported, 2503);
  assert.equal(r.phoneEvidence.length, 2503);
  f.operating_profile_entries = [];
  assert.equal((await run(f)).connections.google_workspace.imported, 0);
  f.operating_profile_entries = fixture().operating_profile_entries;
  f.operating_profile_entries.push({ ...f.operating_profile_entries[0], id: id(20) });
  await assert.rejects(run(f), /Ambiguous/);
});
test("failed, truncated or foreign inventories and evidence fail instead of returning healthy emptiness", async () => {
  for (const table of Object.keys(fixture()))
    await assert.rejects(
      loadConnectionsAndEvidence(
        database(fixture(), (r, c) =>
          c.table === table ? { ...r, error: { message: "offline" } } : r,
        ),
        tenant,
        now,
      ),
      /could not be read/,
    );
  for (const table of ["telephony_inventory", "phone_sync_runs"])
    await assert.rejects(
      loadConnectionsAndEvidence(
        database(fixture(), (r, c) =>
          c.table === table && !c.head
            ? { ...r, data: r.data.map((x) => ({ ...x, tenant_id: id(999) })) }
            : r,
        ),
        tenant,
        now,
      ),
    );
  await assert.rejects(
    loadConnectionsAndEvidence(
      database(fixture(), (r, c) =>
        c.table === "google_workspace_mailboxes" && !c.head ? { ...r, data: [] } : r,
      ),
      tenant,
      now,
    ),
  );
});
test("multiple Google domains expose combined state without assigning provider-wide tests to one arbitrary account", async () => {
  const f = fixture();
  f.google_workspace_connections.push(row(50, { domain: "other.invalid", status: "active" }));
  const r = await run(f);
  assert.equal(r.connections.google_workspace.status, "degraded");
  assert.equal(r.connections.google_workspace.lifecycle, undefined);
  assert.equal(r.connections.google_workspace.connections.length, 2);
});
