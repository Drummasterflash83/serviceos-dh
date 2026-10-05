import test from "node:test";
import assert from "node:assert/strict";
import {
  addPhoneToGroup,
  decodePhonePlan,
  describePhonePlan,
  emptyPhonePlan,
  encodePhonePlan,
  phonePlanSchema,
  type PhonePlan,
} from "./phone-plan.ts";
const phone = "00000000-0000-4000-8000-000000000001";
const group = "00000000-0000-4000-8000-000000000002";
const plan = (): PhonePlan => ({
  version: 1,
  phones: [{ id: phone, name: "Test phone", extension: "101" }],
  groups: [
    {
      id: group,
      name: "Scheduling",
      members: [phone],
      strategy: "Together",
      seconds: 25,
      fallback: "Verified voicemail",
    },
  ],
  hours: "Mon–Fri 09–17 Europe/London; voicemail outside hours",
  notes: "Keep unlisted routes unchanged",
});
test("valid proposed plans round-trip without a live claim", () => {
  assert.deepEqual(decodePhonePlan(encodePhonePlan(plan())), plan());
  assert.match(describePhonePlan(plan()), /not live/);
  assert.match(describePhonePlan(plan()), /Test phone \(101\)/);
});
test("empty and malformed plans cannot be submitted", () => {
  assert.throws(() => encodePhonePlan(emptyPhonePlan()));
  assert.equal(decodePhonePlan("ordinary feedback"), null);
  assert.equal(decodePhonePlan("OPENFOLK_PHONE_PLAN_V1\n{}"), null);
});
test("drag/drop is idempotent and refuses foreign phones", () => {
  assert.deepEqual(addPhoneToGroup(plan(), phone, group), plan());
  assert.deepEqual(addPhoneToGroup(plan(), "foreign", group), plan());
  const p = plan();
  p.groups[0]!.members = [];
  assert.deepEqual(addPhoneToGroup(p, phone, group).groups[0]!.members, [phone]);
});
test("dangling, repeated and ambiguous extensions refuse", () => {
  const p = plan();
  p.groups[0]!.members = [group];
  assert.equal(phonePlanSchema.safeParse(p).success, false);
  const q = plan();
  q.groups[0]!.members = [phone, phone];
  assert.equal(phonePlanSchema.safeParse(q).success, false);
  const r = plan();
  r.phones.push({ id: group, name: "Other phone", extension: "101" });
  assert.equal(phonePlanSchema.safeParse(r).success, false);
});
test("unsafe ring boundaries and omitted fallbacks refuse", () => {
  for (const seconds of [0, 121, NaN, 1.5]) {
    const p = plan();
    p.groups[0]!.seconds = seconds;
    assert.equal(phonePlanSchema.safeParse(p).success, false);
  }
  const p = plan();
  p.groups[0]!.fallback = " ";
  assert.equal(phonePlanSchema.safeParse(p).success, false);
});
test("a phone can be requested in more than one group", () => {
  const p = plan();
  p.groups.push({ ...p.groups[0]!, id: "00000000-0000-4000-8000-000000000003", name: "Backup" });
  assert.equal(phonePlanSchema.safeParse(p).success, true);
});
