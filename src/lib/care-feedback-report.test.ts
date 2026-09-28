import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  careFeedbackReport,
  type ReportDependencies,
  type ReportFeedback,
  type ReportSession,
} from "../../supabase/functions/_shared/care-feedback-report.ts";
import { deliverCareAlert } from "../../supabase/functions/_shared/care-alert-delivery.ts";

const tenant = "00000000-0000-0000-0000-000000000001";
const call = "00000000-0000-0000-0000-000000000002";
const session = "00000000-0000-0000-0000-000000000003";
const feedbackId = "00000000-0000-0000-0000-000000000004";
const assistant = "00000000-0000-0000-0000-000000000005";
const feedback: ReportFeedback = {
  id: feedbackId,
  tenant_id: tenant,
  call_id: call,
  practice_session_id: session,
  title: "Emma test feedback",
  body: "Please stop repeating that the office is closed.",
};
const practice: ReportSession = { id: session, tenant_id: tenant, call_id: call };
const provider = {
  id: call,
  type: "webCall",
  status: "ended",
  transcript: "Emma: The office is closed. Caller: Heidi please.",
  assistant: { metadata: { openfolkPracticeSession: session, openfolkTenant: tenant } },
  artifact: { recordingUrl: "https://private.example.invalid/never-send-this" },
};
const issue = { tenant_id: tenant, feedback_id: feedbackId, source_key: `feedback:${feedbackId}` };
function harness(
  input: {
    feedback?: ReportFeedback | null;
    session?: ReportSession | null;
    call?: Record<string, unknown>;
  } = {},
) {
  const requests: string[] = [];
  const deps: ReportDependencies = {
    feedback: async (t, id) => {
      assert.equal(t, tenant);
      assert.equal(id, feedbackId);
      return "feedback" in input ? input.feedback! : feedback;
    },
    practiceSession: async (t, c, s) => {
      assert.equal(t, tenant);
      assert.ok(c === call || c === null);
      assert.ok(s === session || s === null);
      return "session" in input ? input.session! : practice;
    },
    workspace: async (t) => {
      assert.equal(t, tenant);
      return { assistant_id: assistant, key: "synthetic-only" };
    },
    fetcher: async (url, init) => {
      requests.push(String(url));
      assert.equal(init?.redirect, "error");
      return Response.json(input.call ?? provider);
    },
  };
  return { deps, requests };
}
test("practice report preserves the exact typed feedback and full transcript without signed URLs", async () => {
  const h = harness();
  const result = await careFeedbackReport(issue, h.deps);
  assert.ok(result?.includes(feedback.body));
  assert.ok(result?.includes(provider.transcript));
  assert.match(result!, /Practice call report/);
  assert.doesNotMatch(result!, /never-send-this|recordingUrl/);
  assert.deepEqual(h.requests, [`https://api.vapi.ai/call/${call}`]);
});
test("observation without a call sends its complete text without contacting the provider", async () => {
  const h = harness({ feedback: { ...feedback, call_id: null, practice_session_id: null } });
  assert.equal(
    await careFeedbackReport(issue, h.deps),
    `Client feedback\n${feedback.title}\n${feedback.body}`,
  );
  assert.equal(h.requests.length, 0);
});
test("canonical practice finding without typed feedback is labelled honestly", async () => {
  const h = harness();
  const result = await careFeedbackReport(
    { ...issue, feedback_id: null, source_key: `call:${call}:repetition` },
    h.deps,
  );
  assert.match(result!, /No feedback submitted with this call/);
  assert.ok(result?.includes(provider.transcript));
});
test("live call report requires the exact workspace assistant", async () => {
  const h = harness({
    feedback: { ...feedback, practice_session_id: null },
    session: null,
    call: { ...provider, type: "inboundPhoneCall", assistantId: assistant },
  });
  assert.match((await careFeedbackReport(issue, h.deps))!, /^Call report/);
  h.deps.fetcher = async () => Response.json({ ...provider, assistantId: tenant });
  await assert.rejects(careFeedbackReport(issue, h.deps), /call_scope_invalid/);
});
for (const [name, data] of [
  ["wrong feedback tenant", { feedback: { ...feedback, tenant_id: call } }],
  ["wrong feedback ID", { feedback: { ...feedback, id: call } }],
  ["missing original feedback", { feedback: null }],
] as const) {
  test(`${name} refuses before provider access`, async () => {
    const h = harness(data);
    await assert.rejects(careFeedbackReport(issue, h.deps), /feedback_unavailable/);
    assert.equal(h.requests.length, 0);
  });
}
for (const [name, data] of [
  ["wrong practice tenant", { session: { ...practice, tenant_id: call } }],
  ["wrong practice call", { session: { ...practice, call_id: tenant } }],
  ["missing practice session", { session: null }],
  ["wrong provider call", { call: { ...provider, id: tenant } }],
  [
    "wrong provider session",
    {
      call: {
        ...provider,
        assistant: { metadata: { openfolkPracticeSession: call, openfolkTenant: tenant } },
      },
    },
  ],
  [
    "wrong provider tenant",
    {
      call: {
        ...provider,
        assistant: { metadata: { openfolkPracticeSession: session, openfolkTenant: call } },
      },
    },
  ],
] as const) {
  test(`${name} refuses mismatched evidence`, async () => {
    await assert.rejects(careFeedbackReport(issue, harness(data).deps), /call_scope_invalid/);
  });
}
test("missing and still-processing transcript remains pending rather than sending an empty report", async () => {
  for (const [patch, expected] of [
    [{ transcript: null }, /awaiting_transcript/],
    [{ status: "in-progress" }, /awaiting_completed_call/],
  ] as const)
    await assert.rejects(
      careFeedbackReport(issue, harness({ call: { ...provider, ...patch } }).deps),
      expected,
    );
});
test("oversized evidence is explicitly refused rather than truncated", async () => {
  await assert.rejects(
    careFeedbackReport(
      issue,
      harness({ call: { ...provider, transcript: "x".repeat(30_001) } }).deps,
    ),
    /evidence_too_large/,
  );
});
test("provider call matching assistant cannot bypass an attached practice session's metadata", async () => {
  await assert.rejects(
    careFeedbackReport(
      issue,
      harness({
        call: {
          id: call,
          assistantId: assistant,
          status: "ended",
          type: "webCall",
          transcript: "Hello",
        },
      }).deps,
    ),
    /call_scope_invalid/,
  );
});
async function delivery(report: string, allowedTeam = "TOPENFOLK") {
  const posts: Record<string, unknown>[] = [];
  const failures: { code: string; unknown: boolean }[] = [];
  const result = await deliverCareAlert(
    {
      id: feedbackId,
      tenant_id: tenant,
      issue_id: session,
      kind: "attention",
      reason: "event",
      lease_id: call,
      team_id: "TOPENFOLK",
      channel_id: "CEMMA",
      client_msg_id: feedbackId,
    },
    {
      token: "synthetic-only",
      allowedTeam,
      currentRoute: async () => ({ enabled: true, team_id: "TOPENFOLK", channel_id: "CEMMA" }),
      issue: async () => ({
        title: "Test",
        stage: "received",
        priority: "normal",
        company: "Drummonds",
        report,
      }),
      ack: async () => {},
      fail: async (code, unknown) => {
        failures.push({ code, unknown });
      },
      fetcher: async (url, init) => {
        if (String(url).endsWith("auth.test"))
          return Response.json({ ok: true, team_id: "TOPENFOLK" });
        if (String(url).endsWith("conversations.info"))
          return Response.json({ ok: true, channel: { id: "CEMMA", is_member: true } });
        assert.ok(String(url).endsWith("chat.postMessage"));
        posts.push(JSON.parse(String(init?.body)));
        return Response.json({ ok: true, channel: "CEMMA", ts: "1790000000.000001" });
      },
    },
  );
  return { result, posts, failures };
}
test("Slack report escapes malicious mentions and disables automatic name/link parsing", async () => {
  const result = await delivery("Caller: <!channel> <@UOTHER> & <https://phish.invalid|Click me>");
  assert.equal(result.result.delivered, true);
  assert.match(String(result.posts[0].text), /&lt;!channel&gt; &lt;@UOTHER&gt; &amp;/);
  assert.equal(result.posts[0].link_names, false);
  assert.equal(result.posts[0].parse, "none");
});
test("escaping-expanded report exceeding Slack bound never posts partial evidence", async () => {
  const result = await delivery("&".repeat(7_000));
  assert.deepEqual(result.result, { delivered: false, uncertain: false });
  assert.equal(result.posts.length, 0);
  assert.deepEqual(result.failures, [{ code: "evidence_too_large", unknown: false }]);
});
test("full reports cannot go to a non-OpenFolk destination", async () => {
  const result = await delivery("Private transcript", "TDRUMMONDS");
  assert.equal(result.posts.length, 0);
  assert.equal(result.result.delivered, false);
});
test("worker loads report pointers with tenant constraints before delivery", () => {
  const source = readFileSync(
    new URL("../../supabase/functions/receptionist-care-worker/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /careFeedbackReport/);
  assert.match(source, /select\("id,tenant_id,call_id,practice_session_id,title,body"\)/);
  assert.match(source, /\.eq\("tenant_id", tenant\)/);
  assert.match(source, /alert\.reason === "event" && alert\.kind !== "updates"/);
});
