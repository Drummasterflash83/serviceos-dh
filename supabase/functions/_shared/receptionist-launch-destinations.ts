// Exact, reviewed description-only clarification for the isolated launch
// candidate. All telephone numbers and transfer plans remain unchanged.
const marker = "\n\nOPENFOLK DESTINATION GATE — 2 OCTOBER 2026: ";
const ordinaryGate =
  "This gate overrides any earlier instruction to transfer immediately. OPEN: use the approved ordinary/daytime route, announce once and invoke once. CLOSED, including holidays: without explicit voicemail consent, offer this person's or team's voicemail and STOP without calling a tool. Invoke only after the caller explicitly requests or agrees to that voicemail; a direct voicemail request already counts as consent. Asking to speak, asking a question, indecision or refusal is NOT voicemail consent. After consent announce voicemail once, then invoke once. Never make a second ordinary transfer attempt, including after a thank-you or intercepted/synthetic result. Eligible CLOSED emergencies use Route-Emergency-to-Rob-or-Tony, not this ordinary destination; any earlier ROB EMERGENCY reference means that internal handoff.";
const salesGate =
  "Confirmed unsolicited sales only: this shared office/sales mailbox is an explicit OPEN or CLOSED exception to ordinary voicemail consent. Announce once and invoke once; never make a second ordinary transfer attempt after a thank-you or intercepted/synthetic result. Never use for genuine customers, existing suppliers or providers, recruitment agencies, or eligible emergencies. This is office mailbox 601, never emergency mailbox 603.";

export function approvedOrdinaryDestination(destination: any) {
  if (!destination || destination.type !== "number" ||
    typeof destination.description !== "string" ||
    !/^\+[1-9]\d{7,14}$/.test(destination.number ?? ""))
    throw Error("Reviewed ordinary destination required");
  const suffix = marker + (destination.number === "+441794840043" ? salesGate : ordinaryGate);
  let description = destination.description;
  if (description.includes(marker)) {
    if (!description.endsWith(suffix) || description.indexOf(marker) !== description.length - suffix.length)
      throw Error("Unreviewed destination gate found");
    description = description.slice(0, -suffix.length);
  }
  return { ...destination, description: description + suffix, message: "" };
}
