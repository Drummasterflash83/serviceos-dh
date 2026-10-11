import test from "node:test";
import assert from "node:assert/strict";
import { runVoicemailDiscoveryTick } from "./discovery-tick.ts";
const receipt = {
  state: "completed",
  historical_receipt: false,
  coverage_complete: false,
  observed_at: "2026-10-12T00:00:00Z",
  routes_attempted: 2,
  routes_failed: 0,
  pages: 10,
  rows_examined: 1000,
  jobs_enqueued: 8,
};
test("narrow worker runs do not invoke voicemail discovery; full and voicemail runs use existing SQL", async () => {
  let calls = 0;
  const db = {
    rpc: async (name: string, args: object) => {
      calls++;
      assert.equal(name, "voicemail_schedule_tick");
      assert.deepEqual(args, {});
      return { data: receipt, error: null };
    },
  };
  assert.equal((await runVoicemailDiscoveryTick(db, ["email.workspace_sync"])).state, "skipped");
  assert.equal(calls, 0);
  for (const kinds of [null, [], ["phone.voicemail_import"]])
    assert.equal((await runVoicemailDiscoveryTick(db, kinds)).state, "completed");
  assert.equal(calls, 3);
});
test("historical receipts keep their observation and false coverage; busy and idle do not invent capture", async () => {
  const reply = (data: any) =>
    runVoicemailDiscoveryTick({ rpc: async () => ({ data, error: null }) }, null);
  const old = await reply({ ...receipt, historical_receipt: true });
  assert.equal(old.historicalReceipt, true);
  assert.equal(old.observedAt, receipt.observed_at);
  assert.equal(old.coverageComplete, false);
  assert.equal(
    (await reply({ state: "busy", historical_receipt: false, coverage_complete: false })).state,
    "busy",
  );
  assert.equal(
    (
      await reply({
        ...receipt,
        state: "idle",
        routes_attempted: 0,
        pages: 0,
        rows_examined: 0,
        jobs_enqueued: 0,
      })
    ).state,
    "idle",
  );
  assert.equal(
    (await reply({ ...receipt, state: "attention", routes_failed: 1 })).state,
    "attention",
  );
});
test("uncertain or contradictory responses never become scheduled success and never leak exception content", async () => {
  for (const data of [
    null,
    { ...receipt, coverage_complete: true },
    { ...receipt, routes_attempted: 3 },
    { ...receipt, routes_failed: 1 },
    { ...receipt, pages: 11 },
    { ...receipt, rows_examined: -1 },
    { ...receipt, state: "attention" },
    { ...receipt, state: "idle" },
    { ...receipt, jobs_enqueued: 1001 },
    { ...receipt, historical_receipt: "yes" },
    { ...receipt, observed_at: "bad" },
  ]) {
    const r = await runVoicemailDiscoveryTick({ rpc: async () => ({ data, error: null }) }, null);
    assert.deepEqual(r, {
      state: "unconfirmed",
      historicalReceipt: false,
      coverageComplete: false,
    });
  }
  const r = await runVoicemailDiscoveryTick(
    {
      rpc: async () => {
        throw Error("private provider detail");
      },
    },
    null,
  );
  assert.equal(r.state, "unconfirmed");
  assert.equal(JSON.stringify(r).includes("private"), false);
});
