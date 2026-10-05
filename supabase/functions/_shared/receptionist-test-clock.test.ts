import test from "node:test";
import assert from "node:assert/strict";
import { clockOverrides, approvedClockOverride, testClocks } from "./receptionist-test-clock.ts";

const assistant = () => ({
  firstMessage: 'Current time {{"now" | date: "%H:%M", "Europe/London"}}',
  voice: { provider: "11labs", voiceId: "reviewed-emma" },
  transcriber: { provider: "soniox" },
  maxDurationSeconds: 300,
  model: {
    provider: "openai", model: "gpt-4.1", temperature: 0,
    toolIds: ["approved-handoff"], tools: [{ type: "transferCall", destinations: [{ number: "+441794378105" }] }],
    messages: [{ role: "system", content: 'Date {{"now" | date: "%Y-%m-%d", "Europe/London"}}. Preserve safety and consent.' }],
  },
});

test("fixed-clock simulations preserve each explicitly configured finite temperature, including zero", () => {
  for (const temperature of [0, 0.1, 0.7, 1, 1.5, 2]) {
    const source = assistant(); source.model.temperature = temperature;
    for (const clock of Object.values(testClocks)) {
      const result = clockOverrides(source, clock);
      assert.equal(result.model.temperature, temperature);
      assert.equal(approvedClockOverride(result, source), true);
      assert.equal(approvedClockOverride({ ...result, model: { ...result.model, temperature: temperature + 0.01 } }, source), false);
    }
  }
});

test("missing or invalid temperatures remain omitted without inventing or coercing a default", () => {
  for (const temperature of [undefined, null, "0", "0.7", false, NaN, Infinity, -Infinity]) {
    const source: any = assistant(); source.model.temperature = temperature;
    const result = clockOverrides(source, testClocks.closed);
    assert.equal(Object.hasOwn(result.model, "temperature"), false);
    assert.equal(approvedClockOverride(result, source), true);
  }
  const absent: any = assistant(); delete absent.model.temperature;
  assert.equal(Object.hasOwn(clockOverrides(absent, testClocks.open).model, "temperature"), false);
});

test("temperature fidelity never replaces operational tools, voice or transcription and does not mutate the assistant", () => {
  const source = assistant(), before = structuredClone(source);
  const result = clockOverrides(source, testClocks.closed);
  assert.deepEqual(source, before);
  assert.deepEqual(Object.keys(result).sort(), ["firstMessage", "maxDurationSeconds", "model"]);
  assert.deepEqual(Object.keys(result.model).sort(), ["messages", "model", "provider", "temperature"]);
  assert.equal(result.maxDurationSeconds, 180);
  assert.match(result.firstMessage, /2026-10-01T19:00:00Z/);
  assert.match(result.model.messages[0].content, /Preserve safety and consent/);
  assert.notEqual(result.model.messages, source.model.messages);
  assert.notEqual(result.model.messages[0], source.model.messages[0]);
  result.model.messages[0].content = "Changed copy";
  assert.deepEqual(source, before);
});

test("historical snapshots are never rewritten or accepted as a new temperature-exact override", () => {
  const source = assistant();
  const current = clockOverrides(source, testClocks.closed);
  const { temperature: _temperature, ...oldModel } = current.model;
  const historicalSnapshot = { ...current, model: oldModel };
  const savedBefore = structuredClone(historicalSnapshot);
  assert.equal(approvedClockOverride(historicalSnapshot, source), false);
  assert.deepEqual(historicalSnapshot, savedBefore);
  assert.equal(approvedClockOverride(current, source), true);
  // A genuinely unconfigured historical assistant is still compared against
  // its own configuration, never silently backfilled with a new temperature.
  const unconfigured: any = structuredClone(source); delete unconfigured.model.temperature;
  assert.equal(approvedClockOverride(historicalSnapshot, unconfigured), true);
});
