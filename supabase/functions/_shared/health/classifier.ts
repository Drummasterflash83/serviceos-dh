// ServiceOS — Customer Health: callback-candidate classifier (Deno, PURE).
//
// Deterministic, rule-based — NO AI (house style, like recommendations.ts / policy.ts).
// Decides whether one inbound communication is an EXPLICIT callback request, and if
// so extracts the requested outcome, a bounded/redacted excerpt, confidence,
// ambiguity, a suggested due expectation and ownership hints. Given the same input
// and config it always returns the same classification.
//
// The existing `respond_to_customer` recommendation is candidate EVIDENCE only — it
// is never treated as proof of an explicit callback request. This classifier decides
// eligibility from communication CONTENT + structured signals, never from the mere
// existence of an unanswered call.
//
// Three routes:
//   • candidate  — an explicit callback request
//   • exclude    — definitively not a callback (spam/internal/supplier/email-only/
//                  generic-unanswered/accidental/resolved-on-transfer)
//   • uncertain  — a real inbound whose intent cannot be established → needs_context

import {
  type CallbackClassification,
  type CallbackPolicyConfig,
  type CommunicationInput,
  DEFAULT_CALLBACK_POLICY,
  type OwnershipHint,
} from "./types.ts";
import { CALLBACK_CLASSIFIER_VERSION } from "./hash.ts";
import { redactText } from "./redact.ts";

// ── Phrase banks (lower-cased, matched against normalised text). ────────────
// Explicit "please call me back" style requests.
const CALLBACK_PHRASES = [
  "call me back",
  "call back",
  "callback",
  "please call",
  "can you call",
  "could you call",
  "give me a call",
  "give us a call",
  "ring me",
  "ring me back",
  "call me on",
  "call me asap",
  "return my call",
  "return call",
  "returning your call",
  "need a call",
  "needs a call",
  "want a call",
  "would like a call",
  "get someone to call",
  "have someone call",
  "someone call me",
  "when can someone call",
  "phone me",
  "please phone",
  "get back to me by phone",
  "call me when",
];

// Regex forms catch third-person summaries ("customer asked us to call them back",
// "requested a callback") that a fixed phrase bank misses.
const CALLBACK_REGEXES = [
  /call (?:me|us|them|him|her|you|the customer|the client)(?: back| again)?/,
  /(?:call|ring|phone) (?:me|us|them|him|her) (?:back|on|asap)/,
  /asked (?:us|you)?\s*to (?:call|ring|phone)/,
  /request(?:ed|ing|s)? (?:a )?call\s?back/,
  /request(?:ed|ing|s)? (?:a )?callback/,
  /would like (?:a )?(?:call|phone call)/,
  /wants? (?:a )?call/,
  /needs? (?:a )?call/,
  /return (?:my|the|their) call/,
  /chase (?:a|the)? ?call ?back/,
];

// "asks for someone unavailable to contact them"
const REACH_PERSON_PHRASES = [
  "is available to call",
  "ask him to call",
  "ask her to call",
  "ask them to call",
  "have him call",
  "have her call",
  "get him to call",
  "get her to call",
  "when he is free to call",
  "when she is free to call",
];

// Voicemail / message-left indicators.
const VOICEMAIL_MARKERS = [
  "voicemail",
  "left a message",
  "left message",
  "answerphone",
  "voice message",
];

// Email-only requests (explicitly wants email, not a call).
const EMAIL_ONLY_PHRASES = [
  "email me",
  "reply by email",
  "send me an email",
  "email the quote",
  "email the invoice",
  "send it over by email",
  "drop me an email",
  "confirm by email",
];

// Spam markers.
const SPAM_MARKERS = [
  "seo services",
  "rank your website",
  "cheap loans",
  "extended warranty",
  "you have won",
  "crypto",
  "marketing services",
];

// The caller explicitly DECLINED a callback ("no need to call me back"). Matched spans
// are scrubbed from the text before positive detection so "call me back" inside a
// negation never reads as a request. Any remaining positive signal is still honoured
// ("no need to call about the invoice, but please call me back about the boiler").
const NEGATED_CALLBACK_REGEXES = [
  /no need (?:for (?:you|anyone|us) )?to (?:call|ring|phone)(?: (?:me|us))?(?: back)?/,
  /no need for a (?:call ?back|callback|call)/,
  /(?:don'?t|do not|doesn'?t|won'?t) (?:have to|need to) (?:call|ring|phone)(?: (?:me|us))?(?: back)?/,
  /(?:don'?t|do not) (?:bother )?(?:call|ring|phone)(?:ing)?(?: (?:me|us))?(?: back)?/,
  /no (?:call ?back|callback) (?:is )?(?:needed|required|necessary)/,
  /(?:doesn'?t|don'?t|do not) (?:need|want) (?:a )?(?:call ?back|callback|call)/,
  /not necessary to (?:call|ring|phone)/,
];

// The BUSINESS committed to call the customer back ("told them we'll call back") — an
// explicit staff promise IS a callback obligation on the business (source-ownership:
// an explicit promise belongs to the promiser). Checked BEFORE self-callback so the
// we-forms are not misread as the customer calling us back.
const STAFF_COMMITMENT_REGEXES = [
  /we'?ll (?:call|ring|phone) (?:you|them|him|her|the (?:customer|caller))(?: back)?/,
  /we will (?:call|ring|phone)/,
  /told (?:the )?(?:customer|caller) (?:we|i)(?:'ll| will|'d) (?:call|ring|phone)/,
  /will (?:call|ring|phone) the (?:customer|caller) back/,
  /promised (?:to (?:call|ring|phone)|(?:a |the )?call ?back)/,
  /agreed to (?:call|ring|phone) (?:them|him|her|the customer) back/,
];

// The CUSTOMER will call US back (no obligation on the business). These must NOT be
// read as a request for a callback even though they contain "call ... back".
// Word boundaries matter: an unanchored /i'?ll call/ also matches inside "wILL CALL",
// wrongly excluding genuine "you will call me back" requests.
const SELF_CALLBACK_REGEXES = [
  /\bi'?ll (?:call|ring|phone)/,
  /\bi will (?:call|ring|phone)/,
  /\bi can (?:call|ring|phone)/,
  /\b(?:he|she)'?ll (?:call|ring|phone)/,
  /\b(?:he|she) (?:will|can) (?:call|ring|phone)/,
  /\bthey'?ll (?:call|ring|phone)/,
  /\bthey will (?:call|ring|phone)/,
  /(?:call|ring|phone) (?:you |them )?back (?:later|tomorrow|myself|another time)/,
  /(?:customer|caller) (?:said |says )?(?:they'?ll|they will|to) call/,
  /will call (?:you |us )?back (?:myself|later|themselves)/,
];
// Explicit "call ME/US back" — a genuine request TO the business (overrides self-callback).
// The single-word alternative is a GENERIC linguistic pattern (any requested person);
// no tenant staff name may ever be hardcoded here.
const REQUEST_TO_US_REGEXES = [
  /call me back/,
  /call me on/,
  /ring me/,
  /phone me/,
  /get (?:[a-z][a-z'-]*) to call me/,
  /have (?:[a-z][a-z'-]*) call me/,
  /ask .* to call me/,
];

// "requested name" extraction patterns → capture the following word(s).
const NAME_REQUEST_PATTERNS = [
  /speak to ([a-z][a-z'-]+)/i,
  /ask (?:for )?([a-z][a-z'-]+) to call/i,
  /for ([a-z][a-z'-]+) to (?:call|phone|ring)/i,
  /have ([a-z][a-z'-]+) (?:call|phone|ring)/i,
  /get ([a-z][a-z'-]+) to (?:call|phone|ring)/i,
  /is ([a-z][a-z'-]+) (?:there|available|free)/i,
];

function norm(...parts: Array<string | null | undefined>): string {
  return (
    parts
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      // Normalise typographic apostrophes so "I’ll" and "I'll" classify identically.
      .replace(/[‘’ʼ]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function anyPhrase(text: string, phrases: string[]): string | null {
  for (const p of phrases) if (text.includes(p)) return p;
  return null;
}

/** Bounded, redacted excerpt around the matched phrase (never a transcript). */
function makeExcerpt(
  raw: string,
  matched: string | null,
  cfg: CallbackPolicyConfig,
): string | null {
  if (!cfg.redactExcerpts && cfg.exposeTranscript) {
    return raw ? raw.slice(0, Math.max(40, cfg.maxExcerptChars)) : null;
  }
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const idx = matched ? lower.indexOf(matched) : -1;
  const start = idx >= 0 ? Math.max(0, idx - 24) : 0;
  let slice = raw.slice(start, start + cfg.maxExcerptChars).trim();
  // Redact obvious PII (emails, postcodes, sort codes, card/phone numbers, addresses).
  slice = redactText(slice);
  return (start > 0 ? "…" : "") + slice + (start + cfg.maxExcerptChars < raw.length ? "…" : "");
}

function extractRequestedName(text: string): string | null {
  for (const re of NAME_REQUEST_PATTERNS) {
    const m = text.match(re);
    if (m && m[1]) {
      const name = m[1].toLowerCase();
      // Skip obvious non-names captured by the generic patterns.
      if (
        ["me", "us", "you", "someone", "anyone", "them", "him", "her", "to", "the", "a"].includes(
          name,
        )
      ) {
        continue;
      }
      return name;
    }
  }
  return null;
}

function ownershipHint(input: CommunicationInput, requestedName: string | null): OwnershipHint {
  return {
    ddi: input.phoneTo ?? null,
    extension: input.extension ?? null,
    queue: input.queue ?? null,
    requestedName: input.requestedName ?? requestedName ?? null,
  };
}

/**
 * Classify one communication. Pure; `config` supplies tenant tuning (from
 * operating_profile_entries). `input.summary`/`bodyPreview` must already be safe
 * (no raw transcript) — the caller is responsible for that projection.
 */
export function classifyCallback(
  input: CommunicationInput,
  config: Partial<CallbackPolicyConfig> = {},
): CallbackClassification {
  const cfg: CallbackPolicyConfig = { ...DEFAULT_CALLBACK_POLICY, ...config };
  const text = norm(input.subject, input.summary, input.bodyPreview);
  const direction = (input.direction ?? "").toLowerCase();
  const disposition = (input.disposition ?? "").toLowerCase();
  const callerKind = (input.callerKind ?? "").toLowerCase();
  const intent = (input.intent ?? "").toLowerCase();
  const type = (input.interactionType ?? "").toLowerCase();

  const base = {
    supportingRef: input.interactionId,
    classifierVersion: CALLBACK_CLASSIFIER_VERSION,
  };
  const requestedName = extractRequestedName(text);
  const hint = ownershipHint(input, requestedName);

  const exclude = (reasonCode: string, reason: string): CallbackClassification => ({
    ...base,
    route: "exclude",
    candidate: false,
    reason,
    reasonCode,
    requestedOutcome: null,
    supportingExcerpt: null,
    confidence: 0.9,
    ambiguity: 0.1,
    suggestedDueHours: null,
    ownershipHint: hint,
  });
  const uncertain = (reasonCode: string, reason: string): CallbackClassification => ({
    ...base,
    route: "uncertain",
    candidate: false,
    reason,
    reasonCode,
    requestedOutcome: null,
    supportingExcerpt: makeExcerpt(norm(input.summary, input.bodyPreview), null, cfg),
    confidence: 0.3,
    ambiguity: 0.8,
    suggestedDueHours: null,
    ownershipHint: hint,
  });

  // ── Hard exclusions (precision guards). ───────────────────────────────────
  if (direction === "internal" || callerKind === "internal") {
    return exclude("internal", "Internal call — not a customer callback.");
  }
  if (direction === "outbound") {
    return exclude("outbound", "Outbound communication — not an inbound callback request.");
  }
  if (intent === "spam" || anyPhrase(text, SPAM_MARKERS)) {
    return exclude("spam", "Detected as spam / marketing.");
  }
  if (callerKind === "supplier" && !cfg.includeSuppliers) {
    return exclude("supplier", "Supplier call — excluded by policy.");
  }
  if (disposition === "resolved_on_transfer" || intent === "resolved") {
    return exclude(
      "resolved_on_transfer",
      "Resolved during the original interaction — no callback owed.",
    );
  }

  const isEmail = type.includes("email");

  // Scrub explicitly-declined callback spans BEFORE positive detection, so the
  // "call me back" inside "no need to call me back" never reads as a request. Any
  // positive signal OUTSIDE a negated span is still honoured.
  let scrubbed = text;
  for (const re of NEGATED_CALLBACK_REGEXES) {
    scrubbed = scrubbed.replace(new RegExp(re.source, "g"), " ");
  }
  const negated = scrubbed !== text;

  // The customer saying they will call US back is not a callback request — unless the
  // same message ALSO explicitly asks us to call them (request-to-us wins).
  const requestToUs = REQUEST_TO_US_REGEXES.some((re) => re.test(scrubbed));

  // Staff commitment ("told them we'll call back") — an explicit promise BY the
  // business IS a callback obligation. Must run before the self-callback check so
  // we-forms are not misread as the customer calling us back.
  let staffMatch: string | null = null;
  if (!requestToUs) {
    for (const re of STAFF_COMMITMENT_REGEXES) {
      const m = scrubbed.match(re);
      if (m) {
        staffMatch = m[0];
        break;
      }
    }
  }
  if (staffMatch) {
    return {
      ...base,
      route: "candidate",
      candidate: true,
      reason: "Staff committed to call the customer back — an explicit promise is owed.",
      reasonCode: "staff_callback_commitment",
      requestedOutcome: "Call the customer back as promised.",
      supportingExcerpt: makeExcerpt(
        norm(input.summary, input.bodyPreview, input.subject),
        staffMatch,
        cfg,
      ),
      confidence: 0.85,
      ambiguity: 0.2,
      suggestedDueHours: cfg.defaultDueHours,
      ownershipHint: hint,
    };
  }

  if (!requestToUs && SELF_CALLBACK_REGEXES.some((re) => re.test(scrubbed))) {
    return exclude(
      "customer_will_call_back",
      "Customer will call back themselves — no callback owed.",
    );
  }
  const phraseHit =
    anyPhrase(scrubbed, CALLBACK_PHRASES) ?? anyPhrase(scrubbed, REACH_PERSON_PHRASES);
  const regexHit = CALLBACK_REGEXES.some((re) => re.test(scrubbed)) ? "call back" : null;
  const hasCallbackPhrase = phraseHit ?? regexHit;
  const emailOnly = anyPhrase(text, EMAIL_ONLY_PHRASES);

  // Explicit decline with no remaining request → definitively no callback owed.
  if (negated && !requestToUs && !hasCallbackPhrase) {
    return exclude("callback_declined", "Caller explicitly said no callback is needed.");
  }

  // Email that explicitly wants an email reply and does NOT ask for a call → exclude.
  if (isEmail && emailOnly && !hasCallbackPhrase) {
    return exclude("email_only", "Message requests an email response only.");
  }

  // Accidental / empty: no content and nothing left.
  const emptyish = text.length < 3;
  const noMessage =
    disposition === "no_message" || disposition === "abandoned" || disposition === "accidental";
  if (emptyish && (noMessage || disposition === "missed" || disposition === "")) {
    return exclude("accidental_empty", "Empty/abandoned contact with no message.");
  }

  // Generic unanswered call with NO callback request → exclude (a missed call is not
  // a callback request on its own — this is the key precision case).
  const missedNoVoicemail =
    (disposition === "missed" || disposition === "no_answer" || disposition === "unanswered") &&
    !anyPhrase(text, VOICEMAIL_MARKERS) &&
    !hasCallbackPhrase;
  if (missedNoVoicemail) {
    return exclude(
      "generic_unanswered_no_request",
      "Unanswered call with no callback request left.",
    );
  }

  // ── Positive detection. ───────────────────────────────────────────────────
  const isVoicemail = disposition === "voicemail" || anyPhrase(text, VOICEMAIL_MARKERS) !== null;
  const telephoneBased =
    !cfg.telephoneBased || // if policy doesn't require telephone-based, accept any channel
    !isEmail || // phone/voicemail are telephone-based
    hasCallbackPhrase !== null; // an email that explicitly asks for a call is telephone-based

  if (hasCallbackPhrase && telephoneBased) {
    // Strong explicit request.
    const matched = hasCallbackPhrase;
    const dueHours = /(urgent|asap|today|emergency|leak|no heat|no hot water)/.test(text)
      ? cfg.priorityDueHours
      : cfg.defaultDueHours;
    const ambiguity = requestedName || isVoicemail ? 0.15 : 0.1;
    return {
      ...base,
      route: "candidate",
      candidate: true,
      reason: requestedName
        ? `Explicit callback request (asked for ${requestedName}).`
        : "Explicit callback request in the message.",
      reasonCode: requestedName ? "explicit_callback_named" : "explicit_callback_phrase",
      requestedOutcome: requestedName
        ? `Call the customer back (asked for ${requestedName}).`
        : "Call the customer back.",
      supportingExcerpt: makeExcerpt(
        norm(input.summary, input.bodyPreview, input.subject),
        matched,
        cfg,
      ),
      confidence: 0.92,
      ambiguity,
      suggestedDueHours: dueHours,
      ownershipHint: hint,
    };
  }

  // Voicemail left, but no clear "call me" phrase — likely a return call is expected,
  // yet the intent is not explicit. Treat as a weaker candidate ONLY if content
  // suggests a request; otherwise route to uncertainty.
  if (isVoicemail) {
    const softRequest =
      /(?:regarding|about|enquiry|query|quote|booking|appointment|job|invoice|service|boiler|repair)/.test(
        text,
      );
    if (softRequest) {
      return {
        ...base,
        route: "candidate",
        candidate: true,
        reason: "Voicemail left about an enquiry — a return call is expected.",
        reasonCode: "voicemail_return_call",
        requestedOutcome: "Return the customer's call.",
        supportingExcerpt: makeExcerpt(norm(input.summary, input.bodyPreview), "voicemail", cfg),
        confidence: 0.7,
        ambiguity: 0.45,
        suggestedDueHours: cfg.defaultDueHours,
        ownershipHint: hint,
      };
    }
    return uncertain(
      "voicemail_unclear",
      "Voicemail left but the request could not be established.",
    );
  }

  // Answered inbound with content but no explicit callback ask → not a callback.
  if (disposition === "answered" && !hasCallbackPhrase) {
    return exclude("answered_no_request", "Answered call with no callback request.");
  }

  // Inbound with content but intent unclear → uncertainty (needs_context).
  if (text.length >= 3) {
    return uncertain(
      "intent_unclear",
      "Inbound communication whose intent could not be established.",
    );
  }

  return exclude("no_signal", "No callback signal detected.");
}
