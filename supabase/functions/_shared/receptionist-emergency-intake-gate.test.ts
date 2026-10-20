import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEmergencyIntakeHandoffTool,
  emergencyIntakeIds as ids,
  evaluateEmergencyIntake,
  validateEmergencyIntake,
  type EmergencyIntakeBinding,
  type EmergencyIntakeReason,
} from "./receptionist-emergency-intake-gate.ts";

function fixture(kind: "domestic" | "commercial" | "uncertain" = "domestic") {
  const binding: EmergencyIntakeBinding = {
    authenticated: true, tenantId: ids.tenant, assistantId: ids.candidate, helperAssistantId: ids.helper,
    orgId: "10000000-0000-0000-0000-000000000001", callId: "20000000-0000-0000-0000-000000000001", officeClosed: true,
  };
  const callerName = "Test Caller", callbackNumber = "01632 960001";
  const siteAddressOrPostcode = "OpenFolk Test Site, Example Road, Romsey, SO51 8AS";
  const classification = kind === "domestic" ? "I am at my own home." : kind === "commercial" ? "This is a commercial care home." : "I am not sure whether this is domestic or commercial.";
  const incidentSummary = kind === "domestic" ? "An uncontrolled major water leak is flooding my kitchen." : kind === "commercial" ? "Our care home has no hot water and vulnerable residents need emergency help." : "There is no heating and vulnerable people need urgent help.";
  const callbackReadBack = "Your callback number is 01632 960001. Is that correct?", callbackConfirmation = "Yes, that's correct.";
  const text = [
    ["user", `${classification} ${incidentSummary}`],
    ["bot", "Take the immediate safety action we discussed; do not wait for our questions."],
    ["bot", "May I take your name?"], ["user", `My name is ${callerName}.`],
    ["bot", "What number should the engineer call you back on?"], ["user", `My callback number is ${callbackNumber}.`],
    ["bot", callbackReadBack], ["user", callbackConfirmation],
    ["bot", "What is the site address or postcode?"], ["user", `The address is ${siteAddressOrPostcode}.`],
  ];
  const message: any = {
    type: "handoff-destination-request", call: { id: binding.callId, orgId: binding.orgId, assistantId: ids.candidate }, assistant: { id: ids.candidate },
    parameters: { destination: "dynamic", kind, callerName, callbackNumber, siteAddressOrPostcode, incidentSummary,
      evidence: { name: `My name is ${callerName}.`, callback: `My callback number is ${callbackNumber}.`, callbackReadBack, callbackConfirmation,
        site: `The address is ${siteAddressOrPostcode}.`, issue: incidentSummary, classification } },
    artifact: { messages: text.map(([role, message]) => ({ role, message, ...(role === "bot" ? { assistantId: ids.candidate } : {}) })) },
  };
  return { binding, message, check: () => validateEmergencyIntake(message, binding) };
}

function rejected(f: ReturnType<typeof fixture>, reason: EmergencyIntakeReason) {
  assert.deepEqual(f.check(), { allowed: false, reason, needsReview: true });
  const response = evaluateEmergencyIntake(f.message, f.binding);
  assert.equal("destination" in response, false);
  assert.deepEqual(Object.keys(response), ["error"]);
  assert.match(response.error!, /Never delay immediate safety advice/);
  assert.match(response.error!, /No handoff or telephone transfer was authorised/);
  for (const value of ["Test Caller", "01632", "SO51", "kitchen", "care home"]) assert.equal(response.error!.includes(value), false, "Errors do not expose caller data");
}

for (const kind of ["domestic", "commercial", "uncertain"] as const) {
  test(`complete caller-grounded ${kind} intake permits only fixed internal helper`, () => {
    const f = fixture(kind), before = structuredClone(f.message), result = f.check();
    assert.equal(result.allowed, true);
    if (!result.allowed) return;
    assert.equal(result.kind, kind);
    assert.deepEqual(result.evidenceTurns, { name: 3, callback: 5, callbackReadBack: 6, callbackConfirmation: 7, site: 9, issue: 0, classification: 0 });
    assert.deepEqual(evaluateEmergencyIntake(f.message, f.binding), { destination: { type: "assistant", assistantId: ids.helper, contextEngineeringPlan: { type: "all" } } });
    assert.deepEqual(f.message, before, "Validation cannot alter call evidence");
  });
  test(`replays observed ${kind} failure pattern: name and callback without site must not hand off`, () => {
    const f = fixture(kind);
    f.message.artifact.messages.splice(8);
    if (kind === "commercial") f.message.artifact.messages.push({ role: "bot", message: "Goodbye.", assistantId: ids.candidate });
    f.message.parameters.siteAddressOrPostcode = "";
    f.message.parameters.evidence.site = "";
    rejected(f, "missing_intake");
  });
}

for (const [field, value] of [
  ["authenticated", false], ["tenantId", "another-tenant"], ["assistantId", "4eb2bee8-ac25-47c9-b962-409ed250ceb6"],
  ["helperAssistantId", "another-helper"], ["orgId", ""], ["callId", ""],
] as const) test(`rejects untrusted binding: ${field}`, () => {
  const f = fixture(); (f.binding as any)[field] = value; rejected(f, "untrusted_binding");
});

for (const field of ["id", "orgId", "assistantId"] as const) test(`rejects event ${field} differing from trusted call`, () => {
  const f = fixture(); f.message.call[field] = "30000000-0000-0000-0000-000000000001"; rejected(f, "call_binding_mismatch");
});

test("rejects helper/live request and ordinary daytime routing", () => {
  const f = fixture(); f.message.assistant.id = ids.helper; rejected(f, "call_binding_mismatch");
  f.message.assistant.id = ids.candidate; f.binding.officeClosed = false; rejected(f, "office_not_closed");
});

test("requires dynamic event; an ordinary tool invocation cannot masquerade as this gate", () => {
  const f = fixture(); f.message.type = "tool-calls"; rejected(f, "wrong_event");
});

for (const field of ["callerName", "callbackNumber", "siteAddressOrPostcode", "incidentSummary", "kind"] as const) test(`requires non-empty ${field}`, () => {
  const f = fixture(); f.message.parameters[field] = ""; rejected(f, "missing_intake");
});

test("model booleans and model-chosen destinations cannot bypass validation", () => {
  const f = fixture(); f.message.parameters.callbackConfirmed = true; rejected(f, "malformed_parameters");
  delete f.message.parameters.callbackConfirmed; f.message.parameters.destination = ids.helper; rejected(f, "malformed_parameters");
  f.message.parameters.destination = "dynamic"; f.message.parameters.evidence.confirmed = true; rejected(f, "malformed_parameters");
});

for (const field of ["name", "site", "issue", "classification", "callback"] as const) test(`rejects fabricated ${field} quote`, () => {
  const f = fixture(); f.message.parameters.evidence[field] = "A statement the caller never made."; rejected(f, "fabricated_source_evidence");
});

test("facts asserted only by Emma do not count as caller-provided intake", () => {
  const f = fixture(); f.message.artifact.messages[9].role = "bot"; rejected(f, "fabricated_source_evidence");
});

test("a correctly quoted statement cannot support a fabricated field value", () => {
  const f = fixture(); f.message.parameters.callerName = "Someone Else"; rejected(f, "fabricated_source_evidence");
});

test("generic or incomplete location, bare postcode, a partial word match and named-site-only evidence fail closed", () => {
  for (const place of ["my home", "here", "OpenFolk Test Site", "same address", "SO51 8AS", "Romsey, SO51 8AS", "SO51 8AS on file", "14 Road", "14 St"]) {
    const f = fixture(); f.message.parameters.siteAddressOrPostcode = place;
    f.message.parameters.evidence.site = `The address is ${place}.`; f.message.artifact.messages[9].message = f.message.parameters.evidence.site;
    rejected(f, "unusable_location");
  }
  const f = fixture(); f.message.parameters.callerName = "Caller";
  f.message.parameters.evidence.name = "My name is Callers."; f.message.artifact.messages[3].message = f.message.parameters.evidence.name;
  rejected(f, "fabricated_source_evidence");
});

test("a quoted numbered street is accepted without postcode, but not geocoded or claimed verified", () => {
  for (const address of ["12 Example Road", "12 Example Rd", "12 Example St"]) {
    const f = fixture(); f.message.parameters.siteAddressOrPostcode = address;
    f.message.parameters.evidence.site = `My home is at ${address}.`; f.message.artifact.messages[9].message = f.message.parameters.evidence.site;
    assert.equal(f.check().allowed, true);
  }
});

test("a named premises with postcode supports emergency location without inventing a street number", () => {
  const f = fixture(); f.message.parameters.siteAddressOrPostcode = "Rose Cottage, SO51 8AS";
  f.message.parameters.evidence.site = "My home is Rose Cottage, SO51 8AS.";
  f.message.artifact.messages[9].message = f.message.parameters.evidence.site;
  assert.equal(f.check().allowed, true);
});

test("caller ID and a callbackConfirmed boolean cannot replace spoken number provenance", () => {
  const f = fixture(); f.message.customer = { number: "+441632960001" };
  f.message.artifact.messages[5].message = "Use the number I am calling from."; rejected(f, "fabricated_source_evidence");
});

test("correct callback must have a complete readback and a subsequent caller confirmation", () => {
  const f = fixture(); f.message.artifact.messages[6].message = "Is that number correct?"; rejected(f, "unconfirmed_callback");
  f.message.artifact.messages[6].message = "Your callback number is 01632 960002. Is that correct?"; f.message.parameters.evidence.callbackReadBack = f.message.artifact.messages[6].message; rejected(f, "unconfirmed_callback");
});

for (const confirmation of ["Thank you.", "Yes, but that number is wrong.", "Yes, except for the last digit.", "No, that's not correct.", "Actually, no.", "I did not say yes."]) test(`does not accept ambiguous/negative callback confirmation: ${confirmation}`, () => {
  const f = fixture(); f.message.artifact.messages[7].message = confirmation; f.message.parameters.evidence.callbackConfirmation = confirmation; rejected(f, "unconfirmed_callback");
});

test("quoting only 'Yes' cannot hide a contradictory full response", () => {
  const f = fixture(); f.message.artifact.messages[7].message = "Yes, but actually that is the wrong number."; f.message.parameters.evidence.callbackConfirmation = "Yes"; rejected(f, "unconfirmed_callback");
});

test("assistant agreement, confirmation before readback and intervening conversation do not qualify", () => {
  const f = fixture(); f.message.artifact.messages[7].role = "bot"; rejected(f, "unconfirmed_callback");
  f.message.artifact.messages[7].role = "user";
  f.message.artifact.messages.splice(7, 0, { role: "bot", message: "And where are you?" }); rejected(f, "unconfirmed_callback");
});

test("spoken individual digits and UK international form compare consistently", () => {
  const f = fixture(); f.message.parameters.callbackNumber = "+44 1632 960001";
  f.message.artifact.messages[5].message = "My callback is zero one six three two nine six zero zero zero one.";
  f.message.parameters.evidence.callback = f.message.artifact.messages[5].message;
  f.message.artifact.messages[6].message = "Zero one six three two nine six zero zero zero one. Is that correct?";
  f.message.parameters.evidence.callbackReadBack = f.message.artifact.messages[6].message;
  assert.equal(f.check().allowed, true);
});

test("later corrected callback invalidates an otherwise complete intake", () => {
  const f = fixture(); f.message.artifact.messages.push({ role: "user", message: "Actually use phone number 01632 960002 instead." }); rejected(f, "stale_callback");
});

test("a caller retracting the confirmed callback without repeating its digits blocks handoff", () => {
  const f = fixture();
  f.message.artifact.messages.splice(8, 0, { role: "user", message: "Wait, that's wrong." });
  rejected(f, "stale_callback");
});

test("later explicit name/address corrections invalidate stale evidence", () => {
  for (const correction of ["My name is Someone Else.", "Actually, the address is 14 Different Road.", "Correction: the postcode is SO51 8AB."]) {
    const f = fixture(); f.message.artifact.messages.push({ role: "user", message: correction }); rejected(f, "stale_name_or_location");
  }
});

test("a caller retracting the address without a replacement blocks the emergency handoff", () => {
  for (const correction of [
    "Sorry, that is the wrong address.",
    "That postcode is incorrect.",
    "I'm not sure about the site location.",
    "No, that's not right.",
    "Actually, it's incorrect.",
  ]) {
    const f = fixture();
    f.message.artifact.messages.push({ role: "user", message: correction });
    rejected(f, "stale_name_or_location");
  }
});

test("classification cannot be overridden by model choice or stale quotes", () => {
  const f = fixture(); f.message.parameters.kind = "commercial"; rejected(f, "classification_mismatch");
  f.message.parameters.kind = "domestic";
  f.message.artifact.messages.push({ role: "user", message: "Actually this is a commercial care home." }); rejected(f, "classification_mismatch");
});

test("unknown classification after an earlier assumption needs review", () => {
  const f = fixture(); f.message.artifact.messages.push({ role: "user", message: "I am not sure whether this is domestic or commercial." }); rejected(f, "classification_mismatch");
});

test("uncertain kind needs a caller quote and cannot override a later clear correction", () => {
  const modelChoice = fixture(); modelChoice.message.parameters.kind = "uncertain"; rejected(modelChoice, "classification_mismatch");
  const stale = fixture("uncertain"); stale.message.artifact.messages.push({ role: "user", message: "Actually this is a commercial care home." }); rejected(stale, "classification_mismatch");
});

test("filtered/original text, cross-assistant history and malformed artifact cannot establish evidence", () => {
  const f = fixture(); f.message.artifact.messages[9].isFiltered = true; f.message.artifact.messages[9].originalMessage = f.message.artifact.messages[9].message; rejected(f, "invalid_artifact");
  delete f.message.artifact.messages[9].isFiltered; f.message.artifact.messages[6].assistantId = ids.helper; rejected(f, "invalid_artifact");
  delete f.message.artifact; rejected(f, "invalid_artifact");
});

test("provider message evidence is bounded in turn count, individual size and total size", () => {
  const f = fixture();
  f.message.artifact.messages = Array.from({ length: 257 }, () => ({ role: "user", message: "test" })); rejected(f, "invalid_artifact");
  f.message.artifact.messages = [{ role: "user", message: "x".repeat(6001) }, { role: "bot", message: "test" }]; rejected(f, "invalid_artifact");
  f.message.artifact.messages = Array.from({ length: 12 }, () => ({ role: "user", message: "x".repeat(6000) })); rejected(f, "invalid_artifact");
});

test("oversized evidence and parameters are not silently truncated into passes", () => {
  const f = fixture(); f.message.parameters.evidence.name = "x".repeat(1201); rejected(f, "missing_intake");
});

test("system/tool prose cannot fabricate a missing caller utterance", () => {
  const f = fixture(); f.message.artifact.messages[9].role = "tool"; rejected(f, "fabricated_source_evidence");
});

const trustedServer = () => ({ url: "https://tgbnakbxwcqjeimygroz.supabase.co/functions/v1/receptionist-intake-check", headers: { "X-OpenFolk-Intake-Token": "TEST_ONLY_NOT_A_SECRET" } });
test("tool builder uses documented dynamic handoff shape, fixed server and explicit fact/evidence schema", () => {
  const server = trustedServer(), tool = buildEmergencyIntakeHandoffTool(server);
  assert.equal(tool.type, "handoff");
  assert.deepEqual(tool.function.parameters.properties.destination.enum, ["dynamic"]);
  assert.deepEqual(tool.function.parameters.required, ["destination", "kind", "callerName", "callbackNumber", "siteAddressOrPostcode", "incidentSummary", "evidence"]);
  assert.deepEqual(tool.function.parameters.properties.evidence.required, ["name", "callback", "callbackReadBack", "callbackConfirmation", "site", "issue", "classification"]);
  assert.deepEqual(tool.destinations, [{ type: "dynamic", server }]);
  server.headers["X-OpenFolk-Intake-Token"] = "CHANGED";
  assert.equal(tool.destinations[0].server.headers["X-OpenFolk-Intake-Token"], "TEST_ONLY_NOT_A_SECRET");
  assert.match(tool.function.description, /not end the call/);
});

test("builder rejects arbitrary endpoints, credential URLs, absent authentication and header injection", () => {
  for (const url of ["http://example.test", "https://example.test", trustedServer().url + "?token=x", trustedServer().url + "#x", trustedServer().url.replace("https://", "https://user:pass@")]) {
    assert.throws(() => buildEmergencyIntakeHandoffTool({ ...trustedServer(), url }));
  }
  for (const headers of [{}, { Authorization: "outbound-key" }, { "X-OpenFolk-Intake-Token": "" }, { "X-OpenFolk-Intake-Token": "secret\r\nOther: value" }, { "X-OpenFolk-Intake-Token": "x", Extra: "x" }]) {
    assert.throws(() => buildEmergencyIntakeHandoffTool({ ...trustedServer(), headers }));
  }
});
