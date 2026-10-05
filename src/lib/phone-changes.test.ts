import test from "node:test";
import assert from "node:assert/strict";
import {
  phoneChanges,
  encodePhoneChanges,
  phoneSnapshotSchema,
  type PhoneSnapshot,
} from "./phone-changes.ts";
const a = "00000000-0000-4000-8000-000000000001",
  b = "00000000-0000-4000-8000-000000000002",
  g = "00000000-0000-4000-8000-000000000003";
const fixture = (): PhoneSnapshot => ({
  version: "verified-1",
  observedAt: "2026-09-24T10:00:00Z",
  evidenceRef: "operator-capture-1",
  plan: {
    version: 1,
    phones: [
      { id: a, name: "One", extension: "101" },
      { id: b, name: "Two", extension: "102" },
    ],
    groups: [
      {
        id: g,
        name: "Office",
        members: [a],
        strategy: "Together",
        seconds: 25,
        fallback: "Voicemail",
      },
    ],
    hours: "Mon-Fri 9-5 Europe/London",
    notes: "",
  },
});
test("no baseline or missing provenance cannot become a current phone system", () => {
  assert.equal(phoneSnapshotSchema.safeParse(null).success, false);
  assert.equal(phoneSnapshotSchema.safeParse({ ...fixture(), evidenceRef: "" }).success, false);
});
test("rename requests bind to verified baseline and preserve it", () => {
  const base = fixture(),
    after = structuredClone(base.plan);
  after.phones[0].name = "New name";
  const body = encodePhoneChanges(base, after);
  assert.match(body, /verified-1/);
  assert.match(body, /One → New name/);
  assert.equal(base.plan.phones[0].name, "One");
});
test("membership and ordering differences are explicit", () => {
  const base = fixture(),
    after = structuredClone(base.plan);
  after.groups[0].members = [b, a];
  assert.match(phoneChanges(base.plan, after)[0], /One \(101\) → Two \(102\) → One \(101\)/);
});
test("no-op, identity changes, routing rule changes and empty groups refuse", () => {
  const base = fixture();
  assert.throws(() => encodePhoneChanges(base, base.plan));
  for (const mutate of [
    (p: PhoneSnapshot["plan"]) => (p.phones[0].extension = "999"),
    (p: PhoneSnapshot["plan"]) => (p.groups[0].seconds = 30),
    (p: PhoneSnapshot["plan"]) => (p.groups[0].members = []),
  ]) {
    const after = structuredClone(base.plan);
    mutate(after);
    assert.throws(() => encodePhoneChanges(base, after));
  }
});
