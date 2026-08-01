// ServiceOS — Marketing Phase 8 pure-boundary proofs (node --test, NO network,
// NO database, NO provider):
//   1. The signed-webhook boundary: HMAC-SHA256 over timestamp + EXACT raw
//      bytes; valid/current/previous secrets verify; wrong secret, tampered
//      byte, missing/malformed/stale/future timestamp and malformed signature
//      all refuse; the comparator is length-guarded XOR (constant-time shape).
//   2. The strict versioned payload: unknown keys at EVERY level refuse;
//      schema/event-id/timestamp/field bounds enforced; control characters
//      refuse; an empty lead refuses; the stored envelope carries only the
//      bounded normalised fields — no signature, secret or raw body.
//   3. The TRUTHFUL adapter catalogue: exactly ONE implemented ingestion mode
//      (the provider-neutral signed webhook); Meta/Google/LinkedIn/Sheet are
//      Not connected with zero capability flags; nothing claims manual sync.
//   4. Source discipline scans: the webhook receiver returns ONE generic
//      unauthorised response for every auth failure, reads raw bytes before
//      parsing, and never logs a secret or signature.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ADS_WEBHOOK_MAX_BODY_BYTES,
  ADS_WEBHOOK_SCHEMA_VERSION,
  adsWebhookBodyByteLength,
  buildAdsEventEnvelope,
  computeAdsWebhookSignature,
  constantTimeEqual,
  isValidPublicKey,
  parseAdsLeadPayload,
  sha256Hex,
  verifyAdsWebhookSignature,
} from "../supabase/functions/_shared/marketing_ad_webhook.ts";
import {
  ADS_ADAPTER_CATALOGUE,
  adsProviderSupportsIngestion,
  adsProviderSupportsManualSync,
} from "../supabase/functions/_shared/marketing_ads_adapters.ts";

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const NOW = 1_800_000_000_000; // fixed injected clock
const TS = String(Math.floor(NOW / 1000));
const BODY = JSON.stringify({
  schema_version: "ads-lead@1",
  event_id: "evt-123",
  occurred_at: "2026-07-31T10:00:00Z",
  lead: { first_name: "Jo", last_name: "Beam", email: "jo@example.test" },
});

/* ── 1 · signature boundary ───────────────────────────────────────────────── */

test("signature: a correctly signed request verifies", async () => {
  const sig = await computeAdsWebhookSignature(SECRET, TS, BODY);
  const v = await verifyAdsWebhookSignature({
    secrets: { current: SECRET },
    timestampHeader: TS,
    signatureHeader: sig,
    rawBody: BODY,
    nowMs: NOW,
  });
  assert.deepEqual(v, { ok: true });
});

test("signature: rotation — the PREVIOUS secret verifies INSIDE the overlap window", async () => {
  const sig = await computeAdsWebhookSignature(SECRET, TS, BODY);
  const v = await verifyAdsWebhookSignature({
    secrets: {
      current: "a-new-secret-after-rotation-000000000000",
      previous: SECRET,
      previousValidUntilMs: NOW + 1000, // still inside the retirement window
    },
    timestampHeader: TS,
    signatureHeader: sig,
    rawBody: BODY,
    nowMs: NOW,
  });
  assert.deepEqual(v, { ok: true });
});

test("signature: rotation — the previous secret is RETIRED once the overlap lapses", async () => {
  const sig = await computeAdsWebhookSignature(SECRET, TS, BODY);
  // window already expired: a rotated-away secret must NOT verify indefinitely
  const expired = await verifyAdsWebhookSignature({
    secrets: {
      current: "a-new-secret-after-rotation-000000000000",
      previous: SECRET,
      previousValidUntilMs: NOW - 1, // retired
    },
    timestampHeader: TS,
    signatureHeader: sig,
    rawBody: BODY,
    nowMs: NOW,
  });
  assert.deepEqual(expired, { ok: false, reason: "signature_mismatch" });
  // no window marker at all (first configuration, no previous) → never tried
  const noWindow = await verifyAdsWebhookSignature({
    secrets: { current: "a-new-secret-after-rotation-000000000000", previous: SECRET },
    timestampHeader: TS,
    signatureHeader: sig,
    rawBody: BODY,
    nowMs: NOW,
  });
  assert.deepEqual(noWindow, { ok: false, reason: "signature_mismatch" });
});

test("signature: wrong secret / tampered byte / tampered timestamp refuse", async () => {
  const sig = await computeAdsWebhookSignature(SECRET, TS, BODY);
  const wrongSecret = await verifyAdsWebhookSignature({
    secrets: { current: "not-the-secret-000000000000000000000000" },
    timestampHeader: TS,
    signatureHeader: sig,
    rawBody: BODY,
    nowMs: NOW,
  });
  assert.equal(wrongSecret.ok, false);
  const tampered = await verifyAdsWebhookSignature({
    secrets: { current: SECRET },
    timestampHeader: TS,
    signatureHeader: sig,
    rawBody: BODY.replace("Jo", "Yo"),
    nowMs: NOW,
  });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.ok === false && tampered.reason, "signature_mismatch");
  const shiftedTs = await verifyAdsWebhookSignature({
    secrets: { current: SECRET },
    timestampHeader: String(Number(TS) + 1),
    signatureHeader: sig,
    rawBody: BODY,
    nowMs: NOW,
  });
  assert.equal(shiftedTs.ok, false, "the timestamp is inside the signed material");
});

test("body size: the limit is measured in BYTES, not UTF-16 code units", () => {
  // a multibyte body: fewer code units than bytes. The old `.length` check
  // undercounts a CJK/emoji body by up to ~3x and would let it slip past.
  const multibyte = "€".repeat(30000); // 30000 code units, 90000 UTF-8 bytes
  assert.equal(multibyte.length, 30000);
  assert.equal(adsWebhookBodyByteLength(multibyte), 90000);
  assert.ok(
    adsWebhookBodyByteLength(multibyte) > ADS_WEBHOOK_MAX_BODY_BYTES,
    "a 90KB-byte body must exceed the 64KB byte ceiling even though its code-unit length does not",
  );
  assert.ok(multibyte.length < ADS_WEBHOOK_MAX_BODY_BYTES, "code-unit length alone would pass");
  // ASCII: bytes == code units
  assert.equal(adsWebhookBodyByteLength("abc"), 3);
  assert.equal(adsWebhookBodyByteLength(""), 0);
});

test("signature: timestamp freshness window (stale/future/malformed/missing)", async () => {
  const cases = [
    [null, "missing_timestamp"],
    ["", "missing_timestamp"],
    ["12a4", "malformed_timestamp"],
    ["-5", "malformed_timestamp"],
    [String(Number(TS) - 301), "stale_timestamp"],
    [String(Number(TS) + 301), "future_timestamp"],
  ];
  for (const [ts, reason] of cases) {
    const sig = await computeAdsWebhookSignature(SECRET, String(ts ?? ""), BODY);
    const v = await verifyAdsWebhookSignature({
      secrets: { current: SECRET },
      timestampHeader: ts,
      signatureHeader: sig,
      rawBody: BODY,
      nowMs: NOW,
    });
    assert.equal(v.ok, false, String(reason));
    assert.equal(v.ok === false && v.reason, reason, String(ts));
  }
});

test("signature: malformed/missing signature refuses before any comparison", async () => {
  for (const sig of [null, "", "xyz", "ABCD", "ab".repeat(31)]) {
    const v = await verifyAdsWebhookSignature({
      secrets: { current: SECRET },
      timestampHeader: TS,
      signatureHeader: sig,
      rawBody: BODY,
      nowMs: NOW,
    });
    assert.equal(v.ok, false, String(sig));
  }
});

test("comparator: length-guarded XOR equality behaves exactly", () => {
  assert.equal(constantTimeEqual("abcd", "abcd"), true);
  assert.equal(constantTimeEqual("abcd", "abce"), false);
  assert.equal(constantTimeEqual("abcd", "abc"), false);
  assert.equal(constantTimeEqual("", ""), true);
});

test("public key shape: 48 lowercase hex, nothing else routes", () => {
  assert.equal(isValidPublicKey("a".repeat(48)), true);
  assert.equal(isValidPublicKey("A".repeat(48)), false);
  assert.equal(isValidPublicKey("a".repeat(47)), false);
  assert.equal(isValidPublicKey(null), false);
});

/* ── 2 · strict payload contract ──────────────────────────────────────────── */

const GOOD = {
  schema_version: ADS_WEBHOOK_SCHEMA_VERSION,
  event_id: "evt-1",
  occurred_at: "2026-07-31T10:00:00Z",
  lead: { first_name: "Jo", email: "jo@example.test" },
};

test("payload: a valid lead parses and normalises", () => {
  const r = parseAdsLeadPayload(JSON.stringify(GOOD));
  assert.ok(r.ok);
  assert.equal(r.payload.lead.first_name, "Jo");
  assert.equal(r.payload.occurred_at, "2026-07-31T10:00:00.000Z");
});

test("payload: unknown keys refuse at EVERY level", () => {
  for (const bad of [
    { ...GOOD, admin: true },
    { ...GOOD, lead: { ...GOOD.lead, ssn: "x" } },
    { ...GOOD, meta: { utm_source: "a", session_cookie: "x" } },
    { ...GOOD, consent: { basis: "form", granted_all: true } },
  ]) {
    const r = parseAdsLeadPayload(JSON.stringify(bad));
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, "unknown_key");
  }
});

test("payload: schema/event-id/timestamp/bounds/control chars refuse", () => {
  const cases = [
    [{ ...GOOD, schema_version: "ads-lead@2" }, "unsupported_schema"],
    [{ ...GOOD, event_id: "bad space" }, "invalid_event_id"],
    [{ ...GOOD, event_id: "x".repeat(121) }, "invalid_event_id"],
    [{ ...GOOD, occurred_at: "yesterday" }, "invalid_occurred_at"],
    [{ ...GOOD, campaign_ref: "x".repeat(201) }, "invalid_ref"],
    [{ ...GOOD, lead: { first_name: "a b" } }, "invalid_lead_field"],
    [{ ...GOOD, lead: {} }, "empty_lead"],
    [{ ...GOOD, lead: { company: "Acme" } }, "empty_lead"],
  ];
  for (const [payload, code] of cases) {
    const r = parseAdsLeadPayload(JSON.stringify(payload));
    assert.equal(r.ok, false, String(code));
    assert.equal(!r.ok && r.code, code);
  }
  assert.equal(parseAdsLeadPayload("not json").ok, false);
  assert.equal(parseAdsLeadPayload("[1]").ok, false);
});

test("envelope: bounded, redaction-safe, no nulls, no raw body", async () => {
  const r = parseAdsLeadPayload(
    JSON.stringify({
      ...GOOD,
      meta: { utm_source: "meta", utm_campaign: "spring" },
      external_ref: "lead/123",
    }),
  );
  assert.ok(r.ok);
  const env = buildAdsEventEnvelope(r.payload);
  assert.deepEqual(Object.keys(env).sort(), ["external_ref", "lead", "meta", "schema_version"]);
  assert.deepEqual(env.lead, { first_name: "Jo", email: "jo@example.test" });
  // the digest of the exact raw body is a stable dedup key
  const d1 = await sha256Hex("abc");
  const d2 = await sha256Hex("abc");
  assert.equal(d1, d2);
  assert.match(d1, /^[0-9a-f]{64}$/);
});

/* ── 3 · truthful catalogue ───────────────────────────────────────────────── */

test("catalogue: exactly ONE implemented ingestion mode — the signed webhook", () => {
  const implemented = ADS_ADAPTER_CATALOGUE.filter((a) => a.implemented);
  assert.equal(implemented.length, 1);
  assert.equal(implemented[0].provider, "webhook");
  assert.equal(adsProviderSupportsIngestion("webhook"), true);
  for (const p of ["meta", "google_ads", "linkedin", "sheet"]) {
    const a = ADS_ADAPTER_CATALOGUE.find((x) => x.provider === p);
    assert.ok(a, p);
    assert.equal(a.implemented, false, `${p} must be honestly unimplemented`);
    assert.equal(a.defaultConnectionState, "not_connected");
    assert.ok(
      Object.values(a.capabilities).every((v) => v === false),
      `${p} must claim no capability`,
    );
    assert.equal(adsProviderSupportsIngestion(p), false);
  }
});

test("catalogue: NOTHING claims manual sync or metric sync in this build", () => {
  for (const a of ADS_ADAPTER_CATALOGUE) {
    assert.equal(a.capabilities.manualSync, false, a.provider);
    assert.equal(a.capabilities.metricSync, false, a.provider);
    assert.equal(adsProviderSupportsManualSync(a.provider), false);
  }
});

/* ── 4 · source discipline scans ──────────────────────────────────────────── */

test("source scan: the receiver has ONE generic unauthorised path and raw-byte discipline", () => {
  const src = readFileSync(
    new URL("../supabase/functions/marketing-ad-webhook/index.ts", import.meta.url),
    "utf8",
  );
  assert.ok(src.includes("req.text()"), "raw bytes are read before parsing");
  assert.ok(
    src.indexOf("await req.text()") < src.indexOf("parseAdsLeadPayload(rawBody)") &&
      src.indexOf("verifyAdsWebhookSignature({") < src.indexOf("parseAdsLeadPayload(rawBody)"),
    "signature verification precedes payload parsing",
  );
  assert.ok(!src.includes("console.log"), "nothing is logged from the receiver");
  assert.ok(
    !/console\.error\([^)]*(secret|signature)/i.test(src),
    "no secret or signature ever reaches a log call",
  );
  assert.ok(src.includes("provider_secret_read"), "secrets come from the tenant Vault broker");
  assert.ok(!src.includes('Deno.env.get("ADS'), "no global env secret exists");
  const generic = src.match(/unauthorized\(\)/g) ?? [];
  assert.ok(generic.length >= 5, "every auth failure path shares the ONE generic response");
  // the body limit is byte-based and the occurred_at window is enforced
  assert.ok(src.includes("adsWebhookBodyByteLength"), "body size is measured in bytes");
  assert.ok(src.includes("invalid_occurred_at"), "occurred_at is window-bounded at the receiver");
  assert.ok(
    src.includes("previousValidUntilMs"),
    "the previous secret is honoured only inside the bounded overlap",
  );
});

test("source scan: webhook_setup is idempotency-FIRST (mark before any Vault rotation)", () => {
  const src = readFileSync(
    new URL("../supabase/functions/marketing-ads/index.ts", import.meta.url),
    "utf8",
  );
  // The governed credential mark (request-id gated) must run BEFORE the Vault
  // secret store, so a replayed request_id can never rotate twice.
  const markAt = src.indexOf("marketing_ad_source_credential_mark");
  const storeAt = src.indexOf('p_field: "signing_key"');
  assert.ok(markAt > 0 && storeAt > 0, "both the mark and the store exist");
  assert.ok(markAt < storeAt, "the credential mark precedes the Vault secret store");
  assert.ok(
    src.includes("markData.replayed === true"),
    "a replayed setup returns without rotating or revealing a secret",
  );
});

test("source scan: the worker writes only through governed RPCs", () => {
  const src = readFileSync(
    new URL("../supabase/functions/_shared/worker_handlers/marketing_ad_lead.ts", import.meta.url),
    "utf8",
  );
  assert.ok(!src.includes(".insert("), "no direct table writes");
  assert.ok(!src.includes(".update("), "no direct table updates");
  assert.ok(src.includes("marketing_ad_claim_events"));
  assert.ok(src.includes("marketing_ad_lead_process"));
});
