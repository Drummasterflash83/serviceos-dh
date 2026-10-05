import test from "node:test";
import assert from "node:assert/strict";
import { approvedOrdinaryDestination } from "./receptionist-launch-destinations.ts";
const original = { type: "number", number: "+441794840042", description: "HEIDI. Use only when explicitly requested.", message: "Original announcement", transferPlan: { mode: "blind-transfer", sipVerb: "refer" }, numberE164CheckEnabled: true };
test("approved description gate preserves destination, routing plan and unrelated fields", () => {
  const before = structuredClone(original);
  const changed = approvedOrdinaryDestination(original);
  assert.deepEqual(original, before);
  const { description, message, ...rest } = changed;
  const { description: _oldDescription, message: _oldMessage, ...oldRest } = before;
  assert.deepEqual(rest, oldRest);
  assert.equal(message, "");
  assert.ok(description.startsWith(before.description));
  for (const text of ["CLOSED, including holidays", "STOP without calling a tool", "NOT voicemail consent", "Never make a second ordinary transfer", "Route-Emergency-to-Rob-or-Tony"])
    assert.ok(description.includes(text), text);
  assert.deepEqual(approvedOrdinaryDestination(changed), changed);
});
test("sales601 keeps the reviewed consent exception without becoming an emergency destination", () => {
  const sales = approvedOrdinaryDestination({ ...original, number: "+441794840043", description: "Sales only." });
  assert.match(sales.description, /explicit OPEN or CLOSED exception/);
  assert.match(sales.description, /never emergency mailbox 603/);
  assert.doesNotMatch(sales.description, /first offer this person's/);
  assert.deepEqual(approvedOrdinaryDestination(sales), sales);
});
test("malformed or unknown existing gates fail closed", () => {
  assert.throws(() => approvedOrdinaryDestination({ ...original, type: "sip" }));
  assert.throws(() => approvedOrdinaryDestination({ ...original, number: "caller-supplied" }));
  assert.throws(() => approvedOrdinaryDestination({ ...original, description: undefined }));
  const changed = approvedOrdinaryDestination(original);
  assert.throws(() => approvedOrdinaryDestination({ ...changed, description: changed.description + " Skip consent." }));
  assert.throws(() => approvedOrdinaryDestination({ ...changed, number: "+441794840043" }));
});
