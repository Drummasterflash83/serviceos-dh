import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reviewConversation,
  validateAssessment,
  evidenceHash,
} from "../../supabase/functions/_shared/receptionist-care.ts";
const transcript = "Emma: Our office is closed. Emma: Our office is currently closed.";
const good = {
  summary: "Repeated closed-office explanation.",
  findings: [
    {
      category: "repetition",
      severity: "normal",
      evidence: "Our office is currently closed.",
      explanation: "The opening hours have already been explained.",
      suggestedChange: "Move directly to the approved voicemail offer.",
    },
  ],
  limitations: ["Audio not assessed."],
};
test("accepts a grounded repetition finding", () =>
  assert.equal(validateAssessment(good, transcript).findings.length, 1));
test("refuses fabricated quotes", () =>
  assert.throws(() => validateAssessment(good, "Different call")));
test("refuses unknown severity", () =>
  assert.throws(() =>
    validateAssessment(
      { ...good, findings: [{ ...good.findings[0], severity: "auto_fix" }] },
      transcript,
    ),
  ));
test("refuses unbounded findings", () =>
  assert.throws(() =>
    validateAssessment({ ...good, findings: Array(7).fill(good.findings[0]) }, transcript),
  ));
test("does not silently truncate call evidence", async () =>
  assert.rejects(
    reviewConversation({
      transcript: "a".repeat(60001),
      approvedRules: "Rules",
      feedback: [],
      callType: "webCall",
      key: "test",
      model: "test",
    }),
    /evidence_too_large/,
  ));
test("missing transcript is not a passing review", async () =>
  assert.rejects(
    reviewConversation({
      transcript: "",
      approvedRules: "Rules",
      feedback: [],
      callType: "webCall",
      key: "test",
      model: "test",
    }),
    /awaiting_transcript/,
  ));
test("requires approved policy", async () =>
  assert.rejects(
    reviewConversation({
      transcript,
      approvedRules: "",
      feedback: [],
      callType: "webCall",
      key: "test",
      model: "test",
    }),
    /approved_rules_required/,
  ));
test("uses stateless structured review without tools, audio or record URLs", async () => {
  const fetcher = (async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const b = JSON.parse(String(options?.body));
    assert.equal(b.store, false);
    assert.equal(b.tools, undefined);
    assert.equal(b.text.format.strict, true);
    assert.match(b.instructions, /untrusted evidence/);
    assert.match(b.instructions, /HUMAN review/);
    assert.equal(JSON.parse(b.input).transcript, transcript);
    return Response.json({
      status: "completed",
      output: [{ content: [{ type: "output_text", text: JSON.stringify(good) }] }],
    });
  }) as typeof fetch;
  assert.deepEqual(
    await reviewConversation({
      transcript,
      approvedRules: "Use voicemail after hours.",
      feedback: [],
      callType: "webCall",
      key: "synthetic",
      model: "synthetic",
      fetcher,
    }),
    good,
  );
});
test("provider refusal is not a healthy result", async () => {
  const fetcher = (async () =>
    Response.json({
      status: "completed",
      output: [{ content: [{ type: "refusal" }] }],
    })) as typeof fetch;
  await assert.rejects(
    reviewConversation({
      transcript,
      approvedRules: "Rules",
      feedback: [],
      callType: "webCall",
      key: "test",
      model: "test",
      fetcher,
    }),
    /review_refused/,
  );
});
test("rate limit carries only a safe error code", async () => {
  const fetcher = (async () =>
    new Response("private provider details", { status: 429 })) as typeof fetch;
  await assert.rejects(
    reviewConversation({
      transcript,
      approvedRules: "Rules",
      feedback: [],
      callType: "webCall",
      key: "test",
      model: "test",
      fetcher,
    }),
    /review_rate_limited/,
  );
});
test("evidence hashes bind rules and feedback as well as transcript", async () => {
  assert.notEqual(
    await evidenceHash({ transcript, rules: "A" }),
    await evidenceHash({ transcript, rules: "B" }),
  );
  assert.equal(await evidenceHash(good), await evidenceHash(good));
});
test("exhausted credit is distinct from a transient rate limit", async () => {
  const fetcher = (async () =>
    Response.json(
      { error: { code: "credit_balance_exhausted" } },
      { status: 429 },
    )) as typeof fetch;
  await assert.rejects(
    reviewConversation({
      transcript,
      approvedRules: "Rules",
      feedback: [],
      callType: "webCall",
      key: "test",
      model: "test",
      fetcher,
    }),
    /review_credit_required/,
  );
});
