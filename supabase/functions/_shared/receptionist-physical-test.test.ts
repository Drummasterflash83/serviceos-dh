import test from "node:test";
import assert from "node:assert/strict";
import { assertPhysicalTestWindow, physicalTestCall, PHYSICAL_TEST_DESTINATIONS } from "./receptionist-physical-test.ts";

const input = {
  tenantId: "00000000-0000-0000-0000-000000000001",
  destination: "office601",
  phoneNumberId: "00000000-0000-0000-0000-000000000002",
  auditId: "00000000-0000-0000-0000-000000000003",
  voice: { provider: "11labs", voiceId: "ZF6FPAbjXT4488VcRRnw", model: "eleven_flash_v2_5", stability: 0.5 },
  now: new Date("2026-10-02T06:00:00Z"),
};

test("only three reviewed DH direct numbers can be called, never the main line", () => {
  const numbers = Object.entries(PHYSICAL_TEST_DESTINATIONS).map(([destination, value]) => {
    const call = physicalTestCall({ ...input, destination });
    assert.equal(call.customer.number, value.number);
    return call.customer.number;
  });
  assert.deepEqual(numbers, ["+441794840043", "+441794378105", "+441794378096"]);
  for (const destination of ["+441794341600", "emergency603", "__proto__", "constructor", "https://evil.test"])
    assert.throws(() => physicalTestCall({ ...input, destination }), /not authorised/);
  assert.throws(() => physicalTestCall({ ...input, tenantId: "other" }), /tenant/);
});

test("one-off London window fails closed, including two-minute pre-office safety margin", () => {
  assert.doesNotThrow(() => assertPhysicalTestWindow(new Date("2026-10-01T23:00:00Z")));
  assert.doesNotThrow(() => assertPhysicalTestWindow(new Date("2026-10-02T06:57:59.999Z")));
  for (const time of ["2026-10-01T22:59:59Z", "2026-10-02T06:58:00Z", "2026-10-02T07:00:00Z", "2026-10-03T04:00:00Z", "invalid"])
    assert.throws(() => assertPhysicalTestWindow(new Date(time)), /window is closed/);
});

test("caller is short-lived, transparent, recording-enabled and cannot transfer or send anything", () => {
  const call = physicalTestCall(input);
  assert.equal(call.assistant.maxDurationSeconds, 60);
  assert.equal(call.assistant.firstMessageMode, "assistant-waits-for-user");
  assert.deepEqual(call.assistant.model.tools, [{ type: "endCall" }]);
  assert.equal(call.assistant.voicemailDetection, "off");
  assert.equal(call.assistant.artifactPlan.recordingEnabled, true);
  assert.equal(call.assistant.artifactPlan.transcriptPlan.userName, "Receiving endpoint");
  assert.match(call.assistant.model.messages[0].content, /No customer action is required/);
  assert.match(call.assistant.model.messages[0].content, /not a customer and not an emergency/);
  assert.match(call.assistant.model.messages[0].content, /not pretend a message was left/);
  assert.match(call.assistant.model.messages[0].content, /backend will verify outcomes/);
  assert.equal("assistantId" in call, false);
  assert.equal("schedulePlan" in call, false);
  assert.equal("server" in call.assistant, false);
});

test("voice is the existing approved voice; credentials, fallbacks, URLs and tools cannot be copied", () => {
  const voice = { ...input.voice, apiKey: "secret", server: { url: "https://evil.test" }, fallbackPlan: { voices: [{}] }, tools: [{ type: "transferCall" }] };
  const before = JSON.stringify(voice);
  const call = physicalTestCall({ ...input, voice });
  assert.deepEqual(call.assistant.voice, input.voice);
  assert.equal(JSON.stringify(voice), before);
  assert.doesNotMatch(JSON.stringify(call), /evil\.test|secret|transferCall/);
  for (const changed of [{ ...voice, voiceId: "newVoice" }, { ...voice, provider: "newProcessor" }, { ...voice, model: "newModel" }, { ...voice, stability: NaN }])
    assert.throws(() => physicalTestCall({ ...input, voice: changed }));
  assert.throws(() => physicalTestCall({ ...input, phoneNumberId: "unverified" }));
  assert.throws(() => physicalTestCall({ ...input, auditId: "inject instructions" }));
});
