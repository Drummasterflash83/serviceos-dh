import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { careEvidenceReference, careEvidenceRequest } from "./care-evidence.ts";
const tenant = "00000000-0000-0000-0000-000000000001";
const call = "00000000-0000-0000-0000-000000000002";
const session = "00000000-0000-0000-0000-000000000003";
const other = "00000000-0000-0000-0000-000000000004";
test("automated findings resolve only the canonical call pointer", () => {
  assert.deepEqual(careEvidenceReference(`call:${call}:repetition`), {
    callId: call,
    practiceSessionId: null,
  });
  assert.throws(() => careEvidenceReference(`call:${call}:invented_category`));
  assert.throws(() => careEvidenceReference(`call:../../secret:repetition`));
});
test("feedback can bind a practice session without inventing a call from its text", () => {
  assert.deepEqual(
    careEvidenceReference("feedback:source", { call_id: call, practice_session_id: session }),
    { callId: call, practiceSessionId: session },
  );
  assert.deepEqual(
    careEvidenceReference("feedback:source", { call_id: null, practice_session_id: null }),
    { callId: null, practiceSessionId: null },
  );
  assert.equal(careEvidenceRequest(tenant, null), null);
});
test("conflicting call pointers fail rather than silently selecting one", () => {
  assert.throws(
    () =>
      careEvidenceReference(`call:${call}:repetition`, {
        call_id: other,
        practice_session_id: null,
      }),
    /do not match/,
  );
  assert.throws(
    () => careEvidenceReference("feedback:source", { call_id: "bad", practice_session_id: null }),
    /invalid/,
  );
});
test("practice evidence requests the saved session result, never a new call", () => {
  assert.deepEqual(careEvidenceRequest(tenant, call, { id: session, call_id: call }), {
    endpoint: "receptionist-practice",
    body: { tenantId: tenant, action: "result", sessionId: session },
    callId: call,
  });
  assert.throws(
    () => careEvidenceRequest(tenant, call, { id: session, call_id: other }),
    /do not match/,
  );
  assert.throws(
    () => careEvidenceRequest(tenant, null, { id: session, call_id: null }),
    /not available yet/,
  );
});
test("phone evidence uses the existing tenant-bound detail endpoint", () => {
  assert.deepEqual(careEvidenceRequest(tenant, call), {
    endpoint: "receptionist-calls",
    body: { tenantId: tenant, action: "detail", callId: call },
    callId: call,
  });
  assert.throws(() => careEvidenceRequest("wrong-tenant", call), /invalid/);
});
test("evidence component scopes all records and cache to the current tenant and viewer", () => {
  const source = readFileSync(
    new URL("../components/app/CareEvidence.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /queryKey: \["care-call-evidence", user\?\.id, tenantId, issueId, sourceKey, feedbackId\]/,
  );
  assert.equal((source.match(/\.eq\("tenant_id", tenantId\)/g) ?? []).length, 2);
  assert.match(source, /\.eq\("id", feedbackId\)/);
  assert.match(source, /result.data\?\.call\?\.id !== request.callId/);
  assert.match(source, /result.data\?\.session\?\.tenant_id !== tenantId/);
  assert.match(source, /gcTime: 0/);
});
test("recording remains an authenticated click-to-play action, not an external saved link", () => {
  const source = readFileSync(
    new URL("../components/app/CareEvidence.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /recording: null/);
  assert.match(source, /<CallRecording/);
  assert.match(source, /autoLoad=\{false\}/);
  assert.match(source, /practiceSessionId=\{evidence.data\?\.practiceSessionId\}/);
  assert.doesNotMatch(source, /window.open|localStorage|autoPlay|action: "start"|action: "end"/);
  assert.match(source, /Transcript not supplied for this call/);
  assert.match(source, /transcript alone\s+does not prove/);
});
