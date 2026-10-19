import test from "node:test";
import assert from "node:assert/strict";
import { candidateEmergencyTool } from "./receptionist-launch-candidate.ts";

test("candidate emergency transfer is an inline copy, not the published shared tool", () => {
  const shared = {
    id: "published-tool-id", orgId: "provider-org", updatedAt: "provider-version",
    type: "transferCall", function: { name: "Route-Emergency-to-Rob-or-Tony" },
    destinations: [
      { type: "number", number: "+441234567001", description: "Rob emergency 109" },
      { type: "number", number: "+441234567002", description: "Tony emergency 105" },
    ],
  };
  const before = structuredClone(shared);
  const inline = candidateEmergencyTool(shared) as any;
  assert.equal(inline.id, undefined);
  assert.equal(inline.orgId, undefined);
  assert.equal(inline.updatedAt, undefined);
  assert.deepEqual(inline.destinations, shared.destinations);
  inline.destinations.push({ type: "number", number: "+441234567003", description: "Shared emergency mailbox 603" });
  assert.deepEqual(shared, before, "candidate edits cannot mutate the published source object");
  assert.throws(() => candidateEmergencyTool({ ...shared, type: "function" }), /Reviewed emergency transfer source required/);
  assert.throws(() => candidateEmergencyTool({ ...shared, destinations: inline.destinations }),
    /Reviewed emergency transfer source required/, "a pre-edited published tool cannot seed the candidate");
});
