import assert from "node:assert/strict";
import test from "node:test";

import { validateCampaignDraft } from "./campaign-draft-validation.ts";

const complete = {
  name: "Annual service reminder",
  sender_id: "sender-1",
  segment_id: "segment-1",
  subject: "Time to book your service",
  body_authored: "Hello {{first_name}}, please book your service.",
};

test("accepts a complete draft whose sender and segment are still available", () => {
  assert.deepEqual(
    validateCampaignDraft(complete, { senderIds: ["sender-1"], segmentIds: ["segment-1"] }),
    {},
  );
});

test("explains every missing required field before a request is submitted", () => {
  assert.deepEqual(validateCampaignDraft({}), {
    name: "Enter a broadcast name.",
    sender_id: "Choose a sender.",
    segment_id: "Choose a saved segment.",
    subject: "Enter an email subject.",
    body_authored: "Write the email body.",
  });
});

test("detects stale sender and segment selections explicitly", () => {
  assert.deepEqual(
    validateCampaignDraft(complete, { senderIds: ["sender-2"], segmentIds: ["segment-2"] }),
    {
      sender_id: "That sender is no longer available. Choose a sender again.",
      segment_id: "That segment is no longer available. Choose a segment again.",
    },
  );
});
