/**
 * Candidate-only, side-effect-free intake gate. Not an authentication endpoint.
 * The caller must construct Binding from authenticated provider/server state,
 * never from function parameters. Do not log the input or the successful intake.
 *
 * Vapi handoff-destination-request uses message.parameters and artifact.messages
 * (role + message), not toolCallList or originalMessage. A dynamic destination
 * accepts { destination } or { error }. This is a completeness/provenance check,
 * NOT proof of emergency eligibility, factual accuracy, or successful transfer.
 * Immediate safety advice must never wait for this check. Refusal/unavailability
 * needs an approved operator policy; this module invents no exception route.
 */
export const emergencyIntakeIds = Object.freeze({
  tenant: "00000000-0000-0000-0000-000000000001",
  candidate: "dcfc2e66-a438-43ab-b863-467f5a5089df",
  helper: "41bd1fd0-3ebf-4f43-9ded-512cb9305455",
});

export type EmergencyKind = "domestic" | "commercial" | "uncertain";
export type EmergencyIntakeBinding = {
  authenticated: boolean;
  tenantId: string;
  orgId: string;
  callId: string;
  assistantId: string;
  helperAssistantId: string;
  officeClosed: boolean;
};
export type EmergencyIntakeEvidence = {
  name: string;
  callback: string;
  callbackReadBack: string;
  callbackConfirmation: string;
  site: string;
  issue: string;
  classification: string;
};
export type EmergencyIntakeParameters = {
  destination: "dynamic";
  kind: EmergencyKind;
  callerName: string;
  callbackNumber: string;
  siteAddressOrPostcode: string;
  incidentSummary: string;
  evidence: EmergencyIntakeEvidence;
};
export type EmergencyIntakeReason =
  | "untrusted_binding" | "wrong_event" | "call_binding_mismatch"
  | "office_not_closed" | "malformed_parameters" | "missing_intake"
  | "invalid_artifact" | "fabricated_source_evidence" | "unusable_location"
  | "invalid_callback" | "unconfirmed_callback" | "stale_callback"
  | "stale_name_or_location" | "classification_mismatch";
type Rejected = { allowed: false; reason: EmergencyIntakeReason; needsReview: true };
type Accepted = {
  allowed: true;
  kind: EmergencyKind;
  /** Private caller data: never expose in public diagnostics or unscoped logs. */
  intake: Pick<EmergencyIntakeParameters, "callerName" | "callbackNumber" | "siteAddressOrPostcode" | "incidentSummary">;
  evidenceTurns: Record<keyof EmergencyIntakeEvidence, number>;
};
export type EmergencyIntakeResult = Rejected | Accepted;
type RecordValue = Record<string, unknown>;
type Turn = { index: number; role: "user" | "bot"; text: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const evidenceKeys = ["name", "callback", "callbackReadBack", "callbackConfirmation", "site", "issue", "classification"] as const;
const parameterKeys = ["destination", "kind", "callerName", "callbackNumber", "siteAddressOrPostcode", "incidentSummary", "evidence"];
const record = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);
const normal = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
const reject = (reason: EmergencyIntakeReason): Rejected => ({ allowed: false, reason, needsReview: true });
const boundedText = (value: unknown, max: number): value is string => typeof value === "string" && !!value.trim() && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const exactKeys = (value: RecordValue, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
// Callers often correct the immediately preceding fact without repeating its
// field name. Treat that uncertainty as a hold, never as a verified handoff.
const bareRetraction = (value: string) => /^(?:no|sorry|wait|hold on|actually)[,.:;\s]+(?:no[,.:;\s]+)?(?:that(?:'s| is)|it(?:'s| is))\s+(?:wrong|incorrect|not right|not correct)\b/i.test(normal(value));

function contains(text: string, quote: string): boolean {
  const haystack = normal(text), needle = normal(quote);
  if (!needle) return false;
  let position = haystack.indexOf(needle);
  while (position >= 0) {
    const before = haystack[position - 1], after = haystack[position + needle.length];
    if ((!before || !/[\p{L}\p{N}]/u.test(before)) && (!after || !/[\p{L}\p{N}]/u.test(after))) return true;
    position = haystack.indexOf(needle, position + 1);
  }
  return false;
}

/** Bounded UK/international digits and individual spoken digits, not caller ID. */
function phoneDigits(value: string): string | null {
  if (/\b(double|triple)\b/i.test(value)) return null;
  const words: Record<string, string> = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
  let digits = normal(value).replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g, word => words[word]).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = "44" + digits.slice(1);
  if (digits.startsWith("0044") && digits.length === 14) digits = digits.slice(2);
  return /^[1-9]\d{6,14}$/.test(digits) ? digits : null;
}

function concreteLocation(value: string): boolean {
  if (/\b(unknown|unavailable|not provided|n\/a|on file|same address)\b/i.test(value)) return false;
  // A house number plus only a street *type* ("14 Road") is not a usable
  // address. Accept common abbreviated street types without dropping the
  // required street name.
  if (/\b\d+[a-z]?\s+(?:[a-z'-]+\s+){1,5}(?:road|rd|street|st|lane|ln|avenue|ave|close|drive|dr|way|court|crescent|terrace|place|gardens|square)\b/i.test(value))
    return true;
  // A postcode identifies an area, not the caller's precise premises. Pair it
  // with a stated house/building name or number before authorising a handoff.
  const postcode = /\b(?:gir\s?0aa|[a-z]{1,2}\d[a-z\d]?\s?\d[a-z]{2})\b/i;
  if (!postcode.test(value)) return false;
  const detail = value.replace(postcode, "").replace(/[,.]/g, " ").trim();
  if (/^(?:(?:the|my|our|a|an)\s+)?(?:home|house|property|site|building|care home)$/i.test(detail)) return false;
  return detail.split(/\s+/).length >= 2 &&
    /\b(?:\d+[a-z]?|cottage|house|flat|unit|building|site|farm|hotel|school|care home|lodge|apartment)\b/i.test(detail);
}

function classification(value: string): EmergencyKind | null {
  const text = normal(value).replace(/\b(?:not|isn't|is not)\s+(?:a |an |my |our )?(?:domestic|commercial|business|home|house|care home)\b/g, " ");
  if (/\b(?:don't know|do not know|not sure|unsure|maybe)\b/.test(text)) return null;
  const domestic = /\b(?:domestic|(?:my|our) (?:own |private )?(?:home|house)|private home)\b/.test(text);
  const commercial = /\b(?:commercial|business|care home|workplace|hotel|factory|warehouse|school|prison)\b/.test(text);
  return domestic === commercial ? null : domestic ? "domestic" : "commercial";
}

// The fallback class must itself be caller evidence. A model's bare
// `kind: uncertain` is insufficient, and later explicit corrections win.
function uncertainClassification(value: string): boolean {
  const text = normal(value);
  return /\b(?:don't know|do not know|not sure|unsure)\b/.test(text) &&
    /\b(?:domestic|commercial|property type|site type|business or home|home or business)\b/.test(text);
}

function readTurns(artifact: unknown, assistantId: string): Turn[] | null {
  if (!record(artifact) || !Array.isArray(artifact.messages) || artifact.messages.length < 2 || artifact.messages.length > 256) return null;
  const result: Turn[] = [];
  let characters = 0;
  for (const [index, value] of artifact.messages.entries()) {
    if (!record(value) || typeof value.role !== "string") return null;
    // Tool/system messages cannot establish what a caller said.
    if (!["user", "bot", "assistant"].includes(value.role)) continue;
    if (!boundedText(value.message, 6000) || value.isFiltered === true) return null;
    if (value.role !== "user" && value.assistantId !== undefined && value.assistantId !== assistantId) return null;
    characters += value.message.length;
    if (characters > 64_000) return null;
    result.push({ index, role: value.role === "user" ? "user" : "bot", text: value.message });
  }
  return result;
}

/** All input is untrusted except the independently authenticated server binding. */
export function validateEmergencyIntake(message: unknown, binding: EmergencyIntakeBinding): EmergencyIntakeResult {
  if (!binding || binding.authenticated !== true || binding.tenantId !== emergencyIntakeIds.tenant ||
    binding.assistantId !== emergencyIntakeIds.candidate || binding.helperAssistantId !== emergencyIntakeIds.helper ||
    !uuid.test(binding.orgId) || !uuid.test(binding.callId)) return reject("untrusted_binding");
  if (!record(message) || message.type !== "handoff-destination-request") return reject("wrong_event");
  if (!record(message.call) || message.call.id !== binding.callId || message.call.orgId !== binding.orgId ||
    message.call.assistantId !== binding.assistantId || (message.assistant !== undefined &&
      (!record(message.assistant) || (message.assistant.id !== undefined && message.assistant.id !== binding.assistantId)))) return reject("call_binding_mismatch");
  if (binding.officeClosed !== true) return reject("office_not_closed");
  const p = message.parameters;
  if (!record(p) || !exactKeys(p, parameterKeys) || p.destination !== "dynamic" || !record(p.evidence) || !exactKeys(p.evidence, evidenceKeys)) return reject("malformed_parameters");
  if (!["domestic", "commercial", "uncertain"].includes(p.kind as string) || !boundedText(p.callerName, 100) ||
    !boundedText(p.callbackNumber, 32) || !boundedText(p.siteAddressOrPostcode, 300) || !boundedText(p.incidentSummary, 1000) ||
    !evidenceKeys.every(key => boundedText((p.evidence as RecordValue)[key], 1200))) return reject("missing_intake");
  const params = p as unknown as EmergencyIntakeParameters;
  const turns = readTurns(message.artifact, binding.assistantId);
  if (!turns) return reject("invalid_artifact");
  const userTurns = turns.filter(turn => turn.role === "user");
  const quoted = (key: keyof EmergencyIntakeEvidence, role: "user" | "bot" = "user") => turns.filter(turn => turn.role === role && contains(turn.text, params.evidence[key]));
  const name = quoted("name").at(-1), site = quoted("site").at(-1), issue = quoted("issue").at(-1), kind = quoted("classification").at(-1);
  if (!name || !site || !issue || !kind || !contains(params.evidence.name, params.callerName) ||
    !contains(params.evidence.site, params.siteAddressOrPostcode) || !contains(params.evidence.issue, params.incidentSummary)) return reject("fabricated_source_evidence");
  if (!concreteLocation(params.siteAddressOrPostcode)) return reject("unusable_location");
  const latestKind = userTurns.filter(turn => classification(turn.text) !== null || uncertainClassification(turn.text)).at(-1);
  const quotedKind = params.kind === "uncertain" ? uncertainClassification(kind.text) : classification(kind.text) === params.kind;
  const latestMatches = params.kind === "uncertain" ? !!latestKind && uncertainClassification(latestKind.text) :
    !!latestKind && classification(latestKind.text) === params.kind && !uncertainClassification(latestKind.text);
  if (!quotedKind || !latestMatches ||
    userTurns.some(turn => turn.index > kind.index && uncertainClassification(turn.text) && params.kind !== "uncertain"))
    return reject("classification_mismatch");
  // Fail closed on an explicit later correction rather than accepting a stale quote.
  for (const turn of userTurns) {
    if (turn.index > name.index && /\b(?:my name|call me|name is)\b/i.test(turn.text) && !contains(turn.text, params.callerName)) return reject("stale_name_or_location");
    // A caller can retract the location without supplying a replacement. The
    // earlier exact quote is then no longer safe evidence for an emergency handoff.
    if (turn.index > site.index && /\b(?:address|postcode|post code|location|site)\b/i.test(turn.text) &&
      /\b(?:wrong|incorrect|not right|not correct|not sure|unsure)\b/i.test(turn.text)) return reject("stale_name_or_location");
    if (turn.index > site.index && bareRetraction(turn.text)) return reject("stale_name_or_location");
    if (turn.index > site.index && /\b(?:actually|correction|correct address|wrong address|address is|postcode is|post code is|location is)\b/i.test(turn.text) &&
      (concreteLocation(turn.text) || /\b(?:address|postcode|post code|location)\b/i.test(turn.text)) && !contains(turn.text, params.siteAddressOrPostcode)) return reject("stale_name_or_location");
  }
  if (!/^[+\d()\s.-]{7,32}$/.test(params.callbackNumber)) return reject("invalid_callback");
  const number = phoneDigits(params.callbackNumber);
  if (!number) return reject("invalid_callback");
  const callback = quoted("callback").filter(turn => phoneDigits(params.evidence.callback) === number && phoneDigits(turn.text) === number).at(-1);
  if (!callback) return reject("fabricated_source_evidence");
  const readback = quoted("callbackReadBack", "bot").filter(turn => turn.index > callback.index && phoneDigits(turn.text) === number &&
    /\b(?:correct|right|confirm)\b/i.test(turn.text) && !/\b(?:not|wrong|incorrect)\b/i.test(turn.text)).at(-1);
  if (!readback) return reject("unconfirmed_callback");
  const confirmation = turns.find(turn => turn.index > readback.index);
  if (!confirmation || confirmation.role !== "user" || !contains(confirmation.text, params.evidence.callbackConfirmation) ||
    !/^(?:yes|yep|yeah|correct|that's right|that is right|that's correct|that is correct|exactly|absolutely)\b/.test(normal(confirmation.text)) ||
    /\b(?:no|not|wrong|incorrect|but|except|actually)\b/i.test(confirmation.text)) return reject("unconfirmed_callback");
  if (userTurns.some(turn => turn.index > confirmation.index && turn.index < site.index && bareRetraction(turn.text)))
    return reject("stale_callback");
  if (userTurns.some(turn => turn.index > confirmation.index && phoneDigits(turn.text) && phoneDigits(turn.text) !== number &&
    (/\b(?:number|phone|telephone|callback|call back|instead|correction)\b/i.test(turn.text) || /^[+\d()\s.-]+$/.test(turn.text)))) return reject("stale_callback");
  return {
    allowed: true, kind: params.kind,
    intake: { callerName: params.callerName, callbackNumber: params.callbackNumber, siteAddressOrPostcode: params.siteAddressOrPostcode, incidentSummary: params.incidentSummary },
    evidenceTurns: { name: name.index, site: site.index, issue: issue.index, classification: kind.index, callback: callback.index, callbackReadBack: readback.index, callbackConfirmation: confirmation.index },
  };
}

export function evaluateEmergencyIntake(message: unknown, binding: EmergencyIntakeBinding) {
  const result = validateEmergencyIntake(message, binding);
  if (!result.allowed) return {
    error: `Emergency intake not verified (${result.reason}). No handoff or telephone transfer was authorised. Continue with the caller and ask only for missing or corrected intake details. Never delay immediate safety advice. If details cannot be supplied, this needs OpenFolk review; do not invent a transfer or promise dispatch, voicemail or email delivery.`,
  };
  return { destination: { type: "assistant" as const, assistantId: emergencyIntakeIds.helper, contextEngineeringPlan: { type: "all" as const } } };
}

/** Trusted deployment configuration only. Does not save a tool or make a request. */
export function buildEmergencyIntakeHandoffTool(server: { url: string; headers: Record<string, string> }) {
  const url = new URL(server.url);
  if (server.url !== "https://tgbnakbxwcqjeimygroz.supabase.co/functions/v1/receptionist-intake-check" || url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    !record(server.headers) || !exactKeys(server.headers, ["X-OpenFolk-Intake-Token"]) || Object.entries(server.headers).some(([key, value]) =>
      !/^[a-zA-Z0-9-]+$/.test(key) || !boundedText(value, 4096) || /[\r\n]/.test(value))) throw Error("Invalid trusted intake server configuration.");
  const quote = { type: "string", description: "Exact short quote from the current conversation, not a paraphrase or invented fact." };
  return {
    type: "handoff" as const,
    function: {
      name: "Route-Emergency-to-Rob-or-Tony",
      description: "Eligible out-of-hours emergency internal handoff only, after immediate safety advice. Supply caller-provided facts and exact quotes. The server checks intake before any handoff; rejection means keep speaking with the caller, not end the call. This is not a completed telephone transfer.",
      parameters: {
        type: "object", required: parameterKeys,
        properties: {
          destination: { type: "string", enum: ["dynamic"] },
          kind: { type: "string", enum: ["domestic", "commercial", "uncertain"] },
          callerName: { type: "string", description: "Caller's stated name, exactly as spoken." },
          callbackNumber: { type: "string", description: "Caller-provided callback digits, read back by Emma and explicitly confirmed by the caller. Never substitute caller ID." },
          siteAddressOrPostcode: { type: "string", description: "Caller-provided numbered street address, or named/numbered premises with a UK postcode. A postcode alone or 'my home' is insufficient." },
          incidentSummary: { type: "string", description: "Short exact caller quote describing this incident." },
          evidence: { type: "object", required: [...evidenceKeys], properties: Object.fromEntries(evidenceKeys.map(key => [key, { ...quote, description: key === "callbackReadBack" ? "Exact Emma quote reading the entire callback number back and asking whether it is correct." : key === "callbackConfirmation" ? "Exact caller affirmative response immediately after Emma's callback readback." : quote.description }])) },
        },
      },
    },
    destinations: [{ type: "dynamic" as const, server: { url: server.url, headers: { ...server.headers } } }],
  };
}
