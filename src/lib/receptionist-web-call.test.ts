import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  webCallToken,
  definitiveWebCallRejection,
  practiceCallMatches,
} from "../../supabase/functions/_shared/receptionist-web-call.ts";
test("web-call JWT has the correct public scope, organisation and 60-second expiry", async () => {
  const org = "ad200000-0000-0000-0000-000000000001",
    key = "unit-test-only";
  const token = await webCallToken(key, org, 1000);
  const [header, payload, sig] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), {
    alg: "HS256",
    typ: "JWT",
  });
  const p = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.equal(p.orgId, org);
  assert.equal(p.iat, 1000);
  assert.equal(p.exp, 1060);
  assert.equal(p.token.tag, "public");
  assert.equal(p.token.restrictions.allowTransientAssistant, true);
  assert.equal(
    sig,
    createHmac("sha256", key)
      .update(header + "." + payload)
      .digest("base64url"),
  );
  assert.ok(!payload.includes(key));
});
test("invalid org/key refuses before a provider request", async () => {
  await assert.rejects(() => webCallToken("", "ad200000-0000-0000-0000-000000000001"));
  await assert.rejects(() => webCallToken("unit-test-only", "../../other"));
});
test("known rejections release overlap but ambiguous failures do not", () => {
  for (const code of [400, 401, 403, 404, 405, 422, 429])
    assert.equal(definitiveWebCallRejection(code), true);
  for (const code of [408, 409, 500, 502, 503, 504])
    assert.equal(definitiveWebCallRejection(code), false);
});
test("practice evidence requires web type and both tenant and session in assistant metadata", () => {
  const c = {
    type: "webCall",
    assistant: { metadata: { openfolkPracticeSession: "session", openfolkTenant: "tenant" } },
  };
  assert.equal(practiceCallMatches(c, "session", "tenant"), true);
  assert.equal(practiceCallMatches(c, "other", "tenant"), false);
  assert.equal(practiceCallMatches(c, "session", "other"), false);
  assert.equal(
    practiceCallMatches({ ...c, type: "outboundPhoneCall" }, "session", "tenant"),
    false,
  );
  assert.equal(practiceCallMatches({ metadata: c.assistant.metadata }, "session", "tenant"), false);
});
