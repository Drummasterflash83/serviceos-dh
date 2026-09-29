import test from "node:test";
import assert from "node:assert/strict";
import { reviewConversation } from "../../supabase/functions/_shared/receptionist-care.ts";

test("stored evidence is copied from a source passage, never model prose", async () => {
  const transcript = "AI: Our office is closed.\nAI: Our office is currently closed.";
  const result = await reviewConversation({
    key: "test-only",
    model: "test-model",
    transcript,
    feedback: [],
    callType: "practice",
    approvedRules: "Avoid repetition.",
    fetcher: async () =>
      Response.json({
        status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  summary: "Closure repeated.",
                  findings: [
                    {
                      category: "repetition",
                      severity: "normal",
                      evidenceId: 1,
                      explanation: "Closure stated again.",
                      suggestedChange: "Acknowledge the voicemail request.",
                    },
                  ],
                  limitations: ["Text only."],
                }),
              },
            ],
          },
        ],
      }),
  });
  assert.equal(result.findings[0].evidence, "AI: Our office is currently closed.");
});

test("nonexistent evidence IDs cannot become findings", async () => {
  await assert.rejects(
    reviewConversation({
      key: "test-only",
      model: "test-model",
      transcript: "AI: Hello",
      feedback: [],
      callType: "practice",
      approvedRules: "Say hello.",
      fetcher: async () =>
        Response.json({
          status: "completed",
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    summary: "Invalid finding.",
                    findings: [{ evidenceId: 99 }],
                    limitations: [],
                  }),
                },
              ],
            },
          ],
        }),
    }),
    /assessment_evidence_invalid/,
  );
});

test("review includes long assistant training without truncating the rules", async () => {
  const rules = "Approved rule. ".repeat(6000);
  let sent = false;
  const result = await reviewConversation({
    key: "test-only",
    model: "test-model",
    transcript: "AI: Hello",
    feedback: ["Review this"],
    callType: "practice",
    approvedRules: rules,
    fetcher: async (_url, options) => {
      const payload = JSON.parse(String(options?.body));
      assert.equal(JSON.parse(payload.input).approvedRules, rules);
      assert.equal(payload.store, false);
      sent = true;
      return Response.json({
        status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  summary: "No issue found in this sample.",
                  findings: [],
                  limitations: ["Text only."],
                }),
              },
            ],
          },
        ],
      });
    },
  });
  assert.equal(sent, true);
  assert.equal(result.findings.length, 0);
});

test("oversized training is refused before a paid request", async () => {
  await assert.rejects(
    reviewConversation({
      key: "test-only",
      model: "test-model",
      transcript: "AI: Hello",
      feedback: [],
      callType: "practice",
      approvedRules: "x".repeat(120001),
      fetcher: async () => {
        throw Error("should not call provider");
      },
    }),
    /evidence_too_large/,
  );
});
