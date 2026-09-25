import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("practice connects in the app and binds the exact reserved session", () => {
  const ui = readFileSync(
    new URL("../components/receptionist/PracticeImprove.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /Test \{name\}/);
  assert.match(ui, /voice\.reconnect\(\{ webCallUrl: data\.webCallUrl, id: data\.callId \}\)/);
  assert.match(ui, /practice_session_id: session\?\.id/);
  assert.match(ui, /call_id: session\?\.callId/);
  assert.match(ui, /key=\{session\.id\}/);
  assert.doesNotMatch(ui, /Find my call|callerDigits|href=\{dialHref\}/);
});

test("every reserved test with a call ID appears in history even without feedback", () => {
  const ui = readFileSync(
    new URL("../components/receptionist/PracticeImprove.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /\.from\("receptionist_practice_sessions"\)/);
  assert.match(ui, /\.eq\("author_id", userId!\)/);
  assert.match(ui, /No feedback yet/);
  assert.match(ui, /With feedback/);
  assert.match(ui, /autoLoad/);
  assert.doesNotMatch(ui, /Check recording|KEEP THE LEARNING WITH THE CALL/);
});

test("detail and recording requests are tenant-scoped and assistant-verified", () => {
  const edge = readFileSync(
    new URL("../../supabase/functions/receptionist-calls/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(edge, /\.eq\("tenant_id", body\.tenantId\)/);
  assert.match(edge, /raw\.assistantId !== w\.assistant_id/);
  assert.match(edge, /normalizeCall\(raw\)/);
  assert.match(edge, /recordingLink\(body\.callId, w\.assistant_id, key\)/);
});

test("web practice does not claim to verify the phone route or use unapproved speech processing", () => {
  const ui = readFileSync(
    new URL("../components/receptionist/PracticeImprove.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /not the phone transfer or Birchills route/);
  assert.match(ui, /cannot change customer records/);
  assert.doesNotMatch(ui, /SpeechRecognition/);
});
