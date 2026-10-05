// Marketing Phase 4 — pure proofs. Run: node --test scripts/marketing-senders-pure.test.mjs
//
// Layers, no network, no DB:
//  1. The pure marketing_email module: send-scope evaluation, EXACT envelope
//     allowlist (undeclared fields like bcc/html/recipient_emails/sneaky are
//     rejected), CR/LF header-injection rejection, hardened MIME construction
//     FROM THE FROZEN ENVELOPE (display-name quoting for quotes/commas/angle
//     brackets/backslashes, RFC 2047 for Unicode, RFC 2045 base64 line
//     wrapping, deterministic Message-ID), execution-time actor-authority
//     evaluation (facts from the canonical SQL resolver), sanitized provider
//     responses and CONSERVATIVE Gmail classification (429 = proven rejection
//     → transient; 5xx / lost = UNKNOWN, never auto-resent).
//  2. The FROZEN Automation Engine guard (evaluateExecutionGuards, imported
//     unmodified) against the HONEST Phase-4 package: an explicitly
//     authorised DELEGATED test action (AUTOMATION_AUTHORISED, no approval
//     required, none fabricated) executes in trusted mode; assisted/discovery
//     withhold irreversible execution; and the FUTURE broadcast approval
//     boundary stays distinct — an approval-requiring package/intent type
//     still demands a matching approval from the unchanged guard.
//  3. SOURCE-SCAN contracts on the Deno adapter (which node cannot execute):
//     the provider message is built from env.* only (no sender.* content
//     substitution) and the adapter re-checks actor authority + canonical
//     readiness before the single provider call.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  GMAIL_SEND_SCOPE,
  MAX_ENCODED_WORD_CHARS,
  buildMarketingMime,
  classifyGmailSendFailure,
  composeMarketingBody,
  encodeDisplayName,
  encodeWords,
  evaluateActorAuthority,
  evaluateGmailSendScope,
  hasHeaderInjection,
  sanitizeGmailSendResponse,
  validateSendEnvelope,
  wrapBase64Lines,
} from "../supabase/functions/_shared/marketing_email.ts";
import { evaluateExecutionGuards } from "../supabase/functions/_shared/intelligence/automation_guards.ts";
import { marketingEmailAdapter } from "../supabase/functions/_shared/connectors/marketing_email.ts";

// ── 1a · scope evaluation is evidence-only ──────────────────────────────────
test("send scope: only the exact granted scope authorizes", () => {
  assert.equal(evaluateGmailSendScope(null), "missing");
  assert.equal(evaluateGmailSendScope(""), "missing");
  assert.equal(evaluateGmailSendScope("https://www.googleapis.com/auth/gmail.readonly"), "missing");
  assert.equal(
    evaluateGmailSendScope("https://www.googleapis.com/auth/gmail.send.extra"),
    "missing",
  );
  assert.equal(
    evaluateGmailSendScope(`https://www.googleapis.com/auth/gmail.readonly ${GMAIL_SEND_SCOPE}`),
    "authorized",
  );
});

// ── 1b · EXACT envelope allowlist ────────────────────────────────────────────
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

test("envelope: the exact frozen shape validates; every corruption is refused", () => {
  assert.equal(validateSendEnvelope(ENVELOPE).ok, true);
  const bad = (patch) => {
    const v = validateSendEnvelope({ ...ENVELOPE, ...patch });
    assert.equal(v.ok, false, JSON.stringify(patch));
  };
  bad({ source_kind: "smtp" });
  bad({ mailbox_address: "Sender@P4.test" });
  bad({ recipient_email: "not-an-email" });
  bad({ subject: "" });
  bad({ subject: "x".repeat(301) });
  bad({ subject: "evil\r\nBcc: victim@x.test" });
  bad({ body_text: "" });
  bad({ from_name: "evil\nX-Injected: 1" });
  bad({ reply_to: "nope" });
  bad({ purpose: "campaign" }); // Phase 5 does not exist yet
  bad({ content_hash: "zz" });
  bad({ request_id: "short" });
  bad({ delivery_id: "not-a-uuid" });
});

test("envelope: UNDECLARED fields are rejected before any provider interaction", () => {
  for (const extra of [
    { bcc: "victim@x.test" },
    { html: "<b>hi</b>" },
    { recipient_emails: ["a@x.test", "b@x.test"] },
    { sneaky: 1 },
  ]) {
    const v = validateSendEnvelope({ ...ENVELOPE, ...extra });
    assert.equal(v.ok, false, JSON.stringify(extra));
    assert.match(v.error, /undeclared envelope field/);
  }
  // missing required keys are rejected too
  for (const missing of ["subject", "recipient_email", "content_hash", "actor_profile_id"]) {
    const clone = { ...ENVELOPE };
    delete clone[missing];
    const v = validateSendEnvelope(clone);
    assert.equal(v.ok, false, missing);
    assert.match(v.error, /missing envelope field/);
  }
  // wrong types / invalid nullables
  assert.equal(validateSendEnvelope({ ...ENVELOPE, from_name: 5 }).ok, false);
  assert.equal(validateSendEnvelope({ ...ENVELOPE, signature_text: 5 }).ok, false);
});

// ── 1c · execution-time actor authority (pure decision over resolver facts) ──
test("actor authority: removed / moved / denied / valid", () => {
  const base = {
    tenantId: "t1",
    actor: { id: "u1", tenant_id: "t1" },
    resolverVerdict: { enabled: true, permissions: ["marketing.view", "marketing.campaigns.test"] },
  };
  assert.equal(evaluateActorAuthority(base).ok, true);
  const removed = evaluateActorAuthority({ ...base, actor: null });
  assert.deepEqual([removed.ok, removed.code], [false, "actor_removed"]);
  const moved = evaluateActorAuthority({ ...base, actor: { id: "u1", tenant_id: "t2" } });
  assert.deepEqual([moved.ok, moved.code], [false, "actor_tenant_mismatch"]);
  const denied = evaluateActorAuthority({
    ...base,
    resolverVerdict: { enabled: true, permissions: ["marketing.view"] },
  });
  assert.deepEqual([denied.ok, denied.code], [false, "actor_no_longer_authorised"]);
  const disabled = evaluateActorAuthority({
    ...base,
    resolverVerdict: { enabled: false, permissions: ["marketing.campaigns.test"] },
  });
  assert.equal(disabled.ok, false);
  const noVerdict = evaluateActorAuthority({ ...base, resolverVerdict: null });
  assert.equal(noVerdict.ok, false);
});

// ── 1d · header injection + hardened MIME ───────────────────────────────────
test("header injection is detected on every vector", () => {
  assert.equal(hasHeaderInjection("clean value"), false);
  assert.equal(hasHeaderInjection("a\rb"), true);
  assert.equal(hasHeaderInjection("a\nb"), true);
  assert.equal(hasHeaderInjection("a\0b"), true);
});

test("display names: quotes, commas, angle brackets, backslashes cannot break From", () => {
  assert.equal(encodeDisplayName("Plain Name"), "Plain Name");
  assert.equal(encodeDisplayName('Ada "The Boss" L'), '"Ada \\"The Boss\\" L"');
  assert.equal(encodeDisplayName("Drummond, Sons"), '"Drummond, Sons"');
  assert.equal(encodeDisplayName("Evil <evil@x.test>"), '"Evil <evil@x.test>"');
  assert.equal(encodeDisplayName("Back\\slash"), '"Back\\\\slash"');
  assert.match(encodeDisplayName("Drümmonds"), /^=\?UTF-8\?B\?/);
});

function decodeBase64Url(raw) {
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

test("MIME: deterministic, exact frozen composition, wrapped base64 body", () => {
  const mime = buildMarketingMime({
    fromAddress: "sender@p4.test",
    fromName: 'Drummond, "Heating" <ops>',
    to: "recipient@p4.test",
    replyTo: "reply@p4.test",
    subject: "Phase 4 test",
    bodyText: "Hello.\n".repeat(400), // long body forces multiple base64 lines
    signatureText: "The team",
    deliveryId: "44444444-4444-4444-8444-444444444444",
  });
  assert.equal(mime.messageId, "<mkt-44444444-4444-4444-8444-444444444444@p4.test>");
  const decoded = decodeBase64Url(mime.raw);
  assert.equal(decoded, mime.message);
  // From is a SAFE quoted string — the crafted name cannot smuggle an address
  assert.match(decoded, /^From: "Drummond, \\"Heating\\" <ops>" <sender@p4\.test>\r\n/);
  assert.match(decoded, /\r\nReply-To: reply@p4\.test\r\n/);
  // RFC 2045: every base64 body line is bounded at 76 chars
  const body = decoded.split("\r\n\r\n")[1];
  for (const line of body.split("\r\n")) assert.ok(line.length <= 76, `line ${line.length}`);
  // the composed body of record ends with the exact frozen signature block
  assert.ok(mime.composedBody.endsWith("\n\n--\nThe team"));
  assert.equal(composeMarketingBody("Hello.", null), "Hello.");
  assert.equal(wrapBase64Lines("A".repeat(100)).split("\r\n")[0].length, 76);
  // deterministic
  const again = buildMarketingMime({
    fromAddress: "sender@p4.test",
    fromName: 'Drummond, "Heating" <ops>',
    to: "recipient@p4.test",
    replyTo: "reply@p4.test",
    subject: "Phase 4 test",
    bodyText: "Hello.\n".repeat(400),
    signatureText: "The team",
    deliveryId: "44444444-4444-4444-8444-444444444444",
  });
  assert.equal(again.raw, mime.raw);
});

test("MIME: Unicode headers are RFC-2047 encoded; injection throws", () => {
  const mime = buildMarketingMime({
    fromAddress: "sender@p4.test",
    fromName: "Drümmonds — Heating",
    to: "recipient@p4.test",
    replyTo: null,
    subject: "Ünicode ☃",
    bodyText: "B",
    signatureText: null,
    deliveryId: "44444444-4444-4444-8444-444444444444",
  });
  const decoded = decodeBase64Url(mime.raw);
  assert.match(decoded, /Subject: =\?UTF-8\?B\?/);
  assert.match(decoded, /From: =\?UTF-8\?B\?/);
  assert.throws(() =>
    buildMarketingMime({
      fromAddress: "sender@p4.test",
      fromName: null,
      to: "recipient@p4.test",
      replyTo: null,
      subject: "evil\r\nBcc: victim@x.test",
      bodyText: "B",
      signatureText: null,
      deliveryId: "44444444-4444-4444-8444-444444444444",
    }),
  );
});

// ── 1d-bis · RFC 2047 long-Unicode header compliance ────────────────────────
// A single oversized encoded word violates RFC 2047 §2 (75-char limit) and
// can breach the physical line limit. These tests pin the folding contract at
// the MAXIMUM value bounds the platform accepts (subject ≤300 chars,
// display name ≤120 chars, both counted as code points like Postgres does).

/** RFC 2047 §6.2 decoder: adjacent encoded words separated by FWS decode with
 *  the whitespace removed — concatenate each word's bytes, then UTF-8. */
function decodeEncodedWords(headerValue) {
  const words = [...headerValue.matchAll(/=\?UTF-8\?B\?([A-Za-z0-9+/]*={0,2})\?=/g)];
  return Buffer.concat(words.map((m) => Buffer.from(m[1], "base64"))).toString("utf8");
}

/** Extract one logical header (its physical first line + continuations). */
function headerPhysicalLines(message, name) {
  const lines = message.split("\r\n\r\n")[0].split("\r\n");
  const start = lines.findIndex((l) => l.startsWith(`${name}: `));
  assert.notEqual(start, -1, `${name} header present`);
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length && /^[ \t]/.test(lines[i]); i++) out.push(lines[i]);
  return out;
}

function assertLegalEncodedWordFolding(physicalLines, original, label) {
  // every RFC 2047 encoded word ≤ 75 chars INCLUDING its wrapper
  const value = physicalLines.join("\r\n");
  const words = value.match(/=\?UTF-8\?B\?[A-Za-z0-9+/=]*\?=/g) ?? [];
  assert.ok(words.length > 1, `${label}: a long value folds into multiple words`);
  for (const w of words) {
    assert.ok(w.length <= MAX_ENCODED_WORD_CHARS, `${label}: word ${w.length} chars > 75`);
    // every word decodes as VALID UTF-8 on its own — characters never split
    const payload = w.slice("=?UTF-8?B?".length, -"?=".length);
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(payload, "base64"));
  }
  // physical line discipline: hard limit + valid folding whitespace
  for (const [i, line] of physicalLines.entries()) {
    assert.ok(line.length <= 998, `${label}: physical line ${line.length} chars > 998`);
    if (i > 0) assert.match(line, /^ =\?UTF-8\?B\?/, `${label}: continuation folds with a space`);
  }
  // exact reconstruction
  assert.equal(decodeEncodedWords(value), original, `${label}: decodes to the exact original`);
}

// 300 code points (the subject bound), mixing 3-byte, 2-byte and 4-byte
// (surrogate-pair) characters so chunking is proven at UTF-8 boundaries
const MAX_SUBJECT = "☃".repeat(140) + "é".repeat(140) + "🔥".repeat(20);
// 120 code points (the display-name bound), all multi-byte
const MAX_FROM_NAME = "名".repeat(60) + "Ø".repeat(40) + "🚀".repeat(20);

test("RFC 2047: a maximum-length Unicode subject folds into legal ≤75-char words", () => {
  assert.equal([...MAX_SUBJECT].length, 300);
  const mime = buildMarketingMime({
    fromAddress: "sender@p4.test",
    fromName: null,
    to: "recipient@p4.test",
    replyTo: null,
    subject: MAX_SUBJECT,
    bodyText: "B",
    signatureText: null,
    deliveryId: "44444444-4444-4444-8444-444444444444",
  });
  const decoded = decodeBase64Url(mime.raw);
  assertLegalEncodedWordFolding(headerPhysicalLines(decoded, "Subject"), MAX_SUBJECT, "subject");
});

test("RFC 2047: a maximum-length Unicode display name folds and reconstructs", () => {
  assert.equal([...MAX_FROM_NAME].length, 120);
  const mime = buildMarketingMime({
    fromAddress: "sender@p4.test",
    fromName: MAX_FROM_NAME,
    to: "recipient@p4.test",
    replyTo: null,
    subject: "Short ASCII",
    bodyText: "B",
    signatureText: null,
    deliveryId: "44444444-4444-4444-8444-444444444444",
  });
  const decoded = decodeBase64Url(mime.raw);
  const fromLines = headerPhysicalLines(decoded, "From");
  assertLegalEncodedWordFolding(fromLines, MAX_FROM_NAME, "from-name");
  // the address survives, unencoded, after the folded phrase
  assert.match(fromLines[fromLines.length - 1], / <sender@p4\.test>$/);
  // short ASCII subject stays byte-for-byte untouched next to the folded From
  assert.equal(headerPhysicalLines(decoded, "Subject").join(""), "Subject: Short ASCII");
});

test("encodeWords: chunking never splits a UTF-8 sequence and short values stay single-word", () => {
  for (const v of ["🔥".repeat(60), "é".repeat(200), "☃a🔥b".repeat(40)]) {
    const words = encodeWords(v);
    let joined = "";
    for (const w of words) {
      assert.ok(w.length <= MAX_ENCODED_WORD_CHARS);
      const payload = w.slice("=?UTF-8?B?".length, -"?=".length);
      joined += new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(payload, "base64"));
    }
    assert.equal(joined, v);
  }
  assert.equal(encodeWords("Drü").length, 1, "a short value is one word");
});

// ── 1e · sanitized provider results + conservative classification ───────────
test("provider response: allowlist projection only", () => {
  assert.deepEqual(sanitizeGmailSendResponse({ id: "m1", threadId: "t1", labelIds: ["SENT"] }), {
    messageId: "m1",
    threadId: "t1",
  });
  assert.equal(sanitizeGmailSendResponse({ threadId: "t1" }), null);
  assert.equal(sanitizeGmailSendResponse("nope"), null);
  assert.equal(sanitizeGmailSendResponse(null), null);
});

test("classification: reconsent actionable; 429 transient; 5xx is UNKNOWN", () => {
  assert.deepEqual(classifyGmailSendFailure(401, ""), {
    kind: "permanent",
    code: "gmail_auth_expired",
    needsReconsent: true,
  });
  assert.equal(
    classifyGmailSendFailure(403, '{"error":{"message":"insufficient scopes"}}').needsReconsent,
    true,
  );
  assert.equal(classifyGmailSendFailure(403, "quota exceeded for user").kind, "permanent");
  assert.equal(classifyGmailSendFailure(400, "").kind, "permanent");
  assert.equal(classifyGmailSendFailure(429, "").kind, "transient");
  // an uncertain 5xx must NEVER be classified as safely retryable — Gmail has
  // no idempotency key, so an automatic resend could duplicate a real email
  assert.equal(classifyGmailSendFailure(500, "").kind, "unknown");
  assert.equal(classifyGmailSendFailure(503, "").kind, "unknown");
});

// ── 2 · the FROZEN engine guard × the honest Phase-4 authority model ────────
const BEHAVIOURS = {
  discovery: {
    ordinal: 0,
    observe_only: true,
    allows_execution: false,
    requires_review: false,
    max_risk: "none",
    require_reversible: true,
    require_policy_authorised: true,
    optimisation: false,
  },
  recommendation: {
    ordinal: 1,
    observe_only: false,
    allows_execution: false,
    requires_review: true,
    max_risk: "none",
    require_reversible: true,
    require_policy_authorised: true,
    optimisation: false,
  },
  assisted: {
    ordinal: 2,
    observe_only: false,
    allows_execution: true,
    requires_review: false,
    max_risk: "low",
    require_reversible: true,
    require_policy_authorised: true,
    optimisation: false,
  },
  trusted: {
    ordinal: 3,
    observe_only: false,
    allows_execution: true,
    requires_review: false,
    max_risk: "critical",
    require_reversible: false,
    require_policy_authorised: false,
    optimisation: false,
  },
};
const profileFor = (mode) => ({ operational_mode: { current: mode, behaviours: BEHAVIOURS } });

// the HONEST delegated test-send package: authorised, no review routing,
// requiresApproval false, risk low, reversibility IRREVERSIBLE
const TEST_PKG = {
  id: "d1",
  tenantId: "t1",
  supersedes: null,
  intelligenceObjectId: "a1",
  intelligenceObjectType: "Action",
  objectClass: "action",
  domainPackKeys: [],
  decision: "AUTOMATION_AUTHORISED",
  nextDecisionOwner: { kind: "automation" },
  rationale: {
    summary: "",
    reasonCodes: ["human_explicit_request"],
    policyMatches: ["marketing.campaigns.test"],
    rejectedAlternatives: [],
    missingConfiguration: [],
  },
  confidence: { score: 1, threshold: 0, ambiguityScore: 0, evidenceQuality: 1 },
  authority: {
    requiredAuthority: "operational",
    resolvedAuthorityHolder: "u1",
    delegatedLimit: null,
    requestedValue: null,
    withinDelegatedAuthority: true,
  },
  risk: { level: "low", score: 0.2, categories: ["customer"] },
  reversibility: { level: "irreversible", compensationAvailable: false },
  impact: { level: "low", categories: ["customer"] },
  ownership: {
    responsible: null,
    accountable: null,
    approver: null,
    waitingOn: null,
    consulted: [],
    informed: [],
  },
  proposedAction: null,
  automationIntent: {
    intentType: "send_marketing_test_email",
    payload: {},
    requiresApproval: false,
  },
  routing: {
    reviewRequired: false,
    openfolkRequired: false,
    tenantReviewRequired: false,
    customerApprovalRequired: false,
    waitCondition: null,
  },
  versions: {
    engineVersion: "marketing-sender.v1",
    operatingProfileVersion: null,
    policyVersionIds: [],
    learningVersionIds: [],
  },
};

// a FUTURE broadcast-shaped package: approval-requiring — the boundary that
// must stay distinct from the delegated test action
const BROADCAST_PKG = {
  ...TEST_PKG,
  decision: "AUTOMATION_REQUIRES_APPROVAL",
  automationIntent: { intentType: "send_marketing_bulk", payload: {}, requiresApproval: true },
  routing: { ...TEST_PKG.routing, reviewRequired: true, tenantReviewRequired: true },
};

function guardInput(over = {}) {
  const { intent: intentOver, intentType: intentTypeOver, ...rest } = over;
  return {
    now: "2026-07-29T12:00:00.000Z",
    tenantId: "t1",
    intent: {
      id: "i1",
      tenantId: "t1",
      status: "pending",
      intentType: "send_marketing_test_email",
      capabilityKey: "email.send_marketing",
      connectorId: "google-gmail",
      actionObjectId: "a1",
      decisionId: "d1",
      expiresAt: "2026-07-29T13:00:00.000Z",
      attempts: 0,
      maxAttempts: 3,
      leaseExpiresAt: null,
      ...(intentOver ?? {}),
    },
    action: { exists: true, tenantId: "t1" },
    intentType: {
      intentType: "send_marketing_test_email",
      enabled: true,
      requiresApproval: false, // the honest delegated-test registration
      externalSideEffect: true,
      supportsIdempotency: true,
      supportsStatusLookup: false,
      riskCategory: "high",
      schemaVersion: "1",
      ...(intentTypeOver ?? {}),
    },
    decisionPackage: TEST_PKG,
    decisionDestination: "AUTOMATION_AUTHORISED",
    decisionTenantId: "t1",
    decisionSuperseded: false,
    policyVersionsValid: true,
    authorityValid: true,
    profile: profileFor("trusted"),
    approval: {
      present: false,
      approverKind: null,
      requiredApproverKind: null,
      expiresAt: null,
      decision: null,
    },
    connector: { exists: true, enabled: true, healthStatus: "healthy", capabilityEnabled: true },
    outcomeContractPresent: true,
    dependenciesMet: true,
    priorSucceededExecutionId: null,
    leaseActiveByOtherWorker: false,
    ...rest,
  };
}

test("guard: the delegated test action executes in trusted mode with NO approval row", () => {
  const d = evaluateExecutionGuards(guardInput());
  assert.equal(d.outcome, "EXECUTION_ALLOWED");
});

test("guard: assisted mode WITHHOLDS irreversible external execution (mode discipline intact)", () => {
  const d = evaluateExecutionGuards(guardInput({ profile: profileFor("assisted") }));
  assert.equal(d.outcome, "BLOCKED");
  assert.deepEqual(d.reasonCodes, ["operational_mode_blocks_execution"]);
});

test("guard: discovery mode blocks everything", () => {
  const d = evaluateExecutionGuards(guardInput({ profile: profileFor("discovery") }));
  assert.equal(d.outcome, "BLOCKED");
});

test("guard: the FUTURE broadcast boundary stays distinct — approval still required", () => {
  // an approval-requiring package (broadcast-shaped) without an approval
  const missing = evaluateExecutionGuards(
    guardInput({
      decisionPackage: BROADCAST_PKG,
      decisionDestination: "AUTOMATION_REQUIRES_APPROVAL",
      approval: {
        present: false,
        approverKind: null,
        requiredApproverKind: "tenant_senior",
        expiresAt: null,
        decision: null,
      },
    }),
  );
  assert.equal(missing.outcome, "APPROVAL_REQUIRED");
  // …and a mismatched approver kind can never satisfy it
  const wrongKind = evaluateExecutionGuards(
    guardInput({
      decisionPackage: BROADCAST_PKG,
      decisionDestination: "AUTOMATION_REQUIRES_APPROVAL",
      approval: {
        present: true,
        approverKind: "openfolk",
        requiredApproverKind: "tenant_senior",
        expiresAt: null,
        decision: "approved",
      },
    }),
  );
  assert.equal(wrongKind.outcome, "APPROVAL_REQUIRED");
  assert.deepEqual(wrongKind.reasonCodes, ["approval_wrong_authority"]);
  // an approval-requiring INTENT TYPE alone also demands approval
  const typeGate = evaluateExecutionGuards(guardInput({ intentType: { requiresApproval: true } }));
  assert.equal(typeGate.outcome, "APPROVAL_REQUIRED");
});

test("guard: capability/connector/contract/supersession/unknown/prior-success all hold", () => {
  assert.deepEqual(
    evaluateExecutionGuards(
      guardInput({
        connector: {
          exists: true,
          enabled: true,
          healthStatus: "healthy",
          capabilityEnabled: false,
        },
      }),
    ).reasonCodes,
    ["capability_disabled"],
  );
  assert.equal(
    evaluateExecutionGuards(guardInput({ connector: null })).reasonCodes[0],
    "connector_missing",
  );
  assert.equal(
    evaluateExecutionGuards(guardInput({ outcomeContractPresent: false })).reasonCodes[0],
    "outcome_contract_missing",
  );
  assert.equal(
    evaluateExecutionGuards(guardInput({ decisionSuperseded: true })).reasonCodes[0],
    "decision_superseded",
  );
  const unknown = evaluateExecutionGuards(guardInput({ intent: { status: "unknown" } }));
  assert.deepEqual(
    [unknown.outcome, unknown.reasonCodes],
    ["BLOCKED", ["external_result_unknown"]],
  );
  assert.equal(
    evaluateExecutionGuards(guardInput({ priorSucceededExecutionId: "att-1" })).outcome,
    "ALREADY_COMPLETED",
  );
  assert.deepEqual(
    evaluateExecutionGuards(guardInput({ intent: { tenantId: "t2" } })).reasonCodes,
    ["cross_tenant_reference"],
  );
});

// ── 3 · SOURCE-SCAN contracts on the Deno adapter ───────────────────────────
const ADAPTER_SRC = readFileSync(
  new URL("../supabase/functions/_shared/connectors/marketing_email.ts", import.meta.url),
  "utf8",
);

test("adapter source: the provider message is built from the FROZEN envelope only", () => {
  // the MIME builder must consume env.* values…
  assert.match(ADAPTER_SRC, /fromName: env\.from_name/);
  assert.match(ADAPTER_SRC, /replyTo: env\.reply_to/);
  assert.match(ADAPTER_SRC, /signatureText: env\.signature_text/);
  assert.match(ADAPTER_SRC, /subject: env\.subject/);
  assert.match(ADAPTER_SRC, /bodyText: env\.body_text/);
  assert.match(ADAPTER_SRC, /to: env\.recipient_email/);
  // …and must never substitute the sender's CURRENT mutable content
  assert.doesNotMatch(ADAPTER_SRC, /sender\.from_name/);
  assert.doesNotMatch(ADAPTER_SRC, /sender\.reply_to/);
  assert.doesNotMatch(ADAPTER_SRC, /sender\.signature_text/);
});

test("adapter source: execution-time authority + canonical readiness rechecks exist", () => {
  assert.match(ADAPTER_SRC, /marketing_effective_permissions/);
  assert.match(ADAPTER_SRC, /evaluateActorAuthority/);
  assert.match(ADAPTER_SRC, /marketing_sender_readiness/);
  // exactly ONE provider call, no status-lookup claim
  assert.equal(ADAPTER_SRC.match(/fetch\(/g)?.length ?? 0, 1);
  assert.doesNotMatch(ADAPTER_SRC, /getStatus/);
});

test("adapter source: every mandatory pre-provider read distinguishes error from absence", () => {
  for (const marker of [
    "settingsRes.error",
    "actorRes.error",
    "verdictRes.error",
    "senderRes.error",
    "readinessRes.error",
    "capRes.error",
    "recipientRes.error",
    "tokenRes.error",
  ]) {
    assert.ok(ADAPTER_SRC.includes(marker), `adapter must check ${marker}`);
  }
  // the OAuth token lookup is tenant-bound, never id-only
  const tokenRead = ADAPTER_SRC.slice(ADAPTER_SRC.indexOf('from("email_oauth_tokens")'));
  assert.match(tokenRead.slice(0, 400), /\.eq\("tenant_id", input\.tenantId\)/);
});

// ── 4 · MOCKED ADAPTER BOUNDARY — fail-closed authority/state reads ─────────
// The real adapter.execute() runs against a scripted supabase client. Every
// mandatory pre-provider read is failed (a DB/resolver ERROR) or negated (a
// genuine "no") independently; the adapter must map errors to SAFE RETRYABLE
// pre-provider failures, genuine negatives to PERMANENT refusals, and must
// never reach the provider on either. A fully healthy script then proves the
// happy path still submits through the one provider call.

const FAKE_IDS = {
  sender: ENVELOPE.sender_profile_id,
  recipient: ENVELOPE.recipient_profile_id,
  actor: ENVELOPE.actor_profile_id,
};

function scriptedDb(script) {
  // per-table FIFO queues of {data, error} results; rpcs keyed by name
  const tables = structuredClone(script.tables);
  return {
    from(table) {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle() {
          const queue = tables[table];
          if (!queue || queue.length === 0) {
            return Promise.resolve({ data: null, error: { message: `unscripted ${table}` } });
          }
          return Promise.resolve(queue.shift());
        },
      };
      return q;
    },
    rpc(name) {
      return Promise.resolve(
        script.rpcs?.[name] ?? { data: null, error: { message: `unscripted rpc ${name}` } },
      );
    },
  };
}

const healthyScript = () => ({
  tables: {
    marketing_settings: [{ data: { marketing_enabled: true }, error: null }],
    profiles: [
      { data: { id: FAKE_IDS.actor, tenant_id: "t1" }, error: null }, // actor
      {
        data: { id: FAKE_IDS.recipient, tenant_id: "t1", email: "recipient@p4.test" },
        error: null,
      },
    ],
    marketing_sender_profiles: [
      {
        data: {
          id: FAKE_IDS.sender,
          tenant_id: "t1",
          source_kind: "gmail_oauth",
          email_account_id: "acc-1",
          workspace_mailbox_id: null,
          mailbox_address: "sender@p4.test",
          enabled: true,
        },
        error: null,
      },
    ],
    tenant_connector_capabilities: [{ data: { enabled: true }, error: null }],
    email_oauth_tokens: [
      {
        data: {
          access_token: "tok",
          refresh_token: "ref",
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          scope: `https://www.googleapis.com/auth/gmail.readonly ${GMAIL_SEND_SCOPE}`,
        },
        error: null,
      },
    ],
  },
  rpcs: {
    marketing_effective_permissions: {
      data: { enabled: true, permissions: ["marketing.view", "marketing.campaigns.test"] },
      error: null,
    },
    marketing_sender_readiness: {
      data: { sender_id: FAKE_IDS.sender, ready: true, state: "ready", enabled: true },
      error: null,
    },
  },
});

const ADAPTER_INPUT = {
  tenantId: "t1",
  capabilityKey: "email.send_marketing",
  intentType: "send_marketing_test_email",
  parameters: ENVELOPE,
};

async function runAdapter(script, { expectProviderCall = false, providerResponse } = {}) {
  const realFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    if (!expectProviderCall) throw new Error("provider must not be reached");
    return providerResponse();
  };
  try {
    const result = await marketingEmailAdapter.execute(ADAPTER_INPUT, {
      supabaseAdmin: scriptedDb(script),
      now: "2026-07-29T12:00:00.000Z",
      signal: null,
    });
    return { result, providerCalls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const READ_ERROR = { data: null, error: { message: "connection reset" } };

test("adapter boundary: each failed mandatory read is a SAFE RETRYABLE pre-provider refusal", async () => {
  const cases = [
    [
      "marketing_settings",
      (s) => (s.tables.marketing_settings = [READ_ERROR]),
      "settings_read_failed",
    ],
    ["actor row", (s) => (s.tables.profiles = [READ_ERROR]), "actor_read_failed"],
    [
      "authority resolver",
      (s) => (s.rpcs.marketing_effective_permissions = READ_ERROR),
      "authority_resolver_unavailable",
    ],
    [
      "sender row",
      (s) => (s.tables.marketing_sender_profiles = [READ_ERROR]),
      "sender_read_failed",
    ],
    [
      "readiness derivation",
      (s) => (s.rpcs.marketing_sender_readiness = READ_ERROR),
      "readiness_unavailable",
    ],
    [
      "capability row",
      (s) => (s.tables.tenant_connector_capabilities = [READ_ERROR]),
      "capability_read_failed",
    ],
    [
      "recipient row",
      (s) => (s.tables.profiles = [s.tables.profiles[0], READ_ERROR]),
      "recipient_read_failed",
    ],
    ["oauth token", (s) => (s.tables.email_oauth_tokens = [READ_ERROR]), "gmail_token_read_failed"],
  ];
  for (const [label, corrupt, code] of cases) {
    const script = healthyScript();
    corrupt(script);
    const { result, providerCalls } = await runAdapter(script);
    assert.equal(result.outcome, "failed_transient", `${label}: retryable, never a pass`);
    assert.equal(result.errorCode, code, label);
    assert.equal(result.retryable, true, label);
    assert.equal(providerCalls, 0, `${label}: the provider is never reached`);
  }
});

test("adapter boundary: a GENUINE negative answer is PERMANENT, never retried", async () => {
  // actor genuinely gone (the read succeeded and found nothing)
  const gone = healthyScript();
  gone.tables.profiles = [{ data: null, error: null }];
  const removed = await runAdapter(gone);
  assert.equal(removed.result.outcome, "failed_permanent");
  assert.equal(removed.result.errorCode, "actor_removed");
  assert.equal(removed.providerCalls, 0);
  // capability genuinely disabled
  const disabled = healthyScript();
  disabled.tables.tenant_connector_capabilities = [{ data: { enabled: false }, error: null }];
  const denied = await runAdapter(disabled);
  assert.equal(denied.result.outcome, "failed_permanent");
  assert.equal(denied.result.errorCode, "capability_disabled");
  assert.equal(denied.providerCalls, 0);
});

test("adapter boundary: the fully healthy path still submits through ONE provider call", async () => {
  const { result, providerCalls } = await runAdapter(healthyScript(), {
    expectProviderCall: true,
    providerResponse: () =>
      new Response(JSON.stringify({ id: "gm-mock-1", threadId: "thr-mock-1" }), { status: 200 }),
  });
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.externalReference, "gm-mock-1");
  assert.equal(providerCalls, 1);
});
