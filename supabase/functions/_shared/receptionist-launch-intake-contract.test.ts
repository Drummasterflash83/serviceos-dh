import test from "node:test";
import assert from "node:assert/strict";
import { clearLaunchModel } from "./receptionist-launch-clear-contract.ts";
import { intakeLaunchPatch, safeSpeechProjection } from "./receptionist-launch-intake-contract.ts";

function candidate() {
  const value: any = {
    id: "dcfc2e66-a438-43ab-b863-467f5a5089df", firstMessage: "openfolk_holidays",
    voice: { provider: "11labs", voiceId: "unchanged-voice" },
    startSpeakingPlan: { waitSeconds: 0.8 }, stopSpeakingPlan: { numWords: 2, voiceSeconds: 0.3 },
    endCallPhrases: ["Goodbye"], firstMessageInterruptionsEnabled: false,
    model: {
      provider: "openai", model: "gpt-4.1", temperature: 0, maxTokens: 600,
      toolIds: ["94864962-b4c2-4364-ad82-6939cb9d4cb6"],
      tools: [{ type: "transferCall", function: { name: "ordinary" }, destinations: Array.from({ length: 10 }, (_, n) => ({
        type: "number", number: `+44179437810${n}`, description: `Approved ${n}`, message: "", transferPlan: { mode: "blind-transfer" },
      })) }],
    },
  };
  value.model = clearLaunchModel(value);
  return value;
}

test("candidate-only patch preserves every non-message model field and all outer settings", () => {
  const source = candidate(), before = structuredClone(source);
  const result = intakeLaunchPatch(source);
  assert.deepEqual(Object.keys(result), ["model"]);
  const { messages: _messages, ...remaining } = result.model;
  const { messages: _original, ...originalRemaining } = source.model;
  assert.deepEqual(remaining, originalRemaining);
  assert.equal(result.model.tools, source.model.tools);
  assert.equal(result.model.toolIds, source.model.toolIds);
  assert.deepEqual(source, before);
  assert.equal(result.model.messages.length, 1);
});

test("rejects live assistant, changed prompt, extra instructions and unexpected routes", () => {
  const source = candidate();
  assert.throws(() => intakeLaunchPatch({ ...source, id: "4eb2bee8-ac25-47c9-b962-409ed250ceb6" }), /isolated/);
  assert.throws(() => intakeLaunchPatch({ ...source, model: { ...source.model, messages: [{ role: "system", content: source.model.messages[0].content + "\nUnreviewed change" }] } }), /Unreviewed/);
  assert.throws(() => intakeLaunchPatch({ ...source, model: { ...source.model, messages: [...source.model.messages, { role: "system", content: "extra" }] } }), /isolated/);
  assert.throws(() => intakeLaunchPatch({ ...source, model: { ...source.model, tools: [] } }), /candidate/);
  assert.throws(() => intakeLaunchPatch({ ...source, firstMessage: "different" }), /candidate/);
});

test("idempotent exact clause replacements leave no contradictory immediate-handoff or synthetic-goodbye rule", () => {
  const source = candidate(), once = intakeLaunchPatch(source);
  assert.deepEqual(intakeLaunchPatch({ ...source, model: once.model }), once);
  const text = once.model.messages[0].content;
  for (const old of [
    'say only "You\'re welcome. Goodbye."',
    "invoke Route-Emergency-to-Rob-or-Tony ONCE immediately",
    "the next action is the handoff, not another intake turn",
    "SAFETY — GIVE ONCE, BEFORE INTAKE",
  ]) assert.ok(!text.includes(old), old);
  assert.equal(text.split("OPENFOLK CANDIDATE INTAKE CONTRACT — 2 OCTOBER 2026").length, 2);
  for (const kept of ["2026-12-25", "Monday–Friday08:30–17:00", "No consent means no tool", "Alan104", "Rob Mobile109", "personal109/105", "office601", "commercial Rob109 then Tony105", "Carbon-monoxide"])
    assert.ok(text.includes(kept), kept);
});

test("safety completion overrides brevity without claiming deterministic audio delivery", () => {
  const text = intakeLaunchPatch(candidate()).model.messages[0].content;
  for (const rule of [
    "emergency telephone digits take priority over brevity", "including the whole number when necessary",
    "Saying only the service name is incomplete", "complete number is0800111999",
    "before invoking Mary's transfer", "Never omit its digits because999 was also advised",
    "must never wait for the check", "not medical/technical safety",
  ]) assert.ok(text.includes(rule), rule);
  assert.ok(!text.includes("guaranteed"));
});

test("named-person handover must be spoken and must not claim Heidi answered", () => {
  const text = intakeLaunchPatch(candidate()).model.messages[0].content;
  assert.match(text, /speak the short customer-facing handover sentence before invoking/);
  assert.match(text, /silent tool call or a claim that Heidi answered is not an acceptable handover/);
  assert.match(text, /do not impose an automatic goodbye/);
});

test("dynamic gate requires source quotes and never treats errors or test mocks as approval", () => {
  const text = intakeLaunchPatch(candidate()).model.messages[0].content;
  for (const rule of [
    'destination must be "dynamic"',
    "name, callback, callbackReadBack, callbackConfirmation, site, issue and classification",
    "CALLER'S words", "Emma's full number read-back", "explicit affirmative response immediately after",
    "never caller ID or a guessed number", "latest explicit name, location and domestic/commercial corrections",
    "Never promise or announce a handoff before that check is accepted",
    "An accepted dynamic destination makes the internal handoff automatically",
    "Retry the check only after the caller supplies materially new or corrected required evidence",
    "Do not request facts or a confirmed callback again merely because of a server error",
    "A test interception is not an intake-check approval",
  ]) assert.ok(text.includes(rule), rule);
});

test("candidate asks for a precise site and never treats a bare postcode as complete", () => {
  const text = intakeLaunchPatch(candidate()).model.messages[0].content;
  for (const rule of [
    "A bare postcode is not a complete emergency site",
    "If only a postcode is supplied, ask once for the premises name or number",
    "What's the street address, or the premises name and postcode?",
    "A bare postcode or \"my home\" is insufficient",
    "Never delay immediate safety advice for location details",
  ]) assert.ok(text.includes(rule), rule);
  assert.ok(!text.includes("numbered street address or UK postcode"));
  assert.ok(!text.includes("If postcode/address or issue already supplied"));
});

test("speech projection is read-only, whitelisted and preserves absent-versus-false/zero", () => {
  const source: any = {
    ...candidate(), firstMessageMode: "assistant-speaks-first", modelOutputInMessagesEnabled: false,
    silenceTimeoutSeconds: 0, maxDurationSeconds: 180,
    startSpeakingPlan: { waitSeconds: 0, smartEndpointingEnabled: true, privateExtra: "hide", transcriptionEndpointingPlan: { onPunctuationSeconds: 0.2, onNoPunctuationSeconds: 1, onNumberSeconds: 0.5, headers: { Authorization: "hide" } } },
  };
  const before = structuredClone(source), result = safeSpeechProjection(source);
  assert.deepEqual(source, before);
  assert.equal(result.firstMessageInterruptionsEnabled, false);
  assert.equal(result.modelOutputInMessagesEnabled, false);
  assert.equal(result.silenceTimeoutSeconds, 0);
  assert.equal(result.startSpeakingPlan?.waitSeconds, 0);
  assert.deepEqual(result.stopSpeakingPlan, { numWords: 2, voiceSeconds: 0.3, backoffSeconds: null });
  for (const hidden of ["voice", "model", "server", "privateExtra", "headers", "Authorization"]) assert.ok(!JSON.stringify(result).includes(hidden + '"'));
  const absent = safeSpeechProjection({ silenceTimeoutSeconds: "0", maxDurationSeconds: NaN, firstMessageMode: "unsupported" });
  assert.equal(absent.endCallPhrases, null);
  assert.equal(absent.modelOutputInMessagesEnabled, null);
  assert.equal(absent.maxDurationSeconds, null);
  assert.equal(absent.firstMessageMode, null);
});

test("speech projection removes cross-field secrets, URLs, tokens and private key material from phrases", () => {
  const value = {
    server: { headers: { Authorization: "opaque-auth" }, credentialValues: { privateKey: "private-repeated", signing_key: "signing-repeated" } },
    endCallPhrases: ["Goodbye", "opaque-auth private-repeated signing-repeated", "https://example.test/private?token=secret", "sk-proj-dummy xoxb-dummy", "-----BEGIN PRIVATE KEY-----\nprivate-pem\n-----END PRIVATE KEY-----", "password=private-inline", 1],
  };
  const text = JSON.stringify(safeSpeechProjection(value));
  assert.ok(text.includes("Goodbye"));
  for (const secret of ["opaque-auth", "private-repeated", "signing-repeated", "example.test", "sk-proj-dummy", "xoxb-dummy", "private-pem", "private-inline"])
    assert.ok(!text.includes(secret), secret);
});
