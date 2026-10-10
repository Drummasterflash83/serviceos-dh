import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fixturePlan,
  setupSql,
  pauseSql,
  preservationSql,
  syntheticPorts,
  assertRecovered,
} from "./learn-test-email-recovery.mjs";

test("synthetic fixture creates no login or credential and every retirement write is tenant scoped", () => {
  const p = fixturePlan(),
    setup = setupSql(p),
    retired = pauseSql(p, true);
  assert.match(setup, /@example\.invalid/);
  assert.doesNotMatch(setup, /auth\.users|profiles|vault\.|oauth_tokens|grant /i);
  assert.doesNotMatch(retired, /\bdelete\b|\btruncate\b|\bdrop\b/i);
  for (const statement of retired.split(";").filter((s) => /update public\./.test(s))) {
    assert.ok(statement.includes(p.tenantId));
    assert.match(statement, /where (tenant_id|id)=/);
  }
  assert.throws(() => setupSql({ ...p, tenantId: "not-an-id" }));
  assert.throws(() => pauseSql({ ...p, accounts: [] }, true));
  const snapshot = preservationSql(p);
  assert.match(snapshot, /learn_email_transition_settlements/);
  assert.match(snapshot, /r\.id=s\.request_id and r\.tenant_id=/);
  assert.match(snapshot, /from public\.tenants s where s\.id is distinct from/);
});

test("provider fixture never calls the network and rejects an unrecognized provider route", async () => {
  const p = fixturePlan(),
    account = p.accounts[0],
    ports = syntheticPorts(p, account, {});
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error("Real provider fetch forbidden");
  };
  try {
    const profile = await (
      await ports.fetcher("https://gmail.googleapis.com/gmail/v1/users/me/profile")
    ).json();
    assert.equal(profile.emailAddress, account.id + "@example.invalid");
    const list = await (
      await ports.fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages")
    ).json();
    const full = await (
      await ports.fetcher(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + list.messages[0].id,
      )
    ).json();
    assert.equal(full.id, list.messages[0].id);
    await assert.rejects(ports.fetcher("https://other.invalid/profile"));
    await assert.rejects(ports.fetcher("https://gmail.googleapis.com/gmail/v1/users/me/unknown"));
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("recovery acceptance refuses pending writes, duplicate pages and fabricated fresh processing", () => {
  const p = fixturePlan();
  const e = {
    capture_allowed: false,
    messages: 3,
    threads: 3,
    pending: 0,
    profiles: 0,
    jobs: p.accounts.map((a) => ({
      status: "succeeded",
      attempt_count: 2,
      result: { ingestion: { historical_receipt: true, invocation_records_processed: 0 } },
    })),
    runs: p.accounts.map(() => ({ status: "success", records_processed: 1 })),
    accounts: p.accounts.map(() => ({ history_id: null })),
    checkpoints: p.accounts.map(() => ({
      state: "ready",
      stream: "recent",
      continuation: { labels_state: { INBOX: { next_page_token: "synthetic-saved-page" } } },
    })),
  };
  assertRecovered(e);
  for (const change of [
    { pending: 1 },
    { messages: 4 },
    { capture_allowed: true },
    { profiles: 1 },
  ])
    assert.throws(() => assertRecovered({ ...e, ...change }));
  const changed = structuredClone(e);
  changed.jobs[0].result.ingestion.invocation_records_processed = 1;
  assert.throws(() => assertRecovered(changed));
});
