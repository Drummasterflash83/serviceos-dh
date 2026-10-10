import test from "node:test";
import assert from "node:assert/strict";
import { readCardSource, CARD_SOURCE_FIELDS } from "./learn-card-sources.ts";
import { loadPerformanceEvidence } from "./learn-performance-evidence.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function envelope(table: keyof typeof CARD_SOURCE_FIELDS) {
  return {
    version: "learn-card-source/1",
    tenant_id: id(1),
    table,
    id: id(2),
    record: {
      id: id(2),
      tenant_id: id(1),
      ...Object.fromEntries(CARD_SOURCE_FIELDS[table].map((k) => [k, null])),
    } as Record<string, any>,
  };
}
const client = (data: any, error: any = null) => ({
  rpc: async () => ({ data, error }),
  from: () => {
    throw Error("Raw-source fallback is forbidden");
  },
});
test("original email, call and recording reads use one bounded RPC and retain Unicode excerpts", async () => {
  for (const table of Object.keys(CARD_SOURCE_FIELDS) as (keyof typeof CARD_SOURCE_FIELDS)[]) {
    const e = envelope(table);
    let called = 0;
    if (table === "email_messages") e.record.snippet = "😀".repeat(4000) + "… [excerpt shortened]";
    if (table === "phone_calls")
      Object.assign(e.record, { duration_seconds: 120, started_at: "2026-10-10T00:00:00Z" });
    const c = {
      ...client(e),
      rpc: async (name: string, args: any) => {
        called++;
        assert.equal(name, "learn_card_source_read");
        assert.deepEqual(args, { p_tenant: id(1), p_table: table, p_id: id(2) });
        return { data: e, error: null };
      },
    };
    const raw = await readCardSource(c, id(1), table, id(2));
    assert.deepEqual(raw, e.record);
    const fields = await loadPerformanceEvidence(c, id(1), { table, id: id(2) });
    if (table === "email_messages") assert.equal(fields[0].value, e.record.snippet);
    assert.equal(called, 2);
  }
});
test("denied, absent, foreign, oversized and extra-field responses fail without raw-table fallback", async () => {
  const e = envelope("email_messages");
  for (const change of [
    { version: "wrong" },
    { tenant_id: id(8) },
    { table: "phone_calls" },
    { id: id(8) },
    { record: null },
    { raw_payload: {} },
    { record: { ...e.record, id: id(8) } },
    { record: { ...e.record, tenant_id: id(8) } },
    { record: { ...e.record, body_html: "hidden" } },
    { record: { ...e.record, snippet: "a".repeat(4101) } },
    { record: { ...e.record, sent_at: "invalid" } },
    { record: { ...e.record, direction: { value: "IN" } } },
  ])
    await assert.rejects(
      loadPerformanceEvidence(client({ ...e, ...change }), id(1), {
        table: "email_messages",
        id: id(2),
      }),
    );
  const missing = envelope("email_messages");
  delete missing.record.snippet;
  await assert.rejects(
    readCardSource(client(missing), id(1), "email_messages", id(2)),
    /field validation/,
  );
  await assert.rejects(
    readCardSource(client(e, { code: "42501" }), id(1), "email_messages", id(2)),
  );
  for (const table of ["profiles", "email_accounts", "__proto__"])
    await assert.rejects(readCardSource(client(e), id(1), table, id(2)), /Unsupported/);
  for (const duration of [-1, Infinity, "120"]) {
    const call = envelope("phone_calls");
    call.record.duration_seconds = duration;
    await assert.rejects(readCardSource(client(call), id(1), "phone_calls", id(2)), /duration/);
  }
  await assert.rejects(
    loadPerformanceEvidence(
      {
        from: () => {
          throw Error("Unexpected raw read");
        },
      },
      id(1),
      { table: "email_messages", id: id(2) },
    ),
    /signed-in/,
  );
});
test("performance interaction evidence uses the existing restricted communication reader", async () => {
  const c = {
    ...client(null),
    rpc: async (name: string, args: any) => {
      assert.equal(name, "learn_card_communications_read");
      assert.deepEqual(args.p_ids, [id(2)]);
      return {
        data: {
          version: "learn-card-communications/1",
          tenant_id: id(1),
          rows: [
            {
              id: id(2),
              tenant_id: id(1),
              subject: "Synthetic email",
              summary: "Retained summary",
              body_preview: "Source excerpt",
              occurred_at: "2026-10-10T00:00:00Z",
              source_connector_id: "gmail",
            },
          ],
        },
        error: null,
      };
    },
  };
  const fields = await loadPerformanceEvidence(c, id(1), { table: "interactions", id: id(2) });
  assert.deepEqual(
    fields.map((f) => f.label),
    ["subject", "summary", "body preview", "occurred at", "source connector id"],
  );
  const denied = client({ version: "learn-card-communications/1", tenant_id: id(1), rows: [] });
  await assert.rejects(
    loadPerformanceEvidence(denied, id(1), { table: "interactions", id: id(2) }),
    /unavailable/,
  );
});
