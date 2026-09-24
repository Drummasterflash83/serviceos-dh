import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  practiceAssistant,
  assistantOverview,
  allowedQueryTools,
  practiceRoom,
  practiceKnowledgeTools,
} from "../../supabase/functions/_shared/receptionist-practice.ts";
const query = "ad200000-0000-0000-0000-000000000001";
test("failed readiness is visible and recheckable instead of an inert talk button", () => {
  const ui = readFileSync(
    new URL("../components/receptionist/PracticeImprove.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(ui, /disabled=\{demo \|\| !info\.data\?\.enabled\}/);
  assert.match(ui, /unavailableReason/);
  assert.match(ui, /Recheck connection/);
  const edge = readFileSync(
    new URL("../../supabase/functions/receptionist-practice/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(edge, /unavailableReason,/);
  assert.match(edge, /Custom knowledge requires review/);
});
test("practice feedback has reopenable evidence and separates save from Slack delivery", () => {
  const ui = readFileSync(
    new URL("../components/receptionist/PracticeImprove.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /PracticeEvidence/);
  assert.match(ui, /practiceSessionId=\{sessionId\}/);
  assert.match(ui, /d\?\.state === "sent"/);
  assert.match(ui, /Saved · Slack delivery pending/);
  assert.match(ui, /\.eq\("submission_key", submission.current\)/);
});
const source = {
  name: "Emma",
  updatedAt: "2026-09-24T10:00:00Z",
  model: {
    provider: "openai",
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: "# Role\nConnect callers promptly.\n## Finance\nRoute invoice questions to Liz.",
      },
    ],
    toolIds: ["live-transfer"],
    tools: [{ type: "transferCall", destinations: ["real"] }],
    credentialsId: "private",
  },
  voice: {
    provider: "11labs",
    voiceId: "voice",
    model: "eleven_flash_v2_5",
    credentialsId: "secret",
  },
  server: { url: "https://never.example" },
  serverUrl: "https://never.example",
  serverMessages: ["tool-calls"],
  artifactPlan: { storage: { credentialsId: "secret" } },
  forwardingPhoneNumber: "real",
  firstMessage: "Welcome",
  maxDurationSeconds: 9999,
};
const fileQuery = {
  type: "query",
  function: { name: "drummond_knowledge", description: "Look up company guidance" },
  knowledgeBases: [
    {
      provider: "google",
      name: "Drummond guidance",
      description: "Approved company documents",
      model: "gemini-2.5-flash",
      fileIds: [query],
    },
  ],
};
test("inline file-backed knowledge works alongside saved query IDs without changing its files or name", () => {
  const input = {
    ...source,
    model: {
      ...source.model,
      tools: [fileQuery, { type: "transferCall", destinations: ["real"] }],
    },
  };
  const before = JSON.stringify(input);
  const a = practiceAssistant(input, [query]);
  assert.deepEqual(a.model.tools, [fileQuery]);
  assert.deepEqual(a.model.toolIds, [query]);
  assert.equal(JSON.stringify(input), before);
  assert.equal(a.maxDurationSeconds, 180);
  assert.deepEqual(a.serverMessages, []);
  assert.ok(!JSON.stringify(a).includes("destinations"));
});
test("inline query projection never copies hooks, credentials, messages or arbitrary tools", () => {
  const [result] = practiceKnowledgeTools({
    tools: [
      {
        ...fileQuery,
        hooks: [{ url: "https://never.example" }],
        messages: [{ type: "request-start", content: "irrelevant" }],
        function: { ...fileQuery.function, parameters: { unknown: "not-copied" } },
      },
    ],
  });
  assert.deepEqual(result, fileQuery);
});
test("external and malformed knowledge is rejected, never silently removed", () => {
  for (const patch of [
    { server: { url: "https://never.example" } },
    { serverUrl: "https://never.example" },
    { credentialsId: "private" },
    { async: true },
    { knowledgeBases: [] },
    { function: { name: "bad/name" } },
  ])
    assert.throws(() => practiceKnowledgeTools({ tools: [{ ...fileQuery, ...patch }] }));
  for (const patch of [
    { provider: "custom" },
    { fileIds: ["https://never.example/file"] },
    { fileIds: [] },
    { name: "" },
    { description: null },
    { model: {} },
  ])
    assert.throws(() =>
      practiceKnowledgeTools({
        tools: [{ ...fileQuery, knowledgeBases: [{ ...fileQuery.knowledgeBases[0], ...patch }] }],
      }),
    );
  for (const model of [
    {
      knowledgeBase: {
        provider: "custom-knowledge-base",
        server: { url: "https://never.example" },
      },
    },
    { knowledgeBaseId: query },
    { tools: {} },
  ])
    assert.throws(() => practiceKnowledgeTools(model));
});
test("multiple inline knowledge tools and file sets survive with no server callbacks", () => {
  const other = {
    ...fileQuery,
    function: { name: "service_plans" },
    knowledgeBases: [
      ...fileQuery.knowledgeBases,
      { ...fileQuery.knowledgeBases[0], name: "Plans" },
    ],
  };
  const result = practiceKnowledgeTools({ tools: [fileQuery, other] });
  assert.equal(result.length, 2);
  assert.equal(result[1].knowledgeBases.length, 2);
  assert.deepEqual(result[1].knowledgeBases[1].fileIds, [query]);
});
test("practice is a strict projection; no live tools, destinations, credentials or servers", () => {
  const a = practiceAssistant(source, [query]);
  const text = JSON.stringify(a);
  assert.deepEqual(a.model.toolIds, [query]);
  assert.equal(a.maxDurationSeconds, 180);
  assert.deepEqual(a.serverMessages, []);
  for (const forbidden of [
    "live-transfer",
    "transferCall",
    "never.example",
    "credentialsId",
    "forwardingPhoneNumber",
    "9999",
  ])
    assert.ok(!text.includes(forbidden), forbidden);
  assert.match(a.model.messages[0].content, /Never claim a transfer occurred/);
  assert.equal(a.voice.voiceId, "voice");
  assert.equal(a.model.model, "gpt-4o");
});
test("malformed assistant and unsupported inline knowledge refuse instead of silently degrading", () => {
  for (const s of [
    {},
    { model: {} },
    { ...source, model: { ...source.model, messages: [] } },
    { ...source, model: { ...source.model, knowledgeBase: { server: { url: "https://x" } } } },
    { ...source, model: { ...source.model, tools: [{ type: "query" }] } },
  ])
    assert.throws(() => practiceAssistant(s, []));
});
test("only provider query tools without servers survive practice filtering", () => {
  assert.deepEqual(
    allowedQueryTools([
      { id: query, type: "query" },
      { id: "ad200000-0000-0000-0000-000000000002", type: "transferCall" },
      { id: query, type: "query", server: { url: "x" } },
      { id: query, type: "function" },
      { id: "../../escape", type: "query" },
    ]),
    [query],
  );
});
test("training response contains intended sections, not provider secrets", () => {
  const result = assistantOverview(source, 1, 1);
  assert.equal(result.sections.length, 2);
  assert.equal(result.sections[1].title, "Finance");
  assert.ok(!JSON.stringify(result).includes("credentialsId"));
  assert.equal(result.updatedAt, source.updatedAt);
});
test("practice media URL only permits HTTPS daily subdomains", () => {
  assert.equal(practiceRoom("https://vapi.daily.co/room"), "https://vapi.daily.co/room");
  for (const u of [
    "http://vapi.daily.co/room",
    "https://evil-daily.co/x",
    "https://vapi.daily.co.evil.com/x",
    "https://u:p@vapi.daily.co/x",
    "javascript:alert(1)",
    null,
  ])
    assert.throws(() => practiceRoom(u));
});
test("browser joins a server-created call without a private or public API key", () => {
  const ui = readFileSync(
    new URL("../components/receptionist/PracticeImprove.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /voice\.reconnect/);
  assert.doesNotMatch(ui, /\.start\(/);
  assert.match(ui, /submission_key/);
  assert.match(ui, /practice_session_id/);
  assert.match(ui, /Slack delivery pending/);
  assert.match(ui, /sdk\.current\?\.stop/);
});
test("practice creation is authenticated and database-reserved before any paid provider call", () => {
  const edge = readFileSync(
    new URL("../../supabase/functions/receptionist-practice/index.ts", import.meta.url),
    "utf8",
  );
  assert.ok(edge.indexOf("db.auth.getUser") < edge.indexOf("reserve_receptionist_practice"));
  assert.ok(edge.indexOf("reserve_receptionist_practice") < edge.indexOf('provider("call",'));
  assert.match(edge, /openfolkPracticeSession/);
  assert.match(edge, /roomDeleteOnUserLeaveEnabled: true/);
});
