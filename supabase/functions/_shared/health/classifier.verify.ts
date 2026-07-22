// Run: node supabase/functions/_shared/health/classifier.verify.ts
// Pure unit tests for the callback classifier. No DB, no network.
import assert from "node:assert/strict";
import { classifyCallback } from "./classifier.ts";
import type { CommunicationInput } from "./types.ts";

let failed = 0;
function ok(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}: ${(e as Error).message}`);
  }
}

const base: CommunicationInput = {
  interactionId: "i1",
  interactionType: "phone_call",
  direction: "inbound",
  occurredAt: "2026-07-22T09:00:00Z",
  fromName: "A Customer",
  fromAddress: null,
  phoneFrom: "+440000000001",
  phoneTo: "+440000000100",
  subject: null,
  summary: null,
  bodyPreview: null,
  disposition: null,
};

ok("explicit 'call me back' is a candidate", () => {
  const r = classifyCallback({
    ...base,
    summary: "Customer asked us to call them back about their boiler service.",
  });
  assert.equal(r.route, "candidate");
  assert.equal(r.candidate, true);
  assert.ok(r.confidence >= 0.9);
  assert.ok(r.requestedOutcome);
});

ok("named request extracts the name (generic pattern, no hardcoded staff name)", () => {
  const r = classifyCallback({
    ...base,
    summary: "Please could you ask Synthia to call me back regarding the quote.",
  });
  assert.equal(r.route, "candidate");
  assert.equal(r.reasonCode, "explicit_callback_named");
  assert.equal(r.ownershipHint.requestedName, "synthia");
});

ok("'have <name> call me' works for ANY name (tenant-neutral)", () => {
  for (const name of ["synthia", "priya", "tomos"]) {
    const r = classifyCallback({
      ...base,
      summary: `I'll try again later — actually can you have ${name} call me back please.`,
    });
    assert.equal(r.route, "candidate", `name '${name}' should classify identically`);
  }
});

ok("generic missed call with no request is EXCLUDED (precision)", () => {
  const r = classifyCallback({
    ...base,
    disposition: "missed",
    summary: "Missed call from customer, line dropped before answer.",
  });
  assert.equal(r.route, "exclude");
  assert.equal(r.reasonCode, "generic_unanswered_no_request");
});

ok("empty abandoned call excluded", () => {
  const r = classifyCallback({ ...base, disposition: "missed", summary: "" });
  assert.equal(r.route, "exclude");
});

ok("internal call excluded", () => {
  const r = classifyCallback({ ...base, direction: "internal", summary: "call me back please" });
  assert.equal(r.route, "exclude");
  assert.equal(r.reasonCode, "internal");
});

ok("spam excluded", () => {
  const r = classifyCallback({
    ...base,
    summary: "We offer SEO services to rank your website — call us back",
  });
  assert.equal(r.route, "exclude");
  assert.equal(r.reasonCode, "spam");
});

ok("supplier excluded by default", () => {
  const r = classifyCallback({
    ...base,
    callerKind: "supplier",
    summary: "please call me back about the delivery",
  });
  assert.equal(r.route, "exclude");
  assert.equal(r.reasonCode, "supplier");
});

ok("resolved-on-transfer excluded", () => {
  const r = classifyCallback({
    ...base,
    disposition: "resolved_on_transfer",
    summary: "wanted a callback but was put through and sorted",
  });
  assert.equal(r.route, "exclude");
  assert.equal(r.reasonCode, "resolved_on_transfer");
});

ok("email requesting email-only is excluded", () => {
  const r = classifyCallback({
    ...base,
    interactionType: "email_message",
    summary: "Please email me the quote when you can.",
  });
  assert.equal(r.route, "exclude");
  assert.equal(r.reasonCode, "email_only");
});

ok("email that asks for a call IS a candidate (telephone-based)", () => {
  const r = classifyCallback({
    ...base,
    interactionType: "email_message",
    summary: "Can you call me back on my mobile to arrange the visit?",
  });
  assert.equal(r.route, "candidate");
});

ok("voicemail about an enquiry is a candidate", () => {
  const r = classifyCallback({
    ...base,
    disposition: "voicemail",
    summary: "Left a voicemail regarding a quote enquiry.",
  });
  assert.equal(r.route, "candidate");
  assert.equal(r.reasonCode, "voicemail_return_call");
});

ok("unclear voicemail routes to uncertain", () => {
  const r = classifyCallback({ ...base, disposition: "voicemail", summary: "left message" });
  assert.equal(r.route, "uncertain");
});

ok("answered call with no request excluded", () => {
  const r = classifyCallback({
    ...base,
    disposition: "answered",
    summary: "Confirmed appointment time, all good.",
  });
  assert.equal(r.route, "exclude");
  assert.equal(r.reasonCode, "answered_no_request");
});

ok("outbound excluded", () => {
  const r = classifyCallback({
    ...base,
    direction: "outbound",
    summary: "called the customer to follow up",
  });
  assert.equal(r.route, "exclude");
});

ok("excerpt is bounded and redacts numbers", () => {
  const r = classifyCallback({
    ...base,
    summary: "Please call me back on 07700 900123 as soon as possible about the leak",
  });
  assert.equal(r.route, "candidate");
  assert.ok(r.supportingExcerpt && r.supportingExcerpt.length <= 130);
  assert.ok(r.supportingExcerpt && r.supportingExcerpt.includes("[number]"));
});

ok("customer saying THEY will call back is excluded (adversarial)", () => {
  const r = classifyCallback({
    ...base,
    disposition: "answered",
    summary: "Customer said they'll call us back later themselves.",
  });
  assert.equal(r.route, "exclude");
  assert.equal(r.reasonCode, "customer_will_call_back");
});

ok("'I'll call you back' excluded, but 'call me back' still a candidate", () => {
  assert.equal(
    classifyCallback({ ...base, summary: "I'll call you back tomorrow" }).route,
    "exclude",
  );
  assert.equal(
    classifyCallback({ ...base, summary: "please call me back tomorrow" }).route,
    "candidate",
  );
});

// ── Bounded regression additions (Fable pre-commit pass §10). ───────────────
// These pin the fixed defects; they do NOT claim production-ready language coverage.

ok("REGRESSION negation: 'No need to call me back.' is EXCLUDED", () => {
  const r = classifyCallback({ ...base, summary: "No need to call me back." });
  assert.equal(r.route, "exclude");
  assert.equal(r.reasonCode, "callback_declined");
});

ok("REGRESSION negation variants excluded", () => {
  for (const s of [
    "Don't call me back, it's sorted.",
    "No callback needed, all resolved.",
    "She doesn't need a callback anymore.",
  ]) {
    const r = classifyCallback({ ...base, summary: s });
    assert.equal(r.route, "exclude", `'${s}' must not be a candidate`);
  }
});

ok("REGRESSION negation does not swallow a separate real request", () => {
  const r = classifyCallback({
    ...base,
    summary: "No need to call about the invoice, but please call me back about the boiler.",
  });
  assert.equal(r.route, "candidate");
});

ok("REGRESSION 'I'll call you back.' (straight apostrophe) excluded", () => {
  const r = classifyCallback({ ...base, summary: "I'll call you back." });
  assert.equal(r.route, "exclude");
  assert.equal(r.reasonCode, "customer_will_call_back");
});

ok("REGRESSION 'I’ll call you back.' (curly apostrophe) classifies identically", () => {
  const straight = classifyCallback({ ...base, summary: "I'll call you back." });
  const curly = classifyCallback({ ...base, summary: "I’ll call you back." });
  assert.equal(curly.route, straight.route);
  assert.equal(curly.reasonCode, straight.reasonCode);
});

ok("REGRESSION 'They’ll call us back.' excluded", () => {
  const r = classifyCallback({ ...base, summary: "They’ll call us back." });
  assert.equal(r.route, "exclude");
  assert.equal(r.reasonCode, "customer_will_call_back");
});

ok("REGRESSION 'We’ll call the customer back.' is a STAFF COMMITMENT candidate", () => {
  const r = classifyCallback({
    ...base,
    disposition: "answered",
    summary: "We’ll call the customer back.",
  });
  assert.equal(r.route, "candidate");
  assert.equal(r.reasonCode, "staff_callback_commitment");
});

ok("REGRESSION 'Please ask someone to call me.' is a candidate", () => {
  const r = classifyCallback({ ...base, summary: "Please ask someone to call me." });
  assert.equal(r.route, "candidate");
});

ok('REGRESSION "don\'t have to call me back" is excluded (negation variant)', () => {
  const r = classifyCallback({
    ...base,
    disposition: "answered",
    summary: "You don't have to call me back, all sorted.",
  });
  assert.equal(r.route, "exclude");
  assert.equal(r.reasonCode, "callback_declined");
});

ok("REGRESSION 'you will call' is NOT eaten by the i'll pattern (word boundary)", () => {
  const r = classifyCallback({
    ...base,
    summary: "Hoping you will call back soon about my quote.",
  });
  assert.equal(r.route, "candidate");
});

ok("REGRESSION he/she self-callbacks are excluded", () => {
  for (const s of ["He said he'll call us back.", "She'll ring us back later."]) {
    const r = classifyCallback({ ...base, disposition: "answered", summary: s });
    assert.equal(r.route, "exclude", `'${s}' must not be a candidate`);
    assert.equal(r.reasonCode, "customer_will_call_back");
  }
});

ok("REGRESSION 'have to call' never yields a junk requested name", () => {
  const r = classifyCallback({
    ...base,
    summary: "I have to call the bank later, please call me back.",
  });
  assert.equal(r.route, "candidate");
  assert.equal(r.reasonCode, "explicit_callback_phrase");
  assert.equal(r.ownershipHint.requestedName, null);
});

ok("deterministic: same input → same output", () => {
  const c = { ...base, summary: "please call me back about the boiler" };
  assert.deepEqual(classifyCallback(c), classifyCallback(c));
});

console.log(
  failed === 0 ? "\nclassifier.verify: ALL PASSED" : `\nclassifier.verify: ${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
