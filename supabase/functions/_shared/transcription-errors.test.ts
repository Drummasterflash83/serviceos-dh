import test from "node:test";
import assert from "node:assert/strict";
import { classifyTranscriptionError as classify } from "./transcription-errors.ts";

test("billing exhaustion is not a transient rate limit", () => {
  for (const code of [
    "insufficient_quota",
    "credit_balance_exhausted",
    "billing_hard_limit_reached",
  ]) {
    assert.equal(classify(429, { error: { code } }).code, "openai_quota_exhausted");
  }
  assert.equal(
    classify(429, { error: { code: "rate_limit_exceeded" } }).code,
    "openai_rate_limited",
  );
});
test("audio failures give safe actionable categories", () => {
  for (const [message, expected] of [
    ["Audio is too short", "audio_too_short"],
    ["Maximum content size exceeded", "audio_too_large"],
    ["Failed to decode audio", "invalid_audio"],
    ["Unknown model", "openai_invalid_request"],
  ])
    assert.equal(classify(400, { error: { message } }).code, expected);
});
test("untrusted provider fields never appear in logs", () => {
  const secret = "sk-secret caller@example.com private-file.wav";
  const result = classify(400, { error: { message: secret, code: secret, type: secret } });
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(result.providerStatus, 400);
});
test("opaque errors and transient service errors remain diagnosable", () => {
  assert.equal(classify(400, null).code, "openai_invalid_request");
  assert.equal(classify(503, "not json").code, "openai_error");
  assert.equal(classify(408, {}).code, "openai_error");
  assert.equal(classify(403, {}).code, "openai_auth_failed");
  assert.equal(classify(413, {}).code, "audio_too_large");
});
