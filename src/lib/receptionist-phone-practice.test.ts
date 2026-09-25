import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("phone practice only binds an explicitly selected, exact-number Vapi call", () => {
  const ui = readFileSync(
    new URL("../components/receptionist/PracticeImprove.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /callerDigits\(call\.number\) === callerDigits\(userPhone\)/);
  assert.match(ui, /Date\.parse\(call\.createdAt\) > Date\.now\(\) - 24/);
  assert.match(ui, /call_id: selectedPhoneCall\?\.id/);
  assert.match(ui, /disabled=\{!!pendingPayload\.current\}/);
  assert.match(ui, /<PhonePracticeEvidence/);
  assert.match(ui, /action: "detail", callId/);
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

test("direct test number does not activate the main number or send voice data to another provider", () => {
  const ui = readFileSync(
    new URL("../components/receptionist/PracticeImprove.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /href=\{dialHref\}/);
  assert.match(ui, /main-number route is unchanged/);
  assert.doesNotMatch(ui, /SpeechRecognition|MediaRecorder/);
});
