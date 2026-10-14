import test from "node:test";
import assert from "node:assert/strict";
import { readSlackCardSource } from "./learn-slack-card-source.ts";
const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-14T02:00:00Z"),
  signal = new AbortController().signal;
const args = { tenant: id(1), actor: id(2), id: id(3) };
const envelope = () => ({
  version: "learn-slack-card-source/1",
  tenant_id: id(1),
  actor_id: id(2),
  id: id(3),
  operator_mode: false,
  audit_id: null as string | null,
  observed_at: new Date(now).toISOString(),
  record: {
    id: id(3),
    tenant_id: id(1),
    message_text: "A historical parts request",
    text_shortened: false,
    team_id: "TTEST",
    channel_id: "CTEST",
    posted_at: "2022-04-07T15:57:01.123456Z",
    provider_timestamp: "1649347021.123456",
    thread_timestamp: null as string | null,
    source_version: "a".repeat(64),
    retained_at: "2026-10-13T00:00:00Z",
    author_ref: "UTEST",
  },
});
const client = (p: any, error: any = null) => ({
  rpc: () => ({ abortSignal: async () => ({ data: p, error }) }),
});
test("an observation cannot open a different current source revision", async () => {
  const p = envelope();
  const scoped = { ...args, expectedSourceVersion: "a".repeat(64) };
  assert.equal(
    (await readSlackCardSource(client(p), scoped, signal, now)).record.source_version,
    scoped.expectedSourceVersion,
  );
  p.record.source_version = "b".repeat(64);
  await assert.rejects(readSlackCardSource(client(p), scoped, signal, now));
});
test("one bounded authenticated read binds tenant, actor, source and operator audit", async () => {
  const p = envelope();
  let calls = 0;
  const db = {
    rpc: (name: string, input: any) => {
      calls++;
      assert.equal(name, "learn_slack_card_source_read");
      assert.deepEqual(input, { p_tenant: args.tenant, p_id: args.id, p_operator_reason: null });
      return {
        abortSignal: async (s: AbortSignal) => {
          assert.equal(s, signal);
          return { data: p, error: null };
        },
      };
    },
  };
  assert.equal(
    (await readSlackCardSource(db, args, signal, now)).record.message_text,
    p.record.message_text,
  );
  assert.equal(calls, 1);
  p.operator_mode = true;
  p.audit_id = id(9);
  assert.equal(
    (
      await readSlackCardSource(
        client(p),
        { ...args, operatorReason: "Review selected client" },
        signal,
        now,
      )
    ).record.id,
    args.id,
  );
  await assert.rejects(readSlackCardSource(client(p), args, signal, now));
  p.audit_id = null;
  await assert.rejects(
    readSlackCardSource(
      client(p),
      { ...args, operatorReason: "Review selected client" },
      signal,
      now,
    ),
  );
});
test("full Unicode retained message is preserved without turning Slack markup into HTML", async () => {
  const p = envelope();
  p.record.message_text = "😀".repeat(39960) + "<script>alert(1)</script>";
  assert.equal(
    (await readSlackCardSource(client(p), args, signal, now)).record.message_text,
    p.record.message_text,
  );
  p.record.message_text = "😀".repeat(40000);
  p.record.text_shortened = true;
  assert.equal(
    Array.from((await readSlackCardSource(client(p), args, signal, now)).record.message_text)
      .length,
    40000,
  );
  p.record.message_text += "x";
  await assert.rejects(readSlackCardSource(client(p), args, signal, now));
});
test("foreign, stale, extra-field, invalid time and unbound source responses fail closed", async () => {
  for (const mutate of [
    (p: any) => (p.tenant_id = id(4)),
    (p: any) => (p.actor_id = id(4)),
    (p: any) => (p.id = id(4)),
    (p: any) => (p.raw_payload = {}),
    (p: any) => (p.record.tenant_id = id(4)),
    (p: any) => (p.record.id = id(4)),
    (p: any) => (p.record.provider_payload = {}),
    (p: any) => delete p.record.author_ref,
    (p: any) => (p.record.message_text = {}),
    (p: any) => (p.record.source_version = "bad"),
    (p: any) => (p.record.provider_timestamp = "123"),
    (p: any) => (p.record.posted_at = "2022-04-08T15:57:01Z"),
    (p: any) => (p.record.retained_at = "2022-01-01 12:00:00"),
    (p: any) => (p.record.thread_timestamp = "bad"),
    (p: any) => (p.record.text_shortened = true),
    (p: any) => (p.operator_mode = "false"),
    (p: any) => (p.audit_id = id(9)),
    (p: any) => (p.observed_at = new Date(now - 61000).toISOString()),
    (p: any) => (p.observed_at = new Date(now + 61000).toISOString()),
  ]) {
    const p = envelope();
    mutate(p);
    await assert.rejects(readSlackCardSource(client(p), args, signal, now));
  }
  await assert.rejects(readSlackCardSource(client(envelope(), {}), args, signal, now));
});
test("invalid scope makes no request", async () => {
  const db = {
    rpc: () => {
      throw Error("Should not request");
    },
  };
  for (const change of [
    { tenant: "bad" },
    { actor: "bad" },
    { id: "bad" },
    { operatorReason: "" },
    { operatorReason: "x".repeat(501) },
  ])
    await assert.rejects(
      readSlackCardSource(db as any, { ...args, ...change }, signal, now),
      /could not be verified/,
    );
});
