import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  OPENFOLK_TEAM,
  notificationEvent,
  safeSlackChannel,
  verifySlackBot,
  verifySlackChannel,
  sendSlackMessage,
  SlackRejected,
} from "../../supabase/functions/_shared/notification-slack.ts";
const channel = {
  id: "C123",
  name: "ai-emma",
  is_member: true,
  is_archived: false,
  is_shared: false,
  is_ext_shared: false,
};
const mock = (values: unknown[]) => (async () => Response.json(values.shift())) as typeof fetch;
test("notification classes keep urgent reports separate and reject unknown event sources", () => {
  assert.equal(notificationEvent("receptionist_feedback", "normal", true), "practice_feedback");
  assert.equal(notificationEvent("receptionist_feedback", "urgent", true), "urgent_feedback");
  assert.equal(notificationEvent("receptionist_feedback", "high", false), "receptionist_feedback");
  assert.equal(notificationEvent("programme_updated", "normal", false), "module_updates");
  assert.equal(notificationEvent("programme_note", "normal", false), "module_feedback");
  assert.equal(notificationEvent("anything", "normal", false), null);
});
test("channel picker fails closed for shared, archived, DM, unknown or non-member channels", () => {
  assert.equal(safeSlackChannel(channel), true);
  for (const patch of [
    { is_shared: true },
    { is_ext_shared: true },
    { is_org_shared: true },
    { is_pending_ext_shared: true },
    { is_archived: true },
    { is_member: false },
    { is_member: undefined },
    { is_im: true },
    { id: "D123" },
  ])
    assert.equal(safeSlackChannel({ ...channel, ...patch }), false);
});
test("only OpenFolk bot identities are accepted", async () => {
  assert.equal(
    (
      await verifySlackBot(
        "xoxb-synthetic",
        mock([{ ok: true, team_id: OPENFOLK_TEAM, bot_id: "B123", team: "OpenFolk" }]),
      )
    ).team_id,
    OPENFOLK_TEAM,
  );
  await assert.rejects(verifySlackBot("xoxp-synthetic", mock([])));
  await assert.rejects(
    verifySlackBot("xoxb-synthetic", mock([{ ok: true, team_id: "OTHER", bot_id: "B123" }])),
  );
  await assert.rejects(
    verifySlackBot("xoxb-synthetic", mock([{ ok: true, team_id: OPENFOLK_TEAM }])),
  );
});
test("each send verifies workspace and exact channel with no outside URL", async () => {
  const calls: string[] = [];
  const fetcher = (async (url: string | URL | Request, init: RequestInit) => {
    calls.push(String(url));
    assert.equal(init.redirect, "error");
    return Response.json(
      calls.length === 1
        ? { ok: true, team_id: OPENFOLK_TEAM, bot_id: "B123" }
        : { ok: true, channel },
    );
  }) as typeof fetch;
  assert.deepEqual(await verifySlackChannel("xoxb-synthetic", "C123", fetcher), {
    id: "C123",
    name: "ai-emma",
  });
  assert.deepEqual(calls, [
    "https://slack.com/api/auth.test",
    "https://slack.com/api/conversations.info",
  ]);
  await assert.rejects(
    verifySlackChannel(
      "xoxb-synthetic",
      "COTHER",
      mock([
        { ok: true, team_id: OPENFOLK_TEAM, bot_id: "B123" },
        { ok: true, channel },
      ]),
    ),
  );
});
test("message success requires an exact channel and timestamp receipt", async () => {
  const receipt = await sendSlackMessage("xoxb-synthetic", "C123", "Test only", "ref", (async (
    _url: unknown,
    init: RequestInit,
  ) => {
    const body = JSON.parse(String(init.body));
    assert.equal(body.parse, "none");
    assert.equal(body.unfurl_links, false);
    assert.equal(body.client_msg_id, "ref");
    return Response.json({ ok: true, channel: "C123", ts: "123.000001" });
  }) as typeof fetch);
  assert.deepEqual(receipt, { channel: "C123", ts: "123.000001" });
  await assert.rejects(
    sendSlackMessage(
      "xoxb-synthetic",
      "C123",
      "Test",
      "ref",
      mock([{ ok: true, channel: "COTHER", ts: "123.000001" }]),
    ),
  );
  await assert.rejects(
    sendSlackMessage(
      "xoxb-synthetic",
      "C123",
      "Test",
      "ref",
      mock([{ ok: true, channel: "C123" }]),
    ),
  );
});
test("definite Slack refusal differs from an ambiguous network failure", async () => {
  await assert.rejects(
    sendSlackMessage(
      "xoxb-synthetic",
      "C123",
      "Test",
      "ref",
      mock([{ ok: false, error: "not_in_channel" }]),
    ),
    SlackRejected,
  );
  try {
    await sendSlackMessage("xoxb-synthetic", "C123", "Test", "ref", (async () => {
      throw Error("timeout");
    }) as typeof fetch);
    assert.fail();
  } catch (e) {
    assert.equal(e instanceof SlackRejected, false);
  }
});
test("notification administration is server-gated and no credential is returned", () => {
  const edge = readFileSync(
    new URL("../../supabase/functions/operator-notifications/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(edge, /auth\.getUser/);
  assert.match(edge, /platform.controlplane.admin/);
  assert.match(edge, /chris@openfolk.ai/);
  assert.match(edge, /notification_require_actor/);
  assert.ok(edge.indexOf("auth.getUser") < edge.indexOf("req.text"));
  assert.doesNotMatch(edge, /console\.(log|error)|reply\([^\n]*botToken/);
  const worker = readFileSync(
    new URL("../../supabase/functions/client-notifications/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(worker, /notification_route: route/);
  assert.match(worker, /slack_phase: "posting"/);
  assert.match(worker, /uncertain \? "uncertain"/);
  assert.ok(
    worker.indexOf('slack_phase: "posting"') < worker.indexOf("receipt = await sendSlackMessage"),
  );
});
