// England & Wales bank holidays, read from https://www.gov.uk/bank-holidays.json
// on 2 October 2026. This preserves the already approved holiday-closure policy.
export const verifiedHolidayDates = [
  "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25", "2026-08-31", "2026-12-25", "2026-12-28",
  "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30", "2027-12-27", "2027-12-28",
];
const holidayLiquid = `{% assign openfolk_date = "now" | date: "%Y-%m-%d", "Europe/London" %}{% assign openfolk_holidays = "|${verifiedHolidayDates.join("|")}|" %}{% assign openfolk_holiday_key = openfolk_date | prepend: "|" | append: "|" %}`;
export function launchConsistencyPatch(assistant: any) {
  if (assistant.id !== "dcfc2e66-a438-43ab-b863-467f5a5089df" ||
      !assistant.model?.messages?.some((m: any) => m.content?.startsWith("CONSOLIDATED HANDOVER CONTRACT")) ||
      assistant.firstMessage?.includes("openfolk_holidays")) throw Error("Reviewed consolidated candidate required");
  let content = assistant.model.messages[0].content;
  for (const anchor of ["### Accreditation and registration questions", "### Completed out-of-hours burst pipe or uncontrolled leak", "## Emergency cross-cover sequence — out of hours only"])
    if (!content.includes(anchor)) throw Error("Candidate policy anchors changed");
  content = content.replace(/### Accreditation and registration questions[\s\S]*?(?=### Completed out-of-hours)/,
    "### Accreditation and registration questions\nUse an attached approved knowledge lookup if available. If it is not available or does not confirm the fact, say the team must confirm. Never invent accreditation, a registration number, expiry date, price, or a successful lookup. Offer an appropriate transfer/message subject to office hours and consent.\n\n");
  content = content.replace(/### Completed out-of-hours burst pipe or uncontrolled leak[\s\S]*?(?=## Voice and conduct)/,
    "### Completed out-of-hours burst pipe or uncontrolled leak\nFor an eligible uncontrolled leak outside hours, give the existing relevant safety advice immediately, once. When classification and minimum emergency details are complete, invoke the internal Route-Emergency-to-Rob-or-Tony handoff once in the same response. Do not repeat safety advice already given after intake, ask another permission question, or use ordinary Operations voicemail. Never delay emergency services.\n\n");
  content = content.replace(/## Emergency cross-cover sequence — out of hours only[\s\S]*?(?=## Opening-hours enquiries)/,
    "## Emergency cross-cover sequence — out of hours only\nThis ROOT assistant invokes Route-Emergency-to-Rob-or-Tony ONCE after immediate safety advice, classification and minimum details. It is an internal handoff to the same Emma, NOT a telephone connection. The emergency continuation owns the actual warm-transfer sequence: commercial Rob109 then Tony105; domestic Tony105 then Rob109, each once and only cross-cover after explicit primary failure. Human acceptance is required; voicemail is not acceptance. Do not attempt those telephone transfers yourself, retry the handoff, announce another assistant, or claim an engineer answered. Daytime routes remain Mary for gas/oil/serious-water triage and Rudi for approved other faults. Never promise attendance, message delivery or email.\n\n");
  content = content.replace("They take precedence over any conflicting routing, alias, intake or safety-screen rule later in this prompt.",
    "They control routing classification and aliases, subject always to the current hours, consent, safety and consolidated handover contract.");
  content = content.replace("Immediately use Rudi / Operations, without routine intake, when the caller identifies", "During OFFICE HOURS, immediately use Rudi / Operations, without routine intake, when the caller identifies");
  content = content.replace("Treat the rendered London date and time above as the sole source of truth for office status.",
    "Use the rendered London date/time together with the verified holiday flag supplied below for office status. A confirmed holiday is CLOSED even on a weekday.");
  const closed = "Welcome to Drummonds. I'm Emma, the automated receptionist, and this call is recorded. Our office is closed. For an urgent heating or plumbing emergency, tell me now. Otherwise, tell me who you'd like to leave a message for, or what it's about, and I'll put you through to the right voicemail.";
  return {
    firstMessage: `${holidayLiquid}{% if openfolk_holidays contains openfolk_holiday_key %}${closed}{% else %}${assistant.firstMessage}{% endif %}`,
    model: { ...assistant.model, messages: [
      { ...assistant.model.messages[0], content },
      ...assistant.model.messages.slice(1),
      { role: "system", content: `VERIFIED HOLIDAY CALENDAR — England and Wales 2026–2027, checked 2 October 2026 against GOV.UK. ${holidayLiquid}{% if openfolk_holidays contains openfolk_holiday_key %}Today is a CONFIRMED PUBLIC HOLIDAY: the office is CLOSED. Apply closed-hours voicemail consent and emergency eligibility.{% else %}Today is not listed in the verified 2026–2027 holiday calendar. Use normal London weekday/hours rules; dates beyond 2027 need renewed calendar verification, never claim future holiday certainty.{% endif %} Do not read this internal flag aloud. Never repeat closure if the greeting already stated it.` },
    ] },
  };
}
