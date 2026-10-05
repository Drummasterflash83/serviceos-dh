import { test } from "node:test";
import assert from "node:assert/strict";
import { launchConsistencyPatch, verifiedHolidayDates } from "./receptionist-launch-consistency.ts";
const candidate = { id: "dcfc2e66-a438-43ab-b863-467f5a5089df", firstMessage: 'Original {{"now" | date: "%H%M", "Europe/London"}}', model: {
  provider: "openai", tools: [{ type: "transferCall", destinations: [{ number: "+441794378105" }] }], toolIds: ["handoff"],
  messages: [{ role: "system", content: `Safety preserved: call nine nine nine.
### Accreditation and registration questions
Old impossible lookup lock.
### Completed out-of-hours burst pipe or uncontrolled leak
Repeat safety after intake.
## Voice and conduct
Preserve voice.
## Emergency cross-cover sequence — out of hours only
Repeat internal handoff for each person.
## Opening-hours enquiries
08:30–17:00` }, { role: "system", content: "CONSOLIDATED HANDOVER CONTRACT keep consent" }],
} };
test("consistency patch preserves tools and safety, replaces only reviewed contradictory blocks", () => {
  const before = JSON.stringify(candidate), patch = launchConsistencyPatch(candidate);
  assert.deepEqual(patch.model.tools, candidate.model.tools);
  assert.deepEqual(patch.model.toolIds, candidate.model.toolIds);
  assert.match(patch.model.messages[0].content, /Safety preserved: call nine nine nine/);
  assert.match(patch.model.messages[0].content, /invokes Route-Emergency-to-Rob-or-Tony ONCE/);
  assert.match(patch.model.messages[0].content, /Do not repeat safety advice/);
  assert.doesNotMatch(patch.model.messages[0].content, /Old impossible|Repeat internal/);
  assert.match(patch.firstMessage, /if openfolk_holidays contains openfolk_holiday_key/);
  assert.match(patch.firstMessage, /Original/);
  assert.equal(JSON.stringify(candidate), before);
  assert.throws(() => launchConsistencyPatch({ ...candidate, id: "live" }));
  assert.throws(() => launchConsistencyPatch({ ...candidate, ...patch }));
});
test("verified calendar contains observed England/Wales substitute dates, no invented normal weekdays", () => {
  assert.equal(verifiedHolidayDates.length, 16);
  assert.ok(verifiedHolidayDates.includes("2026-12-25"));
  assert.ok(verifiedHolidayDates.includes("2026-12-28"));
  assert.ok(verifiedHolidayDates.includes("2027-12-27"));
  assert.ok(!verifiedHolidayDates.includes("2026-10-02"));
});
