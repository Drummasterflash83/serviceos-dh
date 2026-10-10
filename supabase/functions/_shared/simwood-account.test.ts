import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSimwoodAccount,
  boundSimwoodRecordingUrl,
  simwoodRecordingCustomer,
} from "./simwood-account.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  tenant = id(1);
const row = (customer = "3950", n = 2) => ({
  id: id(n),
  tenant_id: tenant,
  tenant_connector_id: id(3),
  account_key: customer,
  customer,
  status: "active",
  connector: {
    id: id(3),
    tenant_id: tenant,
    connector_id: "simwood",
    provider: "simwood",
    status: "active",
    enabled: true,
  },
});
function db(rows: any[], count = rows.length, error: any = null) {
  const filters: any[] = [];
  const q: any = {
    select: (c: string, options: any) => {
      assert.equal(options.count, "exact");
      assert.ok(!c.includes("secret"));
      return q;
    },
    eq: (...args: any[]) => {
      filters.push(args);
      return q;
    },
    limit: async (n: number) => {
      assert.equal(n, 101);
      return { data: rows, count, error };
    },
  };
  return {
    from: (t: string) => {
      assert.equal(t, "connector_accounts");
      return q;
    },
    filters,
  };
}
test("unique registered account is selected without provider discovery and explicit matching account is accepted", async () => {
  for (const supplied of [undefined, null, "", "3950", " 3950 "]) {
    const d = db([row()]),
      r = await resolveSimwoodAccount(d, tenant, supplied);
    assert.deepEqual(r, { ok: true, customerId: "3950", accountId: id(2), connectorId: id(3) });
    assert.ok(d.filters.some(([k, v]) => k === "tenant_id" && v === tenant));
    assert.ok(d.filters.some(([k, v]) => k === "connector.tenant_id" && v === tenant));
  }
});
test("foreign, missing, inactive, ambiguous and malformed accounts cannot use shared credentials", async () => {
  for (const rows of [
    [],
    [{ ...row(), tenant_id: id(9) }],
    [{ ...row(), connector: { ...row().connector, tenant_id: id(9) } }],
    [{ ...row(), status: "disabled" }],
    [{ ...row(), connector: { ...row().connector, enabled: false } }],
    [{ ...row(), connector: { ...row().connector, status: "revoked" } }],
    [row(), row("8000", 4)],
    [row(), row("3950", 4)],
    [{ ...row(), customer: "bad/path" }],
    [{ ...row(), tenant_connector_id: id(9) }],
  ])
    assert.equal((await resolveSimwoodAccount(db(rows), tenant)).ok, false);
  assert.equal((await resolveSimwoodAccount(db([row()]), tenant, "8000")).ok, false);
  assert.equal((await resolveSimwoodAccount(db([row()]), tenant, 8000)).ok, false);
});
test("multiple company accounts require an explicit registered choice; legacy account-key fallback remains", async () => {
  assert.equal((await resolveSimwoodAccount(db([row(), row("8000", 4)]), tenant, "8000")).ok, true);
  assert.equal((await resolveSimwoodAccount(db([{ ...row(), customer: null }]), tenant)).ok, true);
  assert.equal(
    (
      await resolveSimwoodAccount(
        db([{ ...row(), connector: { ...row().connector, status: "error" } }]),
        tenant,
      )
    ).ok,
    true,
  );
});
test("truncated, failed and duplicate registry reads refuse rather than choose first", async () => {
  for (const d of [
    db([row()], 2),
    db([row()], null as any),
    db([row()], 1, { code: "error" }),
    db([row(), row()]),
    {
      from: () => {
        throw Error("private error");
      },
    },
  ]) {
    const r = await resolveSimwoodAccount(d, tenant);
    assert.equal(r.ok, false);
    assert.ok(!JSON.stringify(r).includes("private error"));
  }
});
test("recording URLs bind exact company and recording, upgrade matching HTTP and refuse redirects targets or suffixes", () => {
  const path = "/api/v1/customers/3950/recordings/recording_1",
    canonical = "https://pbx.sipcentric.com" + path;
  for (const raw of [null, undefined, "", path, canonical, "http://pbx.sipcentric.com" + path])
    assert.equal(boundSimwoodRecordingUrl("3950", "recording_1", raw), canonical);
  for (const raw of [
    "https://evil.test" + path,
    "https://pbx.sipcentric.com:8443" + path,
    "https://user@pbx.sipcentric.com" + path,
    canonical + "?token=private",
    canonical + "#private",
    canonical + "/download",
    canonical.replace("/3950/", "/8000/"),
    canonical.replace("recording_1", "recording_2"),
  ])
    assert.equal(boundSimwoodRecordingUrl("3950", "recording_1", raw), null);
  assert.equal(simwoodRecordingCustomer("recording_1", canonical), "3950");
  assert.equal(boundSimwoodRecordingUrl("3950", "../recording_1", null), null);
});
