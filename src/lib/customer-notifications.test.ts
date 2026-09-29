import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientFeedbackStage, clientFeedbackStages } from "./client-feedback.ts";
import {
  customerBot,
  customerChannel,
  customerNotificationText,
} from "../../supabase/functions/_shared/customer-slack.ts";
import { OPENFOLK_TEAM } from "../../supabase/functions/_shared/notification-slack.ts";
const mock = (values: unknown[]) => (async () => Response.json(values.shift())) as typeof fetch;
test("client sees exactly three stages without falsely resolving published work", () => {
  assert.deepEqual(
    clientFeedbackStages.map((x) => x.label),
    ["Submitted", "In review", "Resolved"],
  );
  assert.equal(clientFeedbackStage("received"), "submitted");
  for (const s of ["reviewing", "approval", "approved", "verifying", "unknown"])
    assert.equal(clientFeedbackStage(s), "in_review");
  assert.equal(clientFeedbackStage("resolved"), "resolved");
});
test("client bot cannot use OpenFolk identity or a changed workspace", async () => {
  await assert.rejects(customerBot("xoxp-no", undefined, mock([])));
  await assert.rejects(
    customerBot(
      "xoxb-test",
      undefined,
      mock([{ ok: true, team_id: OPENFOLK_TEAM, bot_id: "B123" }]),
    ),
  );
  await assert.rejects(
    customerBot("xoxb-test", "T123", mock([{ ok: true, team_id: "T456", bot_id: "B123" }])),
  );
  assert.equal(
    (await customerBot("xoxb-test", "T123", mock([{ ok: true, team_id: "T123", bot_id: "B123" }])))
      .team_id,
    "T123",
  );
});
test("client channel must be internal, exact, and joined", async () => {
  const c = {
    id: "C123",
    name: "emma",
    is_member: true,
    is_shared: false,
    is_ext_shared: false,
    is_archived: false,
  };
  const auth = { ok: true, team_id: "T123", bot_id: "B123" };
  assert.deepEqual(
    await customerChannel("xoxb-test", "T123", "C123", mock([auth, { ok: true, channel: c }])),
    { id: "C123", name: "emma" },
  );
  for (const change of [
    { id: "COTHER" },
    { is_member: false },
    { is_shared: true },
    { is_archived: true },
  ])
    await assert.rejects(
      customerChannel(
        "xoxb-test",
        "T123",
        "C123",
        mock([auth, { ok: true, channel: { ...c, ...change } }]),
      ),
    );
});
test("notifications contain only safe status and client link, not arbitrary source content", () => {
  const job = {
    tenant_id: "tenant-a",
    client_stage: "in_review",
    event_key: "urgent",
    transcript: "PRIVATE CALL",
    proposal: "PRIVATE PROMPT",
    detail: "PRIVATE DIAGNOSIS",
  };
  const text = customerNotificationText(job);
  assert.match(text, /Urgent.*Emma feedback/);
  assert.match(text, /In review/);
  assert.match(text, /section=receptionist&view=improvements/);
  assert.doesNotMatch(text, /PRIVATE|\/openfolk\//);
});
test("separate dispatcher and endpoint never use the operator Slack secret", () => {
  for (const path of [
    "../../supabase/functions/customer-notifications/index.ts",
    "../../supabase/functions/_shared/customer-notification-dispatch.ts",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /notification_slack_token\"|operator_slack_connection|operator_notification_routes/,
    );
    assert.match(source, /customer_slack_token/);
  }
});
