import test from "node:test";
import assert from "node:assert/strict";
import { readClientInformation } from "./openfolk-client-information.ts";
const id = (n: number) => `cf800000-aaaa-4000-8000-${String(n).padStart(12, "0")}`;
const args = {
  tenant: id(1),
  actor: id(10),
  collection: "companies" as const,
  reason: "Review client support",
};
const row = (n: number) => ({ id: id(n), fields: { name: `Company ${n}` }, truncated_fields: [] });
const page = () => ({
  version: "openfolk-client-information/1",
  tenant_id: args.tenant,
  actor_id: args.actor,
  collection: args.collection,
  after: null,
  record: null,
  rows: [row(101)],
  next_after: null,
  observed_at: new Date().toISOString(),
  audit_id: id(500),
});
const signal = () => new AbortController().signal;
const client = (data: unknown, error: unknown = null) => ({
  rpc: () => ({ abortSignal: async () => ({ data, error }) }),
});
test("reads bind the selected client and reason and forward cancellation", async () => {
  const s = signal();
  const p = await readClientInformation(
    {
      rpc(name, a) {
        assert.equal(name, "openfolk_client_information");
        assert.deepEqual(a, {
          p_tenant: id(1),
          p_collection: "companies",
          p_reason: args.reason,
          p_after: null,
          p_record: null,
        });
        return {
          abortSignal: async (supplied) => {
            assert.equal(supplied, s);
            return { data: page(), error: null };
          },
        };
      },
    },
    args,
    s,
  );
  assert.equal(p.rows[0].fields.name, "Company 101");
});
test("wrong company, actor, collection and unaudited responses fail closed", async () => {
  for (const patch of [
    { tenant_id: id(2) },
    { actor_id: id(11) },
    { collection: "emails" },
    { audit_id: null },
    { observed_at: "bad" },
    { observed_at: "2020-01-01T00:00:00Z" },
  ])
    await assert.rejects(readClientInformation(client({ ...page(), ...patch }), args, signal()));
});
test("strict page cursors reject missing, duplicated and backwards records", async () => {
  const rows = Array.from({ length: 25 }, (_, i) => row(101 + i));
  const p = await readClientInformation(
    client({ ...page(), rows, next_after: id(125) }),
    args,
    signal(),
  );
  assert.equal(p.next_after, id(125));
  for (const patch of [
    { rows: rows.slice(0, 24), next_after: id(124) },
    { rows: [row(101), row(101)] },
    { rows: [row(103), row(102)] },
    { rows, next_after: id(126) },
    { rows: [...rows, row(126)] },
  ])
    await assert.rejects(readClientInformation(client({ ...page(), ...patch }), args, signal()));
});
test("record details require the exact requested record and complete receipt", async () => {
  const a = { ...args, record: id(101) };
  const p = { ...page(), record: id(101) };
  assert.equal((await readClientInformation(client(p), a, signal())).rows.length, 1);
  for (const patch of [{ record: id(102) }, { rows: [] }, { rows: [row(102)] }])
    await assert.rejects(readClientInformation(client({ ...p, ...patch }), a, signal()));
});
test("invalid requests never call the server and errors do not disclose provider internals", async () => {
  for (const patch of [
    { tenant: "bad" },
    { actor: "bad" },
    { collection: "vault" },
    { reason: "" },
    { after: id(101), record: id(102) },
  ])
    await assert.rejects(
      readClientInformation(
        {
          rpc() {
            throw Error("Must not call");
          },
        },
        { ...args, ...patch } as typeof args,
        signal(),
      ),
      /could not be verified/,
    );
  await assert.rejects(
    readClientInformation(client(null, { message: "PRIVATE_BACKEND_DETAIL" }), args, signal()),
    (e) => !String(e).includes("PRIVATE_BACKEND_DETAIL"),
  );
});
