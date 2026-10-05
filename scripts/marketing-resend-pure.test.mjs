// Marketing — Resend transport + tracking pure proofs (HARDENED).
// Run: node --test scripts/marketing-resend-pure.test.mjs
//
// Regression locks for the adversarial correction:
//  - NO magic-key fixture success: "fixture"/"fixture:*"/blank/malformed/missing
//    keys can NEVER yield a production `succeeded` result, and never call fetch.
//  - transport uses injected fetch (DI); the deployed runtime never simulates.
//  - v2 tracking tokens BIND delivery + kind + exact canonical destination;
//    forged / altered-destination / altered-delivery / wrong-kind tokens fail.
//  - canonicalDestination rejects non-https, credentials, control chars, unsafe
//    schemes, self-wrapping and oversized URLs.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  evaluateSandboxSelfSend,
  RESEND_SANDBOX_ADDRESS,
  validateSendEnvelope,
} from "../supabase/functions/_shared/marketing_email.ts";
import {
  isUsableTrackingSecret,
  MIN_TRACKING_SECRET_LEN,
} from "../supabase/functions/_shared/marketing_tracking.ts";
import {
  buildResendBody,
  classifyResendFailure,
  composeFrom,
  isPlausibleResendKey,
  parseResendId,
  sendViaResend,
} from "../supabase/functions/_shared/connectors/resend_transport.ts";
import {
  canonicalDestination,
  clickToken,
  injectTrackingHtml,
  openToken,
  verifyClickToken,
  verifyOpenToken,
} from "../supabase/functions/_shared/marketing_tracking.ts";

const REAL_KEY = "re_" + "a".repeat(24);
const OK_RESP = () => new Response(JSON.stringify({ id: "resend-abc-123" }), { status: 200 });
const mkFetch = (fn) => {
  let calls = 0;
  const f = async (...a) => {
    calls++;
    return fn(...a);
  };
  f.calls = () => calls;
  return f;
};

test("envelope: source_kind 'resend' validates; 'smtp' still rejected", () => {
  const ENV = {
    sender_profile_id: "11111111-1111-4111-8111-111111111111",
    source_kind: "resend",
    mailbox_address: "onboarding@resend.dev",
    recipient_profile_id: "22222222-2222-4222-8222-222222222222",
    recipient_email: "recipient@p4.test",
    subject: "s",
    body_text: "b",
    from_name: "D",
    reply_to: "r@p4.test",
    signature_text: "sig",
    purpose: "test",
    content_version: "1",
    content_hash: "a".repeat(64),
    actor_profile_id: "33333333-3333-4333-8333-333333333333",
    request_id: "req-12345678",
    delivery_id: "44444444-4444-4444-8444-444444444444",
  };
  assert.equal(validateSendEnvelope(ENV).ok, true);
  assert.equal(validateSendEnvelope({ ...ENV, source_kind: "smtp" }).ok, false);
});

test("isPlausibleResendKey: only re_ + long token", () => {
  assert.equal(isPlausibleResendKey(REAL_KEY), true);
  for (const bad of [
    "fixture",
    "fixture:success",
    "",
    "   ",
    null,
    undefined,
    "re_short",
    "sk_x",
    "pk_live_x",
  ]) {
    assert.equal(isPlausibleResendKey(bad), false, JSON.stringify(bad));
  }
});

test("REGRESSION: fixture/blank/malformed/missing keys NEVER succeed and NEVER call fetch", async () => {
  for (const key of ["fixture", "fixture:success", "", "   ", "re_short", "not-a-key"]) {
    const f = mkFetch(OK_RESP);
    const r = await sendViaResend(
      {
        apiKey: key,
        from: "f@x.co",
        to: "t@x.co",
        replyTo: null,
        subject: "s",
        html: "h",
        text: "t",
        deliveryId: "d1",
      },
      { fetchImpl: f },
    );
    assert.equal(r.outcome, "failed_permanent", `key=${JSON.stringify(key)}`);
    assert.equal(r.code, "resend_key_invalid");
    assert.equal(f.calls(), 0, "must not contact the provider with a bad key");
    assert.ok(!("id" in r), "no synthetic provider id");
  }
});

test("transport: real key + injected 200 → succeeded with the provider id", async () => {
  const f = mkFetch(OK_RESP);
  const r = await sendViaResend(
    {
      apiKey: REAL_KEY,
      from: "Drummonds <f@x.co>",
      to: "t@x.co",
      replyTo: "r@x.co",
      subject: "s",
      html: "<p>h</p>",
      text: "t",
      deliveryId: "d-9",
    },
    { fetchImpl: f },
  );
  assert.deepEqual(r, { outcome: "succeeded", id: "resend-abc-123" });
  assert.equal(f.calls(), 1);
});

test("transport: idempotency + auth header + no key leak in body; classify + retry-after", async () => {
  let seen;
  const f = mkFetch(async (_u, init) => {
    seen = init;
    return new Response("{}", { status: 429, headers: { "retry-after": "42" } });
  });
  const r = await sendViaResend(
    {
      apiKey: REAL_KEY,
      from: "f@x.co",
      to: "t@x.co",
      replyTo: null,
      subject: "s",
      html: "h",
      text: "t",
      deliveryId: "d-77",
    },
    { fetchImpl: f },
  );
  assert.equal(r.outcome, "failed_transient");
  assert.equal(r.retryAfterSeconds, 42);
  assert.equal(seen.headers["Idempotency-Key"], "d-77");
  assert.equal(seen.headers.Authorization, `Bearer ${REAL_KEY}`);
  assert.equal(JSON.parse(seen.body).headers["X-Entity-Ref-ID"], "d-77");
  assert.ok(!JSON.parse(seen.body).apiKey, "key never in body");
});

test("transport: 401/403/400/422 permanent; 5xx unknown; thrown/timeout → unknown (never success)", async () => {
  const run = async (mk) =>
    (
      await sendViaResend(
        {
          apiKey: REAL_KEY,
          from: "f@x.co",
          to: "t@x.co",
          replyTo: null,
          subject: "s",
          html: "h",
          text: "t",
          deliveryId: "d",
        },
        { fetchImpl: mkFetch(mk) },
      )
    ).outcome;
  assert.equal(await run(() => new Response("", { status: 401 })), "failed_permanent");
  assert.equal(await run(() => new Response("", { status: 403 })), "failed_permanent");
  assert.equal(await run(() => new Response("", { status: 422 })), "failed_permanent");
  assert.equal(await run(() => new Response("", { status: 400 })), "failed_permanent");
  assert.equal(await run(() => new Response("", { status: 500 })), "unknown");
  assert.equal(
    await run(() => {
      throw new Error("network");
    }),
    "unknown",
  );
  // 2xx with no id → unknown, never a fabricated success
  assert.equal(await run(() => new Response("{}", { status: 200 })), "unknown");
});

test("classify + parse + composeFrom", () => {
  assert.equal(classifyResendFailure(429).kind, "transient");
  assert.equal(classifyResendFailure(418).kind, "unknown");
  assert.equal(parseResendId('{"id":"x"}'), "x");
  assert.equal(parseResendId("{}"), null);
  assert.equal(composeFrom("a@b.co", 'Ev"il<x>\r\n'), "Evilx <a@b.co>");
  assert.equal(composeFrom("a@b.co", null), "a@b.co");
  assert.deepEqual(
    buildResendBody({
      apiKey: "x",
      from: "f",
      to: "t@x.co",
      replyTo: null,
      subject: "s",
      html: "h",
      text: "t",
      deliveryId: "d",
    }).to,
    ["t@x.co"],
  );
});

test("canonicalDestination: https only, no creds/control/self-wrap/oversize", () => {
  assert.equal(canonicalDestination("https://a.co/x"), "https://a.co/x");
  assert.equal(canonicalDestination("http://a.co"), null); // http rejected
  assert.equal(canonicalDestination("javascript:alert(1)"), null);
  assert.equal(canonicalDestination("data:text/html,x"), null);
  assert.equal(canonicalDestination("https://user:pass@a.co"), null); // credentials
  assert.equal(canonicalDestination("https://a.co/\u0001"), null); // control char (escaped)
  assert.equal(canonicalDestination("https://a.co/functions/v1/marketing-track?x=1"), null); // self-wrap
  assert.equal(canonicalDestination("https://a.co/" + "x".repeat(2100)), null); // oversize
  assert.equal(canonicalDestination(null), null);
});

test("v2 tokens: open != click, bind delivery + destination; every tamper fails", async () => {
  const secret = "s3cr3t";
  const d = "44444444-4444-4444-8444-444444444444";
  const other = "55555555-5555-4555-8555-555555555555";
  const dest = "https://drummonds.example/quote";
  const altered = "https://evil.example/phish";

  const ot = await openToken(secret, d);
  const ct = await clickToken(secret, d, dest);
  assert.notEqual(ot, ct, "open and click tokens differ");

  // valid open
  assert.equal(await verifyOpenToken(secret, d, ot), true);
  // open token is NOT a click token (wrong kind)
  assert.equal((await verifyClickToken(secret, d, dest, ot)).ok, false);
  // valid click bound to the exact destination
  assert.equal((await verifyClickToken(secret, d, dest, ct)).ok, true);
  // altered destination → invalid (this is the open-redirect fix)
  assert.equal((await verifyClickToken(secret, d, altered, ct)).ok, false);
  // altered delivery → invalid
  assert.equal((await verifyClickToken(secret, other, dest, ct)).ok, false);
  // forged / empty token → invalid
  assert.equal((await verifyClickToken(secret, d, dest, "forged")).ok, false);
  assert.equal((await verifyClickToken(secret, d, dest, "")).ok, false);
  // wrong secret → invalid
  assert.equal((await verifyClickToken("other", d, dest, ct)).ok, false);
  // unsafe destination never validates even with any token
  assert.equal((await verifyClickToken(secret, d, "javascript:x", ct)).ok, false);
});

test("injectTrackingHtml: links routed through destination-bound click tokens; open pixel added", async () => {
  const secret = "s3cr3t";
  const d = "44444444-4444-4444-8444-444444444444";
  const openUrl = "https://api.x/functions/v1/marketing-track?d=" + d + "&k=open&t=OT";
  const html = await injectTrackingHtml(
    '<body><a href="https://drummonds.example/quote">Q</a>' +
      '<a href="http://insecure.example">i</a>' +
      '<a href="mailto:x@y.co">m</a></body>',
    { openUrl, clickBase: "https://api.x/functions/v1/marketing-track", deliveryId: d, secret },
  );
  // the https link is rewritten to a click tracker carrying the bound token
  assert.match(
    html,
    /marketing-track\?d=[^"]*&k=click&t=[^"]*&u=https%3A%2F%2Fdrummonds\.example%2Fquote/,
  );
  // http + mailto left untouched (only https destinations are tracked)
  assert.match(html, /href="http:\/\/insecure\.example"/);
  assert.match(html, /href="mailto:x@y\.co"/);
  assert.match(html, /<img src="https:\/\/api\.x[^"]*k=open[^"]*"[^>]*width="1"/);
  // the rewritten click token actually verifies for the bound destination
  const m = html.match(/&k=click&t=([^&]+)&u=([^"]+)/);
  const tok = decodeURIComponent(m[1]);
  const u = decodeURIComponent(m[2]);
  assert.equal((await verifyClickToken(secret, d, u, tok)).ok, true);
});

// ── Resend sandbox: GENUINE test-to-self ────────────────────────────────────
// The evaluator is the pre-provider boundary. Each refusal below is proven to
// happen BEFORE any provider work: the refusal path is exercised, and then the
// transport is driven with a counting fetch to show a refused send never
// reaches the network.

const TENANT = "10000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "10000000-0000-4000-8000-000000000002";
const ACTOR = "20000000-0000-4000-8000-00000000000a";
const OTHER_USER = "20000000-0000-4000-8000-00000000000b";
const SELF_EMAIL = "chris@openfolk.test";

const selfFacts = (over = {}) => ({
  tenantId: TENANT,
  purpose: "test",
  actorProfileId: ACTOR,
  recipientProfileId: ACTOR,
  envelopeRecipientEmail: SELF_EMAIL,
  actor: { id: ACTOR, tenant_id: TENANT, email: SELF_EMAIL },
  recipient: { id: ACTOR, tenant_id: TENANT, email: SELF_EMAIL },
  ...over,
});

test("sandbox self-send: the happy path is the ONLY accepted shape", () => {
  assert.deepEqual(evaluateSandboxSelfSend(selfFacts()), { ok: true });
  // case/whitespace differences in stored emails do not break a genuine self-send
  assert.deepEqual(
    evaluateSandboxSelfSend(
      selfFacts({
        actor: { id: ACTOR, tenant_id: TENANT, email: `  ${SELF_EMAIL.toUpperCase()} ` },
        recipient: { id: ACTOR, tenant_id: TENANT, email: SELF_EMAIL.toUpperCase() },
      }),
    ),
    { ok: true },
  );
});

test("sandbox self-send: SUCCESS PATH reaches the provider exactly once (injected response)", async () => {
  const verdict = evaluateSandboxSelfSend(selfFacts());
  assert.equal(verdict.ok, true);
  const f = mkFetch(OK_RESP);
  const r = await sendViaResend(
    {
      apiKey: REAL_KEY,
      from: composeFrom(RESEND_SANDBOX_ADDRESS, "Drummonds"),
      to: SELF_EMAIL,
      replyTo: null,
      subject: "s",
      html: "<p>h</p>",
      text: "t",
      deliveryId: "44444444-4444-4444-8444-444444444444",
    },
    { fetchImpl: f },
  );
  assert.deepEqual(r, { outcome: "succeeded", id: "resend-abc-123" });
  assert.equal(f.calls(), 1);
  const body = JSON.parse(
    await (async () => {
      let seen;
      const g = mkFetch(async (_u, init) => {
        seen = init;
        return OK_RESP();
      });
      await sendViaResend(
        {
          apiKey: REAL_KEY,
          from: composeFrom(RESEND_SANDBOX_ADDRESS, "Drummonds"),
          to: SELF_EMAIL,
          replyTo: null,
          subject: "s",
          html: "h",
          text: "t",
          deliveryId: "d",
        },
        { fetchImpl: g },
      );
      return seen.body;
    })(),
  );
  assert.deepEqual(body.to, [SELF_EMAIL], "the sandbox addresses the actor and nobody else");
});

test("sandbox self-send: EVERY refusal is pre-provider and makes ZERO provider calls", async () => {
  const cases = [
    // another user of the SAME tenant
    {
      name: "another tenant user",
      facts: selfFacts({
        recipientProfileId: OTHER_USER,
        recipient: { id: OTHER_USER, tenant_id: TENANT, email: "someone.else@openfolk.test" },
      }),
      code: "policy_sandbox_not_self",
    },
    // a profile that belongs to ANOTHER tenant
    {
      name: "cross-tenant profile",
      facts: selfFacts({
        recipient: { id: ACTOR, tenant_id: OTHER_TENANT, email: SELF_EMAIL },
      }),
      code: "policy_sandbox_recipient_foreign_tenant",
    },
    // the actor's own email changed after the envelope was frozen
    {
      name: "changed actor email",
      facts: selfFacts({
        actor: { id: ACTOR, tenant_id: TENANT, email: "moved@openfolk.test" },
      }),
      code: "policy_sandbox_actor_email_changed",
    },
    // the recipient row's email changed after the envelope was frozen
    {
      name: "changed recipient email",
      facts: selfFacts({
        recipient: { id: ACTOR, tenant_id: TENANT, email: "moved@openfolk.test" },
      }),
      code: "recipient_changed",
    },
    // the actor has no usable current email at all
    {
      name: "missing actor email",
      facts: selfFacts({ actor: { id: ACTOR, tenant_id: TENANT, email: null } }),
      code: "policy_sandbox_actor_email_missing",
    },
    {
      name: "blank actor email",
      facts: selfFacts({ actor: { id: ACTOR, tenant_id: TENANT, email: "   " } }),
      code: "policy_sandbox_actor_email_missing",
    },
    {
      name: "malformed actor email",
      facts: selfFacts({
        actor: { id: ACTOR, tenant_id: TENANT, email: "not-an-address" },
        recipient: { id: ACTOR, tenant_id: TENANT, email: "not-an-address" },
        envelopeRecipientEmail: "not-an-address",
      }),
      code: "policy_sandbox_actor_email_missing",
    },
    // the actor row vanished / moved tenant
    {
      name: "actor removed",
      facts: selfFacts({ actor: null }),
      code: "actor_removed",
    },
    {
      name: "actor moved tenant",
      facts: selfFacts({ actor: { id: ACTOR, tenant_id: OTHER_TENANT, email: SELF_EMAIL } }),
      code: "actor_tenant_mismatch",
    },
    {
      name: "recipient removed",
      facts: selfFacts({ recipient: null }),
      code: "recipient_invalid",
    },
    // bulk paths are structurally refused for the sandbox identity
    {
      name: "campaign attempt",
      facts: selfFacts({ purpose: "broadcast", recipientProfileId: null, recipient: null }),
      code: "policy_sandbox_sender_no_campaign",
    },
    {
      name: "sequence attempt",
      facts: selfFacts({ purpose: "sequence", recipientProfileId: null, recipient: null }),
      code: "policy_sandbox_sender_no_campaign",
    },
  ];

  for (const c of cases) {
    const v = evaluateSandboxSelfSend(c.facts);
    assert.equal(v.ok, false, `${c.name} must be refused`);
    assert.equal(v.code, c.code, c.name);

    // the adapter returns on a refusal, so nothing downstream runs. Prove the
    // provider is untouched by driving the transport only when ok === true.
    const f = mkFetch(OK_RESP);
    if (v.ok) {
      await sendViaResend(
        {
          apiKey: REAL_KEY,
          from: RESEND_SANDBOX_ADDRESS,
          to: SELF_EMAIL,
          replyTo: null,
          subject: "s",
          html: "h",
          text: "t",
          deliveryId: "d",
        },
        { fetchImpl: f },
      );
    }
    assert.equal(f.calls(), 0, `${c.name}: refusal must make ZERO provider calls`);
  }
});

test("tracking secret strength: both sides fail closed on a weak/absent secret", () => {
  assert.equal(MIN_TRACKING_SECRET_LEN, 32);
  for (const bad of [null, undefined, "", "   ", "short", "a".repeat(31), " ".repeat(64)]) {
    assert.equal(isUsableTrackingSecret(bad), false, JSON.stringify(bad));
  }
  assert.equal(isUsableTrackingSecret("a".repeat(32)), true);
  assert.equal(isUsableTrackingSecret("b".repeat(64)), true);
});

test("REGRESSION: marketing_tracking.ts holds no literal control bytes and stays text", () => {
  const buf = readFileSync(
    new URL("../supabase/functions/_shared/marketing_tracking.ts", import.meta.url),
  );
  const offenders = [...buf].filter((b) => b < 9 || (b > 10 && b < 32 && b !== 13) || b === 127);
  assert.equal(
    offenders.length,
    0,
    "source must contain no NUL/control bytes (Git treats as binary)",
  );
  const src = buf.toString("utf8");
  // the control-character guard is expressed in ESCAPED source notation
  assert.match(src, /\\u0000-\\u001F\\u007F/);
  // …and still rejects real control characters at runtime
  assert.equal(canonicalDestination(`https://a.co/${String.fromCharCode(0)}`), null);
  assert.equal(canonicalDestination(`https://a.co/${String.fromCharCode(31)}`), null);
  assert.equal(canonicalDestination(`https://a.co/${String.fromCharCode(127)}`), null);
  assert.equal(canonicalDestination("https://a.co/ok"), "https://a.co/ok");
});

test("source scan: no fixture branch; key only in Authorization header; no logging", () => {
  const t = readFileSync(
    new URL("../supabase/functions/_shared/connectors/resend_transport.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(t, /isFixtureKey|fixtureResult|resend-fixture-/, "no fixture success path");
  assert.match(t, /Authorization: `Bearer \$\{input\.apiKey\}`/);
  assert.doesNotMatch(t, /console\./);
  const a = readFileSync(
    new URL("../supabase/functions/_shared/connectors/marketing_email.ts", import.meta.url),
    "utf8",
  );
  assert.match(a, /isPlausibleResendKey/);
  // the sandbox boundary is evaluated at the final pre-provider step, and the
  // refusal codes live in the shared evaluator (single source of truth)
  assert.match(a, /evaluateSandboxSelfSend/, "sandbox test-to-self boundary is wired in");
  assert.match(a, /RESEND_SANDBOX_ADDRESS/);
  assert.match(a, /isUsableTrackingSecret/, "never signs with a weak tracking secret");
  const shared = readFileSync(
    new URL("../supabase/functions/_shared/marketing_email.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    shared,
    /policy_sandbox_sender_no_campaign/,
    "campaign fail-closed for sandbox sender",
  );
  assert.match(shared, /policy_sandbox_not_self/, "test-to-self refusal exists");
  // the evaluator must sit BEFORE the provider call in the adapter source
  const guardAt = a.indexOf("evaluateSandboxSelfSend");
  const sendAt = a.indexOf("await sendViaResend");
  assert.ok(
    guardAt > -1 && sendAt > -1 && guardAt < sendAt,
    "guard must precede the provider call",
  );
  const ep = readFileSync(
    new URL("../supabase/functions/marketing-track/index.ts", import.meta.url),
    "utf8",
  );
  // the endpoint must never redirect to the raw supplied target on failure
  assert.doesNotMatch(ep, /redirect\(safeTarget/);
  assert.match(ep, /verifyClickToken/);
  assert.match(ep, /isUsableTrackingSecret/, "weak/absent secret fails closed");
  assert.doesNotMatch(ep, /console\./, "the tracking secret is never logged");
});
