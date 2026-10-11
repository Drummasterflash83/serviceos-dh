import test from "node:test";
import assert from "node:assert/strict";
import { parseCallDetail } from "./call-detail-contract.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fixture = () => ({
  success: true,
  version: "phone-call-detail/2",
  tenant_id: id(1),
  provenance: { freshness: "unverified", transcript_id: id(6) },
  call: {
    call_id: id(3),
    occurred_at: null,
    direction: "IN",
    connector: "birchill",
    phone_from: null,
    phone_to: null,
    processing_status: null,
  },
  insight: {
    summary: "Saved summary",
    intent: null,
    urgency: null,
    sentiment: null,
    action_required: null,
    suggested_owner: null,
    confidence: null,
    updated_at: null,
  },
  identity: {
    internal: null,
    external: null,
    direction: null,
    direction_confidence: null,
    has_conflict: false,
    unresolved: [],
    identity_confidence: null,
  },
  transcript: { raw: "Saved raw text", normalised: null, corrections: [] },
  review: null,
});
test("versioned same-call saved detail preserves the explicit unverified status", () => {
  const p = parseCallDetail(fixture(), id(3));
  assert.equal(p.provenance.freshness, "unverified");
  assert.equal(p.transcript.raw, "Saved raw text");
});
test("old, wrong-call, missing and malformed responses cannot be displayed as trustworthy detail", () => {
  for (const mutate of [
    (p: any) => delete p.version,
    (p: any) => (p.call.call_id = id(9)),
    (p: any) => (p.success = false),
    (p: any) => (p.provenance.freshness = "source_matched"),
    (p: any) => (p.insight.confidence = "high"),
    (p: any) => (p.identity.unresolved = "unknown"),
    (p: any) => (p.transcript.corrections = [{ from: "one" }]),
  ]) {
    const p = fixture();
    mutate(p);
    assert.throws(() => parseCallDetail(p, id(3)));
  }
  for (const p of [undefined, null, [], {}]) assert.throws(() => parseCallDetail(p, id(3)));
});
test("unbound corrections and raw text cannot bypass source validation", () => {
  for (const mutate of [
    (p: any) => (p.provenance.transcript_id = null),
    (p: any) => {
      p.transcript.raw = null;
      p.transcript.normalised = "Wrong version";
    },
  ]) {
    const p = fixture();
    mutate(p);
    assert.throws(() => parseCallDetail(p, id(3)));
  }
});
test("missing retained analysis and transcript are valid unknowns, not processing claims", () => {
  const p: any = fixture();
  p.insight = null;
  p.transcript.raw = null;
  p.provenance.transcript_id = null;
  assert.equal(parseCallDetail(p, id(3)).insight, null);
});
