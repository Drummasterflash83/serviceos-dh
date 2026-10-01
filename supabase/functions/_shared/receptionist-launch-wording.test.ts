import { test } from "node:test";
import assert from "node:assert/strict";
import {
  launchWordingModel,
  launchDialogueModel,
  launchClosingModel,
} from "./receptionist-launch-wording.ts";
const ordinary = {
  id: "89c45170-c66f-4688-a349-4a354892ba57",
  type: "transferCall",
  function: { name: "route" },
  destinations: Array.from({ length: 10 }, (_, i) => ({
    number: `+44179400000${i}`,
    message: "Old announcement",
    transferPlan: { mode: "blind-transfer" },
  })),
};
const candidate = {
  id: "dcfc2e66-a438-43ab-b863-467f5a5089df",
  model: {
    provider: "openai",
    toolIds: [ordinary.id, "handoff"],
    messages: [
      { role: "system", content: "# APPROVED ROUTING UPDATE\nKeep safety and hours." },
      { role: "system", content: "Existing approved consent" },
    ],
  },
};
test("repair preserves destinations, transfer plans, consent and handoff without mutating shared tool", () => {
  const before = JSON.stringify({ candidate, ordinary });
  const model = launchWordingModel(candidate, [ordinary]);
  assert.deepEqual(model.toolIds, ["handoff"]);
  assert.equal(model.tools.length, 1);
  model.tools[0].destinations.forEach((d: any, i: number) => {
    assert.equal(d.message, "");
    assert.equal(d.number, ordinary.destinations[i].number);
    assert.deepEqual(d.transferPlan, ordinary.destinations[i].transferPlan);
  });
  assert.deepEqual(model.messages[1], candidate.model.messages[1]);
  assert.match(model.messages[0].content, /Keep safety and hours/);
  assert.equal(JSON.stringify({ candidate, ordinary }), before);
});
test("dialogue repair changes only the first prompt and preserves tools and safety instructions", () => {
  const first = launchWordingModel(candidate, [ordinary]);
  const next = launchDialogueModel({ ...candidate, model: first });
  assert.deepEqual(next.tools, first.tools);
  assert.deepEqual(next.toolIds, first.toolIds);
  assert.deepEqual(next.messages.slice(1), first.messages.slice(1));
  assert.match(next.messages[0].content, /NEVER invoke it again/);
  assert.match(next.messages[0].content, /Keep safety and hours/);
  assert.throws(() => launchDialogueModel({ ...candidate, model: next }));
  assert.throws(() => launchDialogueModel({ ...candidate, id: "production", model: first }));
});
test("repair refuses live assistants and unexpected configuration", () => {
  assert.throws(() => launchWordingModel({ ...candidate, id: "production" }, [ordinary]));
  assert.throws(() => launchWordingModel(candidate, []));
  assert.throws(() =>
    launchWordingModel({ ...candidate, model: { ...candidate.model, tools: [{}] } }, [ordinary]),
  );
});
test("closing repair preserves the complete reviewed model and changes no routes", () => {
  const model = launchWordingModel(candidate, [ordinary]);
  const next = launchClosingModel({ ...candidate, model });
  assert.deepEqual(next.messages.slice(0, -1), model.messages);
  assert.deepEqual(next.tools, model.tools);
  assert.deepEqual(next.toolIds, model.toolIds);
  assert.throws(() => launchClosingModel({ ...candidate, model: next }));
  assert.throws(() => launchClosingModel({ ...candidate, id: "production", model }));
});
