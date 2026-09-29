import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deskQueue, deskStages, canApprove, type DeskIssue } from "./feedback-desk.ts";
const rows = [
  { id: "n", priority: "normal", created_at: "2026-09-29" },
  { id: "h", priority: "high", created_at: "2026-09-28" },
  { id: "u", priority: "urgent", created_at: "2026-09-20" },
  { id: "h2", priority: "high", created_at: "2026-09-29" },
];
test("priority queue places urgent first then newest within each priority", () => {
  assert.deepEqual(
    deskQueue(rows).map((x) => x.id),
    ["u", "h2", "h", "n"],
  );
  assert.equal(rows[0].id, "n");
});
test("newest and oldest explicitly override priority", () => {
  assert.equal(deskQueue(rows, "oldest")[0].id, "u");
  assert.equal(deskQueue(rows, "newest").at(-1)?.id, "u");
});
test("every workflow stage has a distinct accessible queue", () =>
  assert.equal(new Set(deskStages.map((x) => x.key)).size, 6));
test("approval requires all three saved fields and approval stage", () => {
  const issue = {
    stage: "approval",
    diagnosis: "The repeated greeting",
    proposal: "Change the greeting",
    test_plan: "Retest the greeting",
  } as DeskIssue;
  assert.equal(canApprove(issue), true);
  assert.equal(canApprove({ ...issue, stage: "received" }), false);
  assert.equal(canApprove({ ...issue, test_plan: "" }), false);
});
test("review desk is only mounted on the operator page", () => {
  const operator = readFileSync(
    new URL("../components/app/OperatorModules.tsx", import.meta.url),
    "utf8",
  );
  assert.match(operator, /view === ['"]improvements['"]/);
  assert.match(operator, /FeedbackDesk/);
  const client = readFileSync(
    new URL("../components/receptionist/ReceptionistWorkspace.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(client, /FeedbackDesk/);
});
test("review endpoint never writes Vapi and explicitly requires Chris and actor permission", () => {
  const s = readFileSync(
    new URL("../../supabase/functions/receptionist-task-review/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(s, /care_desk_operator/);
  assert.match(s, /chris@openfolk.ai/);
  assert.match(s, /practiceCallMatches/);
  assert.match(s, /care_desk_reserve_review/);
  assert.doesNotMatch(s, /method:\s*['"](?:PATCH|PUT|DELETE)['"]/);
  assert.match(s, /providerChanges:\s*0/);
});
test("task dialog cannot turn an approval into a provider release", () => {
  const s = readFileSync(new URL("../components/app/FeedbackDesk.tsx", import.meta.url), "utf8");
  assert.match(s, /Approval here is not a Vapi release/);
  assert.match(s, /No automatic Vapi change is enabled/);
  assert.doesNotMatch(s, /action\(['"]resolve/);
});
