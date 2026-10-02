import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../components/app/ReceptionistTesting.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/receptionist-testing.css", import.meta.url), "utf8");
test("OpenFolk DH testing separates connection, deposit and each engineer's receipt", () => {
  for (const key of ["connection", "emergency_message", "rob_receipt", "tony_receipt"])
    assert.ok(source.includes(`key: "${key}"`));
  assert.match(source, /Birchills message connection/);
  assert.match(source, /603 · Message saved and playable/);
  assert.match(source, /Rob · Notification received/);
  assert.match(source, /Tony · Notification received/);
  assert.match(source, /tenantId === "00000000-0000-0000-0000-000000000001"/);
  assert.match(source, /!showDhVoicemailChecks \|\| c.key !== "delivery"/);
});
test("missing separate proofs stay awaiting evidence, never inferred from a test pass or greeting", () => {
  const cards = source.slice(source.indexOf("const dhVoicemailChecks"), source.indexOf("export function ReceptionistTesting"));
  assert.doesNotMatch(cards, /passed|delivered|verifiedAt|completedAt|state:\s*"passed"/);
  assert.match(source, /Awaiting evidence/);
  assert.match(source, /not yet evidenced in this testing report/);
  assert.match(source, /Hearing the greeting does not prove a message was saved/);
  assert.match(source, /Rob’s receipt does not prove Tony/);
  assert.match(source, /data\.physicalChecks\.map/);
  assert.match(source, /Recorded observations from authorised calls/);
});
test("inbox link stays in the operator tenant and layout supports narrow screens", () => {
  assert.match(source, /to="\/openfolk\/\$tenantId"[\s\S]*?params=\{\{ tenantId \}\}[\s\S]*?view: "voicemails"/);
  assert.doesNotMatch(source, /to="\/client"/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.of-test-delivery-grid\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.of-test-inbox-link:focus-visible/);
});
