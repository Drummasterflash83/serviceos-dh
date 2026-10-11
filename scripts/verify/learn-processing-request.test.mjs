import test from "node:test";
import assert from "node:assert/strict";
import { processingRequestHandler } from "../../supabase/functions/_shared/learn-processing-request.ts";
import {
  processingRequestReceipt,
  processingRequestMessage,
} from "../../src/lib/learn-processing-request.ts";
const tenant = "00000000-0000-4000-8000-000000000001",
  actor = "00000000-0000-4000-8000-000000000002",
  job = "00000000-0000-4000-8000-000000000003";
globalThis.Deno = { env: { get: () => undefined } };
function fixture(options = {}) {
  const writes = [],
    reads = [];
  let saved;
  const db = {
    auth: {
      getUser: async (token) =>
        token === "valid"
          ? { data: { user: { id: actor } }, error: null }
          : { data: null, error: {} },
    },
    from(table) {
      let mode = "read",
        filters = {};
      const query = {
        insert(row) {
          assert.equal(table, "platform_jobs");
          writes.push(row);
          saved = { id: job, ...row };
          mode = "insert";
          return query;
        },
        select() {
          return query;
        },
        eq(key, value) {
          filters[key] = value;
          return query;
        },
        in() {
          return query;
        },
        limit() {
          return query;
        },
        async single() {
          assert.equal(mode, "insert");
          if (options.throwWrite) throw Error("PRIVATE DATABASE ERROR");
          return options.duplicate
            ? { error: { code: "23505" }, data: null }
            : options.writeError
              ? { error: { code: "XX" }, data: null }
              : { data: { id: job }, error: null };
        },
        async maybeSingle() {
          reads.push({ table, filters });
          if (table === "profiles")
            return { data: { tenant_id: tenant, role: options.role ?? "owner" }, error: null };
          assert.equal(table, "platform_jobs");
          assert.equal(filters.tenant_id, tenant);
          if (!filters.id) return { data: options.lookupMissing ? null : { id: job }, error: null };
          return { data: { ...saved, ...options.row }, error: options.readError ? {} : null };
        },
      };
      return query;
    },
  };
  const handler = processingRequestHandler(options.kind ?? "interactions.sync", () =>
    options.noConfig ? null : db,
  );
  return {
    writes,
    reads,
    async call(body = {}, token = "valid", method = "POST") {
      const response = await handler(
        new Request("https://synthetic.invalid", {
          method,
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
          ...(method === "POST"
            ? { body: typeof body === "string" ? body : JSON.stringify(body) }
            : {}),
        }),
      );
      return {
        status: response.status,
        body: response.status === 204 ? null : await response.json(),
      };
    },
  };
}
test("manual projection saves a bounded tenant-bound queue request, never starts or publishes it", async () => {
  const f = fixture(),
    r = await f.call({ source: "email", limit: 3 });
  assert.equal(r.status, 202);
  assert.equal(r.body.status, "queued");
  assert.equal(r.body.accepted, true);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].payload, { limit: 3, source: "email" });
  assert.equal(f.writes[0].created_by, actor);
  assert.equal(f.writes[0].tenant_id, tenant);
  assert.equal(f.writes[0].status, "queued");
  assert.equal(processingRequestReceipt(r.body, "email")?.job_id, job);
  assert.match(processingRequestMessage(r.body), /waiting for processing/);
});
test("manual identity uses the same admission path without inline resolution", async () => {
  const f = fixture({ kind: "identity.resolve" }),
    r = await f.call();
  assert.equal(r.status, 202);
  assert.equal(r.body.source, "identity");
  assert.equal(f.writes[0].job_key, `identity.resolve:${tenant}`);
  assert.deepEqual(f.writes[0].payload, { limit: 20 });
});
test("duplicate active request returns its confirmed status without starting another handler", async () => {
  const f = fixture({ duplicate: true, row: { status: "retrying" } }),
    r = await f.call();
  assert.equal(r.status, 202);
  assert.equal(r.body.already_running, true);
  assert.match(processingRequestMessage(r.body), /another attempt/);
  assert.equal(f.writes.length, 1);
});
test("auth, viewer and foreign tenant requests cannot create jobs", async () => {
  for (const [opts, body, token, status] of [
    [{}, {}, "invalid", 401],
    [{ role: "viewer" }, {}, "valid", 403],
    [{}, { tenant_id: actor }, "valid", 403],
  ]) {
    const f = fixture(opts),
      r = await f.call(body, token);
    assert.equal(r.status, status);
    assert.equal(f.writes.length, 0);
  }
});
test("invalid JSON, options, source and bounds fail before admission", async () => {
  for (const body of [
    "{",
    [],
    null,
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
    { limit: "2" },
    { source: "slack" },
    { source: ["all"] },
    { since: "2020-01-01" },
    { job_type: "other" },
  ]) {
    const f = fixture();
    assert.equal((await f.call(body)).status, 400);
    assert.equal(f.writes.length, 0);
  }
});
test("lost admission or unavailable confirmation stays unconfirmed without raw errors", async () => {
  for (const opts of [
    { writeError: true },
    { throwWrite: true },
    { readError: true },
    { duplicate: true, lookupMissing: true },
    { row: { tenant_id: actor } },
    { row: { job_type: "other" } },
    { row: { payload: { source: "email" } } },
    { row: { status: "invented" } },
  ]) {
    const f = fixture(opts),
      r = await f.call();
    assert.equal(r.status, 503);
    assert.equal(r.body.success, false);
    assert.doesNotMatch(JSON.stringify(r.body), /PRIVATE/);
  }
});
test("method and missing configuration never admit work", async () => {
  const f = fixture();
  assert.equal((await f.call({}, "valid", "GET")).status, 405);
  assert.equal((await f.call({}, "valid", "OPTIONS")).status, 204);
  assert.equal(f.writes.length, 0);
  assert.equal((await fixture({ noConfig: true }).call()).status, 503);
});
test("browser rejects unversioned success, other source, malformed receipt and false completion", async () => {
  const r = (await fixture().call()).body;
  for (const change of [
    { version: undefined },
    { source: "phone" },
    { job_type: "identity.resolve" },
    { job_id: "invalid" },
    { success: false },
    { accepted: false },
    { checked_at: "never" },
    { status: "unknown" },
  ])
    assert.equal(processingRequestReceipt({ ...r, ...change }, "all"), null);
  assert.match(
    processingRequestMessage({ ...r, status: "succeeded" }),
    /Further batches may still be queued/,
  );
  assert.match(processingRequestMessage({ ...r, status: "dead_letter" }), /needs attention/);
});
