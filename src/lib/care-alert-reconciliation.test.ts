import test from "node:test";
import assert from "node:assert/strict";
import {
  deliverCareAlert,
  reconcileCareDelivery,
  type CareAlert,
} from "../../supabase/functions/_shared/care-alert-delivery.ts";

const reference = "12345678-1234-1234-1234-123456789abc";
const alert: CareAlert = {
  id: "alert",
  tenant_id: "tenant",
  issue_id: "issue",
  kind: "attention",
  reason: "event",
  lease_id: "lease",
  team_id: "TOPENFOLK",
  channel_id: "CEMMA",
  client_msg_id: reference,
};
const created_at = "2026-09-28T08:00:00.000Z";
const now = Date.parse("2026-09-28T09:00:00.000Z");
const ts = `${Date.parse("2026-09-28T08:30:00.000Z") / 1000}.000123`;
const receiptMessage = {
  type: "message",
  user: "UEMMABOT",
  bot_id: "BEMMABOT",
  team: "TOPENFOLK",
  client_msg_id: reference,
  ts,
};
function harness(
  options: {
    pages?: unknown[];
    post?: () => Response | Promise<Response>;
    auth?: Record<string, unknown>;
    channel?: Record<string, unknown>;
  } = {},
) {
  const requests: { url: URL; method: string }[] = [];
  let page = 0;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push({ url, method: init?.method ?? "GET" });
    if (url.pathname.endsWith("auth.test"))
      return Response.json({
        ok: true,
        team_id: "TOPENFOLK",
        user_id: "UEMMABOT",
        bot_id: "BEMMABOT",
        ...options.auth,
      });
    if (url.pathname.endsWith("conversations.info"))
      return Response.json({
        ok: true,
        channel: { id: "CEMMA", name: "ai-emma", is_member: true, ...options.channel },
      });
    if (url.pathname.endsWith("chat.postMessage"))
      return options.post?.() ?? Response.json({ ok: true, channel: "CEMMA", ts });
    if (url.pathname.endsWith("conversations.history"))
      return Response.json(options.pages?.[page++] ?? { ok: true, messages: [] });
    throw Error("Unexpected network path");
  }) as typeof fetch;
  return { fetcher, requests };
}
function reconcile(h: ReturnType<typeof harness>, maxPages = 3) {
  return reconcileCareDelivery(
    { ...alert, created_at },
    { token: "private-test-token", allowedTeam: "TOPENFOLK", fetcher: h.fetcher, now, maxPages },
  );
}
async function deliver(post: () => Response | Promise<Response>, ack = async () => {}) {
  const h = harness({ post });
  const failures: { error: string; uncertain: boolean }[] = [];
  const result = await deliverCareAlert(alert, {
    token: "private-test-token",
    allowedTeam: "TOPENFOLK",
    fetcher: h.fetcher,
    currentRoute: async () => ({ team_id: "TOPENFOLK", channel_id: "CEMMA", enabled: true }),
    issue: async () => ({
      title: "Review the greeting",
      stage: "received",
      priority: "normal",
      company: "Test company",
    }),
    ack,
    fail: async (error, uncertain) => {
      failures.push({ error, uncertain });
    },
  });
  return { result, failures };
}
for (const [label, post] of [
  ["HTTP rate limit", () => new Response("", { status: 429 })],
  ["HTTP authorisation refusal", () => new Response("", { status: 403 })],
  [
    "explicit Slack channel rejection",
    () => Response.json({ ok: false, error: "channel_not_found" }),
  ],
  ["explicit Slack rate limit", () => Response.json({ ok: false, error: "ratelimited" })],
] as const) {
  test(`${label} permits bounded retry rather than stranding an unknown receipt`, async () => {
    const output = await deliver(post);
    assert.deepEqual(output.result, { delivered: false, uncertain: false });
    assert.deepEqual(output.failures, [{ error: "slack_delivery_failed", uncertain: false }]);
  });
}
for (const [label, post] of [
  ["HTTP server failure", () => new Response("", { status: 503 })],
  ["provider internal error", () => Response.json({ ok: false, error: "internal_error" })],
  [
    "network timeout",
    () => {
      throw Error("customer-name / sensitive error");
    },
  ],
  ["malformed acknowledgement", () => new Response("not json")],
] as const) {
  test(`${label} remains unknown and never silently resends`, async () => {
    const output = await deliver(post);
    assert.deepEqual(output.result, { delivered: false, uncertain: true });
    assert.equal(output.failures[0].uncertain, true);
    assert.doesNotMatch(output.failures[0].error, /customer-name|sensitive/);
  });
}
test("a lost database acknowledgement keeps a confirmed provider send unknown locally", async () => {
  const output = await deliver(
    () => Response.json({ ok: true, channel: "CEMMA", ts }),
    async () => {
      throw Error("worker_store_unavailable");
    },
  );
  assert.deepEqual(output.result, { delivered: false, uncertain: true });
});
test("reconciliation follows cursors and returns only a matching provider receipt", async () => {
  const h = harness({
    pages: [
      { ok: true, messages: [], has_more: true, response_metadata: { next_cursor: "next-page" } },
      { ok: true, messages: [receiptMessage] },
    ],
  });
  assert.deepEqual(await reconcile(h), { channel: "CEMMA", ts });
  const pages = h.requests.filter((r) => r.url.pathname.endsWith("conversations.history"));
  assert.equal(pages.length, 2);
  assert.equal(pages[1].url.searchParams.get("cursor"), "next-page");
  assert.equal(pages[0].url.searchParams.get("oldest"), pages[1].url.searchParams.get("oldest"));
  assert.equal(pages[0].url.searchParams.get("latest"), pages[1].url.searchParams.get("latest"));
  assert.equal(pages[0].url.searchParams.get("channel"), "CEMMA");
  assert.equal(pages[0].url.searchParams.get("inclusive"), "true");
  assert.equal(pages[0].method, "GET");
  assert.ok(h.requests.every((r) => !r.url.pathname.endsWith("chat.postMessage")));
});
test("missing history receipt is not a failed-delivery claim or a resend", async () => {
  const h = harness({ pages: [{ ok: true, messages: [] }] });
  assert.equal(await reconcile(h), null);
  assert.ok(h.requests.every((r) => !r.url.pathname.endsWith("chat.postMessage")));
});
test("page budget exhaustion leaves delivery unknown", async () => {
  const h = harness({
    pages: [{ ok: true, messages: [], response_metadata: { next_cursor: "more" } }],
  });
  assert.equal(await reconcile(h, 1), null);
  assert.equal(
    h.requests.filter((r) => r.url.pathname.endsWith("conversations.history")).length,
    1,
  );
});
test("a copied message ID from another actor is not a receipt", async () => {
  const h = harness({
    pages: [{ ok: true, messages: [{ ...receiptMessage, user: "UOTHER", bot_id: "BOTHER" }] }],
  });
  assert.equal(await reconcile(h), null);
});
test("another message from the correct bot is not a receipt", async () => {
  const h = harness({
    pages: [{ ok: true, messages: [{ ...receiptMessage, client_msg_id: "different-reference" }] }],
  });
  assert.equal(await reconcile(h), null);
});
test("the destination must remain inside the configured OpenFolk workspace", async () => {
  const h = harness();
  await assert.rejects(
    reconcileCareDelivery(
      { ...alert, team_id: "TCLIENT", created_at },
      { token: "private-test-token", allowedTeam: "TOPENFOLK", fetcher: h.fetcher, now },
    ),
    /destination_unapproved/,
  );
  assert.equal(h.requests.length, 0);
});
for (const channel of [{ id: "COTHER" }, { is_ext_shared: true }, { is_member: false }]) {
  test(`unverified reconciliation channel is refused: ${JSON.stringify(channel)}`, async () => {
    const h = harness({ channel });
    await assert.rejects(reconcile(h), /channel_not_available/);
    assert.equal(
      h.requests.filter((r) => r.url.pathname.endsWith("conversations.history")).length,
      0,
    );
  });
}
test("history access failure never produces a delivery receipt", async () => {
  const h = harness({ pages: [{ ok: false, error: "missing_scope" }] });
  await assert.rejects(reconcile(h), /verification_failed/);
});
test("repeated cursors fail closed instead of looping", async () => {
  const page = { ok: true, messages: [], response_metadata: { next_cursor: "loop" } };
  const h = harness({ pages: [page, page] });
  await assert.rejects(reconcile(h), /receipt_invalid/);
  assert.equal(
    h.requests.filter((r) => r.url.pathname.endsWith("conversations.history")).length,
    2,
  );
});
test("matching receipts outside the fixed observation interval are refused", async () => {
  const h = harness({
    pages: [{ ok: true, messages: [{ ...receiptMessage, ts: "9999999999.000123" }] }],
  });
  await assert.rejects(reconcile(h), /receipt_invalid/);
});
test("invalid observation boundary is refused before reading any Slack content", async () => {
  const h = harness();
  await assert.rejects(
    reconcileCareDelivery(
      { ...alert, created_at: "not-a-date" },
      { token: "private-test-token", allowedTeam: "TOPENFOLK", fetcher: h.fetcher, now },
    ),
    /receipt_invalid/,
  );
  assert.equal(h.requests.length, 0);
});
