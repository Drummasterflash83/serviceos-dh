import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  rehearsalAssistant,
  rehearsalOutput,
  rehearsalOpening,
} from "../../supabase/functions/_shared/receptionist-rehearsal.ts";
import {
  validateAssessment,
  REVIEW_INSTRUCTIONS,
} from "../../supabase/functions/_shared/receptionist-care.ts";
const source = {
  id: "live",
  server: { url: "https://never.invalid" },
  hooks: [{}],
  model: {
    provider: "openai",
    model: "gpt-4.1-mini",
    messages: [{ role: "system", content: "Ask consent before voicemail." }],
    toolIds: ["dangerous"],
    tools: [{ type: "transferCall" }],
    knowledgeBase: { server: { url: "https://never.invalid" } },
  },
};
test("transient candidates carry only model instructions, no external actions or live IDs", () => {
  const candidate = rehearsalAssistant(source, "Do not repeat office closure.");
  assert.deepEqual(Object.keys(candidate).sort(), ["model", "name", "serverMessages"]);
  assert.deepEqual(Object.keys(candidate.model).sort(), [
    "maxTokens",
    "messages",
    "model",
    "provider",
    "temperature",
  ]);
  assert.match(candidate.model.messages[0].content, /Do not repeat office closure/);
  assert.match(candidate.model.messages[0].content, /Ask consent/);
  assert.ok(
    candidate.model.messages[0].content.indexOf("ISOLATED TEXT") >
      candidate.model.messages[0].content.indexOf("Do not repeat"),
  );
  assert.equal(JSON.stringify(candidate).includes("never.invalid"), false);
  assert.equal(source.model.toolIds.length, 1);
});
test("unsupported models fail closed", () =>
  assert.throws(
    () => rehearsalAssistant({ model: { provider: "custom-llm" } }, ""),
    /unsupported/,
  ));
test("only real provider replies with receipt IDs become evidence", () => {
  assert.deepEqual(
    rehearsalOutput({ id: "receipt", output: [{ role: "assistant", content: "May I?" }] }),
    { providerId: "receipt", reply: "May I?" },
  );
  assert.throws(() => rehearsalOutput({ output: [{ role: "assistant", content: "guess" }] }));
  assert.throws(() =>
    rehearsalOutput({
      id: "receipt",
      output: [{ role: "assistant", content: "yes", tool_calls: [{}] }],
    }),
  );
});
const finding = {
  category: "repetition",
  severity: "normal",
  evidence: "Closed again",
  explanation: "Closure repeated",
  suggestedChange: "Remove second closure statement.",
};
const assessment = {
  decision: "change_recommended",
  feedbackResponse: "Remove repetition as requested.",
  unchanged: ["Keep handover consent."],
  summary: "Wording needs improvement; consent remains correct.",
  findings: [finding],
  limitations: ["Text only."],
};
test("correct handover does not cancel a requested repetition improvement", () => {
  assert.equal(validateAssessment(assessment, "Closed again").decision, "change_recommended");
  assert.match(REVIEW_INSTRUCTIONS, /Following existing rules is NOT a reason to dismiss/);
});
test("contradictory overall decision and non-action recommendations are rejected", () => {
  assert.throws(
    () => validateAssessment({ ...assessment, decision: "no_change_recommended" }, "Closed again"),
    /conflicting/,
  );
  assert.throws(
    () =>
      validateAssessment(
        {
          ...assessment,
          findings: [
            {
              ...finding,
              suggestedChange: "No change required; the handover follows approved rules.",
            },
          ],
        },
        "Closed again",
      ),
    /conflicting/,
  );
});
test("rehearsal endpoint requires real Chris and current approval, with no live mutation path", () => {
  const code = readFileSync(
    new URL("../../supabase/functions/receptionist-rehearsal/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(code, /care_desk_operator/);
  assert.match(code, /chris@openfolk.ai/);
  assert.match(code, /care_reserve_rehearsal/);
  assert.doesNotMatch(code, /method:\s*["'](?:PATCH|DELETE|PUT)/);
  assert.match(code, /practiceCallMatches/);
  assert.match(code, /api\.vapi\.ai\/chat/);
});

test("replay uses the historical spoken greeting and refuses unresolved templates", () => {
  assert.equal(
    rehearsalOpening("AI: Our office is closed.\nUser: Heidi please."),
    "Our office is closed.",
  );
  assert.throws(() => rehearsalOpening("AI: {% if now %} hello"), /historical_greeting/);
  assert.throws(() => rehearsalOpening("User: hello\nAI: welcome"), /historical_greeting/);
});
