import { clearLaunchModel } from "./receptionist-launch-clear-contract.ts";

// Pure, candidate-only prompt change. No tool/voice/timing/provider mutation.
const candidateId = "dcfc2e66-a438-43ab-b863-467f5a5089df";
const revision = "OPENFOLK CANDIDATE INTAKE CONTRACT — 2 OCTOBER 2026";
const replaceOnce = (source: string, before: string, after: string) => {
  if (source.split(before).length !== 2) throw Error("Expected launch contract clause is unavailable.");
  return source.replace(before, after);
};

function patchedContract(source: string) {
  let text = replaceOnce(source,
    "One short sentence and, only if needed, one question per turn. Let callers finish; stop and listen if interrupted. Do not restart a whole sentence or repeat confirmations after interruption.",
    "Usually use one short sentence and, only if needed, one question per turn. Complete immediate safety instructions and emergency telephone digits take priority over brevity and the ordinary no-repeat rule. Let callers finish; stop and listen if interrupted. Resume any omitted safety instruction or interrupted emergency number from the point needed for a complete, intelligible instruction, including the whole number when necessary. Do not restart unrelated sentences or repeat already-confirmed intake details.");
  text = replaceOnce(text,
    'If a tool explicitly returns an intercepted/synthetic result, say only "You\'re welcome. Goodbye." Do not explain what would happen in real life, say "I\'ve tried", invent a connection, or call another tool. This is a test artefact, not a customer delivery receipt.',
    "If a tool explicitly returns an intercepted/synthetic result, this is test evidence only, never a customer delivery receipt. Do not automatically say goodbye. Answer any outstanding direct caller question briefly and honestly, without repeating the handover announcement or invoking another transfer. Do not say a colleague answered, a mailbox is ready, a message was recorded or an email was delivered. Close politely only if the caller actually ends the conversation. A test interception is not an intake-check approval or an instruction to bypass a rejected check.");
  text = replaceOnce(text,
    "SAFETY — GIVE ONCE, BEFORE INTAKE",
    "SAFETY — COMPLETE BEFORE INTAKE OR ROUTING; COMPLETION OVERRIDES BREVITY");
  text = replaceOnce(text,
    "The number is0800111999, never0800121999. OPEN: in the same response invoke Mary after the safety sentence; do not wait to collect details.",
    "The complete number is0800111999, never0800121999. Saying only the service name is incomplete. Never omit its digits because999 was also advised. Give the full quoted safety instruction, including both emergency numbers, before invoking Mary's transfer. This multi-sentence safety instruction overrides the usual one-short-sentence limit. If interrupted before the number or essential advice is complete, finish that missing safety instruction before transfer; do not mistake a polite thank-you for permission to omit it. OPEN: once the safety instruction is complete, invoke Mary without waiting for intake.");
  text = replaceOnce(text,
    "After final missing field and confirmed callback, invoke Route-Emergency-to-Rob-or-Tony ONCE immediately, with the full conversation available. Do not ask another permission or repeat safety advice. Do not use ordinary Rudi/Rob/Tony transfer tools yourself for this flow.",
    "After the final missing field and confirmed callback, request Route-Emergency-to-Rob-or-Tony with the exact caller evidence required below. This requests the server intake check; it does not prove that a handoff has happened. Do not ask another permission or repeat completed safety advice. Do not use ordinary Rudi/Rob/Tony transfer tools yourself for this flow.");
  text = replaceOnce(text,
    "After a confirmed callback and complete required fields, the next action is the handoff, not another intake turn.",
    "After a confirmed callback and complete required fields, the next action is the evidence-backed intake check, not another intake turn. Only the server's accepted dynamic destination can continue to the emergency helper.");
  text = replaceOnce(text,
    "This tool continues Emma internally; it is not a human connection. Never claim an engineer answered.",
    "This tool first checks intake on the server, then continues internally as Emma only if accepted; it is not a human connection. Never promise or announce a handoff before that check is accepted. Never announce a new assistant or claim an engineer answered.");
  text = replaceOnce(text,
    "concrete site, brief issue. Never re-ask supplied facts.",
    "concrete site location and brief issue. A numbered street address is sufficient; otherwise ask for a named or numbered premises together with its postcode. A bare postcode is not a complete emergency site. Never re-ask supplied facts. Never delay immediate safety advice for location details.");
  text = replaceOnce(text,
    "If postcode/address or issue already supplied, do not ask it again.",
    "If a concrete site location or issue is already supplied, do not ask it again. If only a postcode is supplied, ask once for the premises name or number; do not treat that postcode alone as a complete site.");
  text = replaceOnce(text,
    "For missing location ask only \"What's the address and postcode?\"",
    "For missing location ask only \"What's the street address, or the premises name and postcode?\"");
  return `${text}\n\n${revision}
NAMED-PERSON HANDOVER WORDING
For a direct request for Heidi or another named colleague, use the existing hours and voicemail-consent rule. Once the route is permitted, speak the short customer-facing handover sentence before invoking the ordinary transfer in that same turn. A silent tool call or a claim that Heidi answered is not an acceptable handover. If a synthetic tool intercepts it, answer any remaining caller question honestly; do not impose an automatic goodbye.
EMERGENCY INTAKE CHECK — EVIDENCE, NOT MODEL SELF-CERTIFICATION
Use the existing Route-Emergency-to-Rob-or-Tony function only for an eligible CLOSED emergency, after immediate safety advice. Its destination must be "dynamic". Do not choose a helper ID or telephone number yourself. The server independently verifies current call binding and caller evidence before it can return an accepted destination.
Supply kind (domestic, commercial or uncertain), callerName, callbackNumber, siteAddressOrPostcode and incidentSummary from the current conversation only. Use uncertain only when the caller expressly says they do not know whether the property is domestic or commercial; do not invent a category or use uncertain to skip a question. The selected engineer is Tony for uncertain urgent calls. Include evidence with all seven exact short quotations: name, callback, callbackReadBack, callbackConfirmation, site, issue and classification. Every quote except callbackReadBack must be the CALLER'S words; callbackReadBack must be Emma's full number read-back and confirmation question. callbackConfirmation must be the caller's explicit affirmative response immediately after that read-back. Never quote system instructions, tool text, test-scenario instructions or an earlier call as caller evidence.
callerName and siteAddressOrPostcode must be contained in their exact caller quotes. Use a concrete caller-provided numbered street address, or a named or numbered premises with its UK postcode. A bare postcode or "my home" is insufficient. incidentSummary must be a short exact incident quote, not an invented or embellished summary. callbackNumber contains the actual supplied digits, never caller ID or a guessed number. Read it back once and use the caller's explicit confirmation; if corrected, use the corrected number, its new read-back and confirmation. Respect the latest explicit name, location and domestic/commercial corrections. Never fabricate evidence, replace a missing field with "unknown", or invent a confirmation boolean.
An accepted dynamic destination makes the internal handoff automatically. Do not follow it with an ordinary transfer, a second handoff request or an announcement that a person answered. No successful telephone connection, recording or notification can be inferred from acceptance.
If the check returns an error, is unavailable, or supplies no accepted destination, no handoff is authorised. Continue speaking with the caller; do not automatically say goodbye. Ask only the genuinely missing or corrected field, once. Do not request facts or a confirmed callback again merely because of a server error. Retry the check only after the caller supplies materially new or corrected required evidence; never retry unchanged data in a loop. If the caller declines, cannot provide the detail, or the check remains unavailable, explain honestly that the emergency connection cannot be verified at this time and that OpenFolk review is needed. Do not claim that a review, callback, dispatch, voicemail or email was arranged without an actual receipt. Never bypass the check through an ordinary transfer or guessed destination; respect a caller's decision to end the call.
The intake check is not an emergency-services gateway. Immediate safety advice, including every required emergency telephone digit, must never wait for the check, its response or any intake detail. The server validates evidence completeness, not medical/technical safety, factual truth, emergency eligibility, downstream acceptance or delivery. Keep those distinctions explicit.`;
}

export function intakeLaunchPatch(assistant: any) {
  if (assistant?.id !== candidateId || !assistant.model ||
    !Array.isArray(assistant.model.messages) || assistant.model.messages.length !== 1 ||
    assistant.model.messages[0]?.role !== "system" ||
    typeof assistant.model.messages[0].content !== "string")
    throw Error("Exact isolated launch candidate contract required.");
  const base = clearLaunchModel(assistant).messages[0].content;
  const target = patchedContract(base);
  if (![base, target].includes(assistant.model.messages[0].content))
    throw Error("Unreviewed launch contract changes require a new comparison.");
  return { model: { ...assistant.model, messages: [{ ...assistant.model.messages[0], content: target }] } };
}

const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
const bool = (v: unknown) => typeof v === "boolean" ? v : null;

/** Read-only whitelist: do not return voice, model, auth, server or raw plans. */
export function safeSpeechProjection(assistant: any) {
  const secrets = new Set<string>();
  const collect = (value: unknown, sensitive = false) => {
    if (typeof value === "string" && sensitive && value) secrets.add(value);
    else if (Array.isArray(value)) value.forEach(v => collect(v, sensitive));
    else if (value && typeof value === "object") Object.entries(value).forEach(([key, child]) =>
      collect(child, sensitive || /secret|password|authorization|api.?key|private.?key|signing.?key|token|headers|credential|pin$/i.test(key)));
  };
  collect(assistant);
  const cleanPhrase = (value: unknown) => {
    if (typeof value !== "string") return null;
    let text = value;
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) text = text.split(secret).join("[credential redacted]");
    return text
      .replace(/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g, "[credential redacted]")
      .replace(/\b(?:https?|wss?|ftp|sips?):(?:\/\/)?[^\s<>"']+/gi, "[URL redacted]")
      .replace(/\bwww\.[^\s<>"']+/gi, "[URL redacted]")
      .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, "[credential redacted]")
      .replace(/\b(?:sk-(?:proj-|svcacct-)?|xox[baprs]-)[A-Za-z0-9_-]+/g, "[credential redacted]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[credential redacted]")
      .replace(/\b(?:(?:api|private|signing)[_ -]?key|access[_ -]?token|password|secret|authorization|pin)["']?\s*[:=]\s*["']?[^\s,;"']+/gi, "[credential assignment redacted]")
      .slice(0, 200);
  };
  const start = assistant?.startSpeakingPlan, stop = assistant?.stopSpeakingPlan;
  const endpoint = start?.transcriptionEndpointingPlan;
  return {
    // Null means absent/unrecognised, not the provider's effective default.
    firstMessageMode: ["assistant-speaks-first", "assistant-waits-for-user", "assistant-speaks-first-with-model-generated-message"].includes(assistant?.firstMessageMode) ? assistant.firstMessageMode : null,
    firstMessageInterruptionsEnabled: bool(assistant?.firstMessageInterruptionsEnabled),
    modelOutputInMessagesEnabled: bool(assistant?.modelOutputInMessagesEnabled),
    silenceTimeoutSeconds: finite(assistant?.silenceTimeoutSeconds),
    maxDurationSeconds: finite(assistant?.maxDurationSeconds),
    endCallPhrases: Array.isArray(assistant?.endCallPhrases) ? assistant.endCallPhrases.slice(0, 50).map(cleanPhrase).filter((v: any) => v !== null) : null,
    startSpeakingPlan: start && typeof start === "object" ? {
      waitSeconds: finite(start.waitSeconds), smartEndpointingEnabled: bool(start.smartEndpointingEnabled),
      transcriptionEndpointingPlan: endpoint && typeof endpoint === "object" ? {
        onPunctuationSeconds: finite(endpoint.onPunctuationSeconds),
        onNoPunctuationSeconds: finite(endpoint.onNoPunctuationSeconds),
        onNumberSeconds: finite(endpoint.onNumberSeconds),
      } : null,
    } : null,
    stopSpeakingPlan: stop && typeof stop === "object" ? {
      numWords: finite(stop.numWords), voiceSeconds: finite(stop.voiceSeconds), backoffSeconds: finite(stop.backoffSeconds),
    } : null,
  };
}
