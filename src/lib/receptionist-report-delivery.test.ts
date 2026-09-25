import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../../supabase/functions/client-notifications/index.ts", import.meta.url),
  "utf8",
);

test("practice reports are scoped before any transcript enters OpenFolk Slack", () => {
  assert.match(source, /practiceCallMatches\(call, session\.id, job\.tenant_id\)/);
  assert.match(source, /session\.call_id !== feedback\.data\.call_id/);
  assert.match(source, /completed\.status !== "ended"/);
  assert.match(source, /practiceTranscript = completed\.transcript/);
  assert.match(source, /slackText\(feedback\.data\.body\)/);
  assert.match(source, /slackText\(practiceTranscript\)/);
  assert.doesNotMatch(source, /recordingUrl|completed\.recording/);
  assert.match(source, /Full report is too long for this Slack message/);
});
