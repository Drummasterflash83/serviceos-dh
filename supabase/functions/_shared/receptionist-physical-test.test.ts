import test from "node:test";
import assert from "node:assert/strict";
import { assertPhysicalTestWindow, physicalTestCall, physicalVoicemailTestCall, PHYSICAL_TEST_DESTINATIONS } from "./receptionist-physical-test.ts";

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

test("voicemail v2 uses Vapi's fixed-script tool and the same processors, only for office 601", () => {
  const call = physicalVoicemailTestCall(input);
  const original = physicalTestCall(input);
  assert.equal(call.customer.number, "+441794840043");
  assert.equal(call.assistant.voicemailDetection, "off");
  assert.deepEqual(call.assistant.voice, original.assistant.voice);
  assert.deepEqual(call.assistant.transcriber, original.assistant.transcriber);
  assert.equal(call.assistant.model.provider, original.assistant.model.provider);
  assert.equal(call.assistant.model.model, original.assistant.model.model);
  assert.equal(call.assistant.maxDurationSeconds, 60);
  assert.equal(call.assistant.silenceTimeoutSeconds, 55);
  assert.equal(call.assistant.firstMessageMode, "assistant-waits-for-user");
  assert.equal(call.assistant.startSpeakingPlan.waitSeconds, 3);
  assert.equal(call.assistant.metadata.physicalTestRevision, "office-voicemail-v2");
  assert.deepEqual(call.assistant.model.tools.map(tool => tool.type), ["voicemail", "endCall"]);
  const voicemail = call.assistant.model.tools[0];
  assert.equal(voicemail.function?.name, "leave_office_test_voicemail");
  assert.equal(voicemail.messages?.[0].type, "request-start");
  assert.match(voicemail.messages?.[0].content ?? "", /No customer action is required/);
  assert.match(voicemail.messages?.[0].content ?? "", /shared office mailbox six zero one/);
  assert.match(voicemail.messages?.[0].content ?? "", /Test reference 0 0 0 0 0 0 0 0/);
  assert.doesNotMatch(JSON.stringify(call), /gemini|transferCall|assistantId|schedulePlan|https:/);
  for (const destination of ["rob109", "alan104", "emergency603", "+441794341600", "__proto__"])
    assert.throws(() => physicalVoicemailTestCall({ ...input, destination }), /authorised only/);
});

test("voicemail v2 differentiates recorded greeting from abort and preserves immediate human stop", () => {
  const prompt = physicalVoicemailTestCall(input).assistant.model.messages[0].content;
  assert.match(prompt, /recorded Drummond's office greeting/);
  assert.match(prompt, /not reasons to hang up/);
  assert.match(prompt, /COMPLETE recorded greeting/);
  assert.match(prompt, /beep may not be transcribed/);
  assert.match(prompt, /Never call endCall alongside it/);
  assert.match(prompt, /asks you to stop or declines, end immediately/);
  assert.match(prompt, /explicit OTHER personal mailbox/);
  assert.match(prompt, /independently find the new message in mailbox 601/);
  assert.match(prompt, /play it back before marking receipt verified/);
});

test("voicemail v2 keeps original validation, avoids mutation and fails closed outside the window", () => {
  const before = JSON.stringify(input);
  const initial = physicalTestCall(input);
  physicalVoicemailTestCall(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(physicalTestCall(input), initial);
  assert.throws(() => physicalVoicemailTestCall({ ...input, tenantId: "other" }), /tenant/);
  assert.throws(() => physicalVoicemailTestCall({ ...input, auditId: "fake" }), /audit reference/);
  assert.throws(() => physicalVoicemailTestCall({ ...input, now: new Date("2026-10-02T06:58:00Z") }), /window is closed/);
  assert.throws(() => physicalVoicemailTestCall({ ...input, voice: { ...input.voice, provider: "newProcessor" } }), /voice changed/);
});
