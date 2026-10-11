import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function harness({ role = "owner", failTable, failInsert = false, mutate = () => {} } = {}) {
  let handler;
  const rows = {
    profiles: [{ id: id(2), tenant_id: id(1), role }],
    phone_calls: [
      {
        id: id(3),
        tenant_id: id(1),
        provider: "birchill",
        direction: "IN",
        started_at: "2026-10-11T12:00:00Z",
      },
    ],
    interactions: [
      {
        tenant_id: id(1),
        source_table: "phone_calls",
        source_id: id(3),
        summary: "Unrelated projected summary",
      },
    ],
    phone_ai_insights: [
      {
        id: id(4),
        tenant_id: id(1),
        call_id: id(3),
        recording_id: id(5),
        transcript_id: id(6),
        summary: "Original summary",
        identity_summary: { direction: "OUT" },
        created_at: "2026-10-11T12:00:00Z",
      },
    ],
    phone_transcripts: [
      {
        id: id(6),
        tenant_id: id(1),
        recording_id: id(5),
        transcript_text: "Original source",
        created_at: "2026-10-10",
      },
      {
        id: id(7),
        tenant_id: id(1),
        recording_id: id(5),
        transcript_text: "Newer unrelated source",
        created_at: "2026-10-11",
      },
    ],
    call_transcript_normalisations: [
      {
        id: id(8),
        tenant_id: id(1),
        transcript_id: id(6),
        normalised_text: "Old correction",
        created_at: "2026-10-10",
      },
      {
        id: id(9),
        tenant_id: id(1),
        transcript_id: id(6),
        normalised_text: "Current saved correction",
        created_at: "2026-10-11",
      },
      {
        id: id(10),
        tenant_id: id(1),
        transcript_id: id(7),
        normalised_text: "Other source correction",
        created_at: "2026-10-12",
      },
    ],
    audit_logs: [],
  };
  mutate(rows);
  const reads = [],
    writes = [];
  const db = {
    auth: {
      getUser: async (token) => ({
        data: { user: token === "user-token" ? { id: id(2) } : null },
        error: null,
      }),
    },
    from: (name) => {
      const filters = [],
        orders = [];
      let count = Infinity,
        inserted;
      const result = () => {
        if (inserted) {
          writes.push({ name, row: inserted });
          if (failInsert) return { data: null, error: { message: "private database error" } };
          rows[name].push({ id: id(20), created_at: "2026-10-11T13:00:00Z", ...inserted });
          return { data: null, error: null };
        }
        reads.push({ name, filters });
        if (failTable === name) return { data: null, error: { message: "private database error" } };
        const selected = rows[name].filter((r) =>
          filters.every(([k, allowed]) => allowed.includes(r[k])),
        );
        selected.sort((a, b) => {
          for (const k of orders) {
            const v = String(b[k]).localeCompare(String(a[k]));
            if (v) return v;
          }
          return 0;
        });
        return { data: selected.slice(0, count)[0] ?? null, error: null };
      };
      const q = {
        select: () => q,
        eq: (k, v) => {
          filters.push([k, [v]]);
          return q;
        },
        in: (k, v) => {
          filters.push([k, v]);
          return q;
        },
        order: (k) => {
          orders.push(k);
          return q;
        },
        limit: (n) => {
          count = n;
          return q;
        },
        insert: (row) => {
          inserted = row;
          return q;
        },
        maybeSingle: async () => result(),
        then: (yes, no) => Promise.resolve(result()).then(yes, no),
      };
      return q;
    },
  };
  const context = vm.createContext({
    Request,
    Response,
    TextDecoder,
    Uint8Array,
    Deno: {
      serve: (fn) => {
        handler = fn;
      },
      env: {
        get: (k) =>
          ({ SUPABASE_URL: "https://test.example", SUPABASE_SERVICE_ROLE_KEY: "service-token" })[k],
      },
    },
  });
  const cache = new Map();
  const root = process.env.PHONE_CALL_DETAIL_READBACK_ROOT;
  const entry = resolve(
    root ? root + "/index.ts" : "supabase/functions/phone-call-detail/index.ts",
  );
  async function load(file) {
    if (cache.has(file)) return cache.get(file);
    const mod = new vm.SourceTextModule(
      ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText,
      { context, identifier: file },
    );
    cache.set(file, mod);
    await mod.link((spec, parent) =>
      spec.startsWith("https://")
        ? new vm.SyntheticModule(
            ["createClient"],
            function () {
              this.setExport("createClient", () => db);
            },
            { context },
          )
        : load(
            resolve(
              dirname(parent.identifier),
              root && parent.identifier === entry && spec.startsWith("../_shared/")
                ? "functions/" + spec.slice(3)
                : spec,
            ),
          ),
    );
    return mod;
  }
  await (await load(entry)).evaluate();
  return {
    rows,
    reads,
    writes,
    run: (body = { call_id: id(3) }, headers = {}) =>
      handler(
        new Request("https://test.example/functions/v1/phone-call-detail", {
          method: "POST",
          headers: { Authorization: "Bearer user-token", ...headers },
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
      ),
  };
}
test("actual handler keeps raw and corrections bound to the insight source, not the newest transcript", async () => {
  const h = await harness(),
    r = await h.run(),
    p = await r.json();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(p.version, "phone-call-detail/2");
  assert.equal(p.transcript.raw, "Original source");
  assert.equal(p.transcript.normalised, "Current saved correction");
  assert.equal(p.provenance.transcript_id, id(6));
  assert.equal(p.provenance.freshness, "unverified");
  assert.equal(p.call.direction, "IN");
  assert.equal(p.call.connector, "birchill");
  assert.equal(h.writes.length, 0);
});
test("missing, wrong-recording and foreign-tenant source IDs never fall back to newer text or corrections", async () => {
  for (const mutate of [
    (r) => (r.phone_ai_insights[0].transcript_id = null),
    (r) => (r.phone_transcripts[0].recording_id = id(90)),
    (r) => (r.phone_transcripts[0].tenant_id = id(90)),
    (r) => r.phone_transcripts.shift(),
  ]) {
    const h = await harness({ mutate }),
      p = await (await h.run()).json();
    assert.equal(p.success, true);
    assert.deepEqual(p.transcript, { raw: null, normalised: null, corrections: [] });
    assert.equal(p.provenance.transcript_id, null);
    assert.ok(!h.reads.some((q) => q.name === "call_transcript_normalisations"));
  }
});
test("missing summary never borrows the interaction projection; absent analysis is explicit", async () => {
  const empty = await harness({ mutate: (r) => (r.phone_ai_insights[0].summary = null) });
  assert.equal((await (await empty.run()).json()).insight.summary, "");
  const missing = await harness({ mutate: (r) => (r.phone_ai_insights = []) });
  assert.equal((await (await missing.run()).json()).insight, null);
});
test("call must belong to the current tenant before reads or either review action", async () => {
  for (const action of ["detail", "mark_reviewed", "clear_review"]) {
    const h = await harness({ mutate: (r) => (r.phone_calls[0].tenant_id = id(90)) });
    assert.equal((await h.run({ action, call_id: id(3) })).status, 404);
    assert.equal(h.writes.length, 0);
    assert.deepEqual(
      h.reads.map((q) => q.name),
      ["profiles", "phone_calls"],
    );
  }
});
test("human auth rejects viewers, service credentials, internal headers and foreign tenant assertions", async () => {
  for (const [options, body, headers] of [
    [{ role: "viewer" }, undefined, {}],
    [{}, undefined, { Authorization: "Bearer service-token" }],
    [{}, undefined, { "x-internal-tenant-id": id(1) }],
    [{}, undefined, { "x-serviceos-internal-key": "service-token" }],
    [{}, { call_id: id(3), tenant_id: id(90) }, {}],
  ]) {
    const h = await harness(options),
      r = await h.run(body, headers);
    assert.ok([401, 403].includes(r.status));
    assert.equal(h.writes.length, 0);
    assert.ok(!h.reads.some((q) => q.name === "phone_calls"));
  }
});
test("database failures cannot masquerade as missing analysis or successful clearing", async () => {
  for (const failTable of [
    "phone_calls",
    "interactions",
    "phone_ai_insights",
    "phone_transcripts",
    "call_transcript_normalisations",
    "audit_logs",
  ]) {
    const h = await harness({ failTable }),
      r = await h.run();
    assert.equal(r.status, 503);
    assert.ok(!(await r.text()).includes("private database error"));
  }
  for (const action of ["mark_reviewed", "clear_review"]) {
    const h = await harness({ failInsert: true }),
      r = await h.run({ action, call_id: id(3) });
    assert.equal(r.status, 500);
    assert.equal((await r.json()).success, false);
  }
});
test("review remains a tenant-bound call-level human receipt", async () => {
  const h = await harness(),
    r = await h.run({ action: "mark_reviewed", call_id: id(3), note: "Checked" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).review.note, "Checked");
  assert.equal(h.writes[0].row.actor, id(2));
  assert.equal(h.writes[0].row.tenant_id, id(1));
  assert.equal(h.writes[0].row.resource_id, id(3));
  assert.equal((await h.run({ action: "clear_review", call_id: id(3) })).status, 200);
});
test("bounded request rejects malformed actions and never silently executes detail", async () => {
  for (const body of [
    "x".repeat(4097),
    "[]",
    "null",
    { call_id: "invalid" },
    { call_id: id(3), action: "delete" },
    { call_id: id(3), note: "x".repeat(501) },
    { call_id: id(3), extra: true },
  ]) {
    const h = await harness(),
      r = await h.run(body);
    assert.equal(r.status, 400);
    assert.equal(h.writes.length, 0);
    assert.ok(!h.reads.some((q) => q.name === "phone_calls"));
  }
});
