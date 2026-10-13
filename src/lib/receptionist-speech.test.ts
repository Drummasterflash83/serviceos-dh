import test from "node:test";
import assert from "node:assert/strict";
import { practiceAssistant } from "../../supabase/functions/_shared/receptionist-practice.ts";
import { practiceSpeakingPlans } from "../../supabase/functions/_shared/receptionist-speech.ts";

test("practice retains modern turn detection, number pauses and interruption semantics", () => {
  const timing = {
    startSpeakingPlan: {
      waitSeconds: 0.3,
      smartEndpointingPlan: {
        provider: "livekit",
        waitFunction: "20 + 500 * sqrt(x) + 2500 * x^3",
      },
      transcriptionEndpointingPlan: {
        onPunctuationSeconds: 0.1,
        onNoPunctuationSeconds: 1.2,
        onNumberSeconds: 0.8,
      },
      customEndpointingRules: [
        {
          type: "assistant",
          regex: "postcode",
          regexOptions: [{ type: "ignore-case", enabled: true }],
          timeoutSeconds: 2,
        },
        { type: "customer", regex: "[0-9]$", timeoutSeconds: 1 },
        { type: "both", assistantRegex: "number", customerRegex: "[0-9]$", timeoutSeconds: 2 },
      ],
    },
    stopSpeakingPlan: {
      numWords: 0,
      voiceSeconds: 0.2,
      backoffSeconds: 0.8,
      acknowledgementPhrases: ["right", "okay"],
      interruptionPhrases: ["stop", "actually"],
    },
  };
  const source = {
    ...timing,
    model: {
      provider: "openai",
      model: "existing-model",
      messages: [{ role: "system", content: "Use approved company guidance." }],
    },
    voice: {
      provider: "11labs",
      voiceId: "existing-emma-voice",
      speed: 1,
      optimizeStreamingLatency: 1,
      enableSsmlParsing: false,
      autoMode: false,
      cachingEnabled: true,
    },
    firstMessage: "Hello, Emma here.",
    server: { url: "https://not-for-practice.example" },
  };
  const before = JSON.stringify(source);
  const result = practiceAssistant(source, []);
  assert.deepEqual(result.startSpeakingPlan, timing.startSpeakingPlan);
  assert.deepEqual(result.stopSpeakingPlan, timing.stopSpeakingPlan);
  assert.deepEqual(result.voice, source.voice);
  assert.equal(result.firstMessage, source.firstMessage);
  assert.match(result.model.messages[0].content, /No calls can be transferred/);
  assert.deepEqual(result.serverMessages, []);
  assert.ok(!JSON.stringify(result).includes("not-for-practice"));
  assert.equal(JSON.stringify(source), before);
});

test("timing projection excludes callbacks and rejects custom external endpointing", () => {
  const result = practiceSpeakingPlans({
    startSpeakingPlan: {
      smartEndpointingPlan: {
        provider: "vapi",
        server: { url: "https://secret.example" },
        credentialsId: "secret",
      },
      transcriptionEndpointingPlan: { onNumberSeconds: 0.8, headers: { secret: "private" } },
      customEndpointingRules: [
        { type: "assistant", regex: "postcode", timeoutSeconds: 2, server: "private" },
      ],
    },
    stopSpeakingPlan: { backoffSeconds: 0.8, server: "private" },
  });
  assert.ok(!JSON.stringify(result).includes("secret"));
  assert.ok(!JSON.stringify(result).includes("private"));
  for (const smart of [{ provider: "custom-endpointing-model" }, { provider: "unknown" }, {}])
    assert.throws(
      () => practiceSpeakingPlans({ startSpeakingPlan: { smartEndpointingPlan: smart } }),
      /requires review/,
    );
  assert.throws(
    () => practiceSpeakingPlans({ startSpeakingPlan: { customEndpointingRules: {} } }),
    /Invalid/,
  );
  assert.throws(
    () =>
      practiceSpeakingPlans({
        startSpeakingPlan: { customEndpointingRules: [{ type: "unknown" }] },
      }),
    /Unsupported/,
  );
});

test("legacy and absent plans retain prior behaviour without introducing tuning defaults", () => {
  assert.deepEqual(practiceSpeakingPlans({}), { startSpeakingPlan: {}, stopSpeakingPlan: {} });
  const legacy = {
    startSpeakingPlan: { waitSeconds: 0, smartEndpointingEnabled: false },
    stopSpeakingPlan: { numWords: 0, voiceSeconds: 0, backoffSeconds: 0 },
  };
  assert.deepEqual(practiceSpeakingPlans(legacy), legacy);
});
