// Marketing — Resend transport pure proofs.
// Run: node --test scripts/marketing-resend-pure.test.mjs
//
// No network, no DB. Proves: the frozen envelope accepts the `resend` source
// kind (and still rejects unknown kinds); the Resend transport builds the
// correct provider body from the frozen values only; classification is
// conservative (429 transient, auth/validation permanent, 5xx/lost unknown);
// the fixture key short-circuits without network; and the deployed adapter
// source carries no token in results and reads the key only from Deno.env.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { validateSendEnvelope } from "../supabase/functions/_shared/marketing_email.ts";
import {
  buildResendBody,
  classifyResendFailure,
  composeFrom,
  fixtureResult,
  isFixtureKey,
  parseResendId,
  sendViaResend,
} from "../supabase/functions/_shared/connectors/resend_transport.ts";
import {
  injectTrackingHtml,
  safeRedirectTarget,
  trackingToken,
  verifyTrackingToken,
} from "../supabase/functions/_shared/marketing_tracking.ts";

const ENVELOPE = {
  sender_profile_id: "11111111-1111-4111-8111-111111111111",
  source_kind: "gmail_oauth",
  mailbox_address: "sender@p4.test",
  recipient_profile_id: "22222222-2222-4222-8222-222222222222",
  recipient_email: "recipient@p4.test",
  subject: "Phase 4 test",
  body_text: "Hello.",
  from_name: "Drummonds",
  reply_to: "reply@p4.test",
  signature_text: "The team",
  purpose: "test",
  content_version: "1",
  content_hash: "a".repeat(64),
  actor_profile_id: "33333333-3333-4333-8333-333333333333",
  request_id: "req-12345678",
  delivery_id: "44444444-4444-4444-8444-444444444444",
};

test("envelope: source_kind 'resend' validates; 'smtp' still rejected", () => {
  assert.equal(validateSendEnvelope({ ...ENVELOPE, source_kind: "resend" }).ok, true);
  assert.equal(validateSendEnvelope({ ...ENVELOPE, source_kind: "smtp" }).ok, false);
  assert.equal(validateSendEnvelope({ ...ENVELOPE, source_kind: "gmail_oauth" }).ok, true);
});

test("composeFrom: name + address, sanitised; bare address when no name", () => {
  assert.equal(composeFrom("a@b.co", "Drummonds"), "Drummonds <a@b.co>");
  assert.equal(composeFrom("a@b.co", null), "a@b.co");
  // header-injection chars stripped from the display name
  assert.equal(composeFrom("a@b.co", 'Ev"il<x>\r\n'), "Evilx <a@b.co>");
});

test("buildResendBody: exact provider shape from frozen values only", () => {
  const body = buildResendBody({
    apiKey: "fixture",
    from: "Drummonds <from@x.co>",
    to: "to@x.co",
    replyTo: "reply@x.co",
    subject: "Hi",
    html: "<p>Hi</p>",
    text: "Hi",
    deliveryId: "d-1",
  });
  assert.equal(body.from, "Drummonds <from@x.co>");
  assert.deepEqual(body.to, ["to@x.co"]);
  assert.equal(body.subject, "Hi");
  assert.equal(body.html, "<p>Hi</p>");
  assert.equal(body.text, "Hi");
  assert.equal(body.reply_to, "reply@x.co");
  assert.deepEqual(body.headers, { "X-Entity-Ref-ID": "d-1" });
  // no reply_to key when absent
  const body2 = buildResendBody({
    apiKey: "fixture",
    from: "from@x.co",
    to: "to@x.co",
    replyTo: null,
    subject: "Hi",
    html: "h",
    text: "t",
    deliveryId: "d-2",
  });
  assert.equal("reply_to" in body2, false);
});

test("classifyResendFailure: conservative mapping", () => {
  assert.equal(classifyResendFailure(429, "").kind, "transient");
  assert.equal(classifyResendFailure(401, "").kind, "permanent");
  assert.equal(classifyResendFailure(403, "").kind, "permanent");
  assert.equal(classifyResendFailure(422, "").kind, "permanent");
  assert.equal(classifyResendFailure(400, "").kind, "permanent");
  assert.equal(classifyResendFailure(500, "").kind, "unknown");
  assert.equal(classifyResendFailure(503, "").kind, "unknown");
  assert.equal(classifyResendFailure(418, "").kind, "unknown");
});

test("parseResendId: id extracted; junk → null", () => {
  assert.equal(parseResendId('{"id":"abc-123"}'), "abc-123");
  assert.equal(parseResendId('{"id":""}'), null);
  assert.equal(parseResendId("not json"), null);
  assert.equal(parseResendId("{}"), null);
});

test("fixture key: recognised and short-circuits every outcome without network", async () => {
  assert.equal(isFixtureKey("fixture"), true);
  assert.equal(isFixtureKey("fixture:unknown"), true);
  assert.equal(isFixtureKey("re_live_realkey"), false);

  assert.deepEqual(fixtureResult("fixture", "d-9"), {
    outcome: "succeeded",
    id: "resend-fixture-d-9",
  });
  assert.equal(fixtureResult("fixture:fail_permanent", "d").outcome, "failed_permanent");
  assert.equal(fixtureResult("fixture:fail_transient", "d").outcome, "failed_transient");
  assert.equal(fixtureResult("fixture:unknown", "d").outcome, "unknown");

  // sendViaResend with a fixture key never touches the network
  const r = await sendViaResend({
    apiKey: "fixture",
    from: "f@x.co",
    to: "t@x.co",
    replyTo: null,
    subject: "s",
    html: "h",
    text: "t",
    deliveryId: "d-42",
  });
  assert.deepEqual(r, { outcome: "succeeded", id: "resend-fixture-d-42" });
});

test("tracking token: deterministic, verifies, rejects tamper/wrong-kind", async () => {
  const secret = "s3cr3t-staging";
  const d = "44444444-4444-4444-8444-444444444444";
  const openTok = await trackingToken(secret, d, "open");
  const clickTok = await trackingToken(secret, d, "click");
  assert.equal(openTok, await trackingToken(secret, d, "open")); // deterministic
  assert.notEqual(openTok, clickTok); // kind-bound
  assert.equal(await verifyTrackingToken(secret, d, "open", openTok), true);
  assert.equal(await verifyTrackingToken(secret, d, "open", clickTok), false); // wrong kind
  assert.equal(await verifyTrackingToken(secret, d, "open", openTok + "x"), false); // tampered
  assert.equal(await verifyTrackingToken("other", d, "open", openTok), false); // wrong secret
});

test("injectTrackingHtml: rewrites http links, adds pixel, leaves non-http anchors", () => {
  const inj = {
    openUrl: "https://api.x/functions/v1/marketing-track?d=D&k=open&t=OT",
    clickBase: "https://api.x/functions/v1/marketing-track",
    clickToken: "CT",
    deliveryId: "D",
  };
  const html = injectTrackingHtml(
    '<body><a href="https://drummonds.example/quote">Quote</a>' +
      '<a href="mailto:x@y.co">mail</a><a href="#top">top</a></body>',
    inj,
  );
  assert.match(
    html,
    /href="https:\/\/api\.x\/functions\/v1\/marketing-track\?d=D&k=click&t=CT&u=https%3A%2F%2Fdrummonds\.example%2Fquote"/,
  );
  assert.match(html, /href="mailto:x@y\.co"/); // untouched
  assert.match(html, /href="#top"/); // untouched
  assert.match(html, /<img src="https:\/\/api\.x[^"]*k=open[^"]*"[^>]*width="1"/);
  assert.match(html, /<\/body>/); // pixel inserted before close, body preserved
});

test("safeRedirectTarget: only http(s), bounded; everything else null", () => {
  assert.equal(safeRedirectTarget("https://a.co/x"), "https://a.co/x");
  assert.equal(safeRedirectTarget("http://a.co"), "http://a.co/");
  assert.equal(safeRedirectTarget("javascript:alert(1)"), null);
  assert.equal(safeRedirectTarget("data:text/html,x"), null);
  assert.equal(safeRedirectTarget("not a url"), null);
  assert.equal(safeRedirectTarget(null), null);
  assert.equal(safeRedirectTarget("https://a.co/" + "x".repeat(2100)), null);
});

test("source scan: adapter reads RESEND_API_KEY only from Deno.env; no token in any result", () => {
  const src = readFileSync(
    new URL("../supabase/functions/_shared/connectors/marketing_email.ts", import.meta.url),
    "utf8",
  );
  // key is resolved server-side from the environment, never a payload field
  assert.match(src, /Deno[\s\S]*?\.env[\s\S]*?get\("RESEND_API_KEY"\)/);
  // the success result carries the provider message id + transport tag, never the key
  assert.match(src, /transport: "resend"/);
  assert.doesNotMatch(src, /Bearer \$\{apiKey\}/); // the fetch lives in the transport module, not the adapter
  const t = readFileSync(
    new URL("../supabase/functions/_shared/connectors/resend_transport.ts", import.meta.url),
    "utf8",
  );
  // the key rides only the Authorization header, never the JSON body or a log
  assert.match(t, /Authorization: `Bearer \$\{input\.apiKey\}`/);
  assert.doesNotMatch(t, /console\./);
});
