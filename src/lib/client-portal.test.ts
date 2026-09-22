import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { programmeSchema, pricedSubtotal, money } from "./client-portal.ts";
const programme = programmeSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../../scripts/client-portal/drummonds-programme.json", import.meta.url),
      "utf8",
    ),
  ),
);
test("unpriced outcomes stay unknown, and optional prices never inflate programme totals", () => {
  const outcomes = programme.outcomes.map((p, i) => ({
    ...p,
    setup: i === 0 ? 1000 : p.optional ? 99999 : null,
  }));
  assert.deepEqual(pricedSubtotal(outcomes, "setup"), { amount: 1000, pending: 2, count: 3 });
  assert.equal(money(null), "To be agreed");
  assert.equal(money(0), "£0.00");
});
test("unsafe resource protocols and negative investment are rejected", () => {
  for (const url of ["javascript:alert(1)", "http://example.com", "data:text/html,test"])
    assert.equal(
      programmeSchema.safeParse({
        ...programme,
        links: [{ id: "x", title: "x", description: "x", url }],
      }).success,
      false,
    );
  assert.equal(
    programmeSchema.safeParse({
      ...programme,
      outcomes: [{ ...programme.outcomes[0], setup: -10 }],
    }).success,
    false,
  );
});
test("initial programme has no invented prices or operational status", () => {
  assert.ok(programme.outcomes.every((o) => o.setup === null && o.monthly === null));
  assert.ok(programme.systems.every((s) => s.status !== "Operational"));
  assert.ok(programme.outcomes.every((o) => o.status === "Proposed" || o.status === "Scoping"));
});
