import test from "node:test";
import assert from "node:assert/strict";
import { readSlackEvidence } from "./learn-slack-evidence.ts";
const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-14T10:00:00Z"),
  signal = new AbortController().signal,
  args = { tenant: id(1), actor: id(2) };
const row = (n = 3) => ({
  id: id(n),
  interaction_id: id(10 + n),
  source_id: id(20 + n),
  source_version: "a".repeat(64),
  recorded_at: new Date(now).toISOString(),
  posted_at: "2022-04-07T15:57:01Z",
  channel_id: "CTEST",
  summary: "Saved request",
  excerpt: "A historical message",
  attribution: "unresolved",
});
const envelope = () => ({
  version: "learn-slack-evidence/1",
  tenant_id: id(1),
  actor_id: id(2),
  after: null,
  rows: [row()],
  next_after: null,
  scanned: 1,
  observed_at: new Date(now).toISOString(),
  operator_mode: false,
  audit_id: null as string | null,
});
const client = (p: any, error: any = null) => ({
  rpc: () => ({ abortSignal: async () => ({ data: p, error }) }),
});
test("one authorised bounded read binds tenant, actor, cursor and logged operator mode", async () => {
  const p = envelope();
  let calls = 0;
  const db = {
    rpc: (name: string, input: any) => {
      calls++;
      assert.equal(name, "learn_slack_evidence_read");
      assert.deepEqual(input, { p_tenant: id(1), p_after: null, p_operator_reason: null });
      return {
        abortSignal: async (s: AbortSignal) => {
          assert.equal(s, signal);
          return { data: p, error: null };
        },
      };
    },
  };
  assert.equal((await readSlackEvidence(db, args, signal, now)).rows.length, 1);
  assert.equal(calls, 1);
  p.operator_mode = true;
  p.audit_id = id(90);
  assert.equal(
    (
      await readSlackEvidence(
        client(p),
        { ...args, operatorReason: "Selected company review" },
        signal,
        now,
      )
    ).rows[0].attribution,
    "unresolved",
  );
  await assert.rejects(readSlackEvidence(client(p), args, signal, now));
  p.audit_id = null;
  await assert.rejects(
    readSlackEvidence(client(p), { ...args, operatorReason: "Review" }, signal, now),
  );
});
test("empty bounded scan with continuation is not misrepresented as complete or an error", async () => {
  const p: any = envelope();
  p.rows = [];
  p.scanned = 50;
  p.next_after = id(80);
  assert.equal((await readSlackEvidence(client(p), args, signal, now)).next_after, id(80));
  p.after = id(80);
  p.next_after = id(81);
  p.scanned = 1;
  p.rows = [row(81)];
  assert.equal(
    (await readSlackEvidence(client(p), { ...args, after: id(80) }, signal, now)).rows[0].id,
    id(81),
  );
  p.next_after = id(80);
  await assert.rejects(readSlackEvidence(client(p), { ...args, after: id(80) }, signal, now));
});
test("scope failures, stale pages, unbounded payloads and forged attribution fail closed", async () => {
  for (const change of [
    (p: any) => (p.tenant_id = id(90)),
    (p: any) => (p.actor_id = id(90)),
    (p: any) => (p.after = id(1)),
    (p: any) => p.rows.push(p.rows[0]),
    (p: any) => (p.rows[0].attribution = "customer_matched"),
    (p: any) => (p.rows[0].source_version = "old"),
    (p: any) => (p.rows[0].extra = "private"),
    (p: any) => (p.rows[0].excerpt = "😀".repeat(321)),
    (p: any) => (p.scanned = 51),
    (p: any) => (p.observed_at = "2026-10-14T09:58:59Z"),
    (p: any) => (p.observed_at = "2026-10-14T10:01:01Z"),
    (p: any) => (p.rows = Array.from({ length: 26 }, (_, n) => row(n + 3))),
    (p: any) => (p.scanned = 0),
  ]) {
    const p = envelope();
    change(p);
    await assert.rejects(readSlackEvidence(client(p), args, signal, now));
  }
  await assert.rejects(readSlackEvidence(client(null, { message: "denied" }), args, signal, now));
});
test("invalid input is refused before an RPC and source text remains plain Unicode data", async () => {
  let calls = 0;
  const db = {
    rpc: () => {
      calls++;
      throw Error("must not call");
    },
  };
  for (const bad of [
    { ...args, tenant: "foreign" },
    { ...args, after: "bad" },
    { ...args, operatorReason: "" },
  ])
    await assert.rejects(readSlackEvidence(db, bad, signal, now));
  assert.equal(calls, 0);
  const p = envelope();
  p.rows[0].excerpt = "😀 <script>untrusted()</script>";
  assert.equal(
    (await readSlackEvidence(client(p), args, signal, now)).rows[0].excerpt,
    p.rows[0].excerpt,
  );
});
