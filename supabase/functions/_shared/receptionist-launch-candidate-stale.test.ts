import test from "node:test";
import assert from "node:assert/strict";
import {
  candidatePreparationHold,
  candidatePreparationStateHold,
  launchCandidateSourceId,
  prepareLaunchCandidate,
} from "./receptionist-launch-candidate.ts";

const tenant = "00000000-0000-0000-0000-000000000001";
const live = "4eb2bee8-ac25-47c9-b962-409ed250ceb6";
const selected = "dcfc2e66-a438-43ab-b863-467f5a5089df";
const tools = [
  { id: "89c45170-c66f-4688-a349-4a354892ba57" },
  { id: "ac550bea-6e64-4614-8dcf-a0a32856694e" },
];

test("only an authorised manual preparation reads the published source", () => {
  assert.equal(launchCandidateSourceId("prepare_candidate", true, false, selected, live), live);
  for (const [action, service, scheduled] of [
    ["status", true, false],
    ["prepare_candidate", false, false],
    ["prepare_candidate", true, true],
  ] as const)
    assert.equal(launchCandidateSourceId(action, service, scheduled, selected, live), selected);
});

function savedCandidate(row: Record<string, unknown>) {
  let writes = 0;
  const db = {
    from(name: string) {
      assert.equal(name, "receptionist_test_candidates");
      return {
        select(columns: string) {
          assert.match(columns, /source_hash/);
          return {
            eq(column: string, value: string) {
              assert.equal(column, "tenant_id");
              assert.equal(value, tenant);
              return { maybeSingle: async () => ({ data: row, error: null }) };
            },
          };
        },
        insert() { writes++; throw Error("Unexpected audit insert"); },
        update() { writes++; throw Error("Unexpected audit update"); },
      };
    },
  };
  const api = async () => { writes++; throw Error("Unexpected provider write"); };
  return { db, api, writes: () => writes };
}

test("an old prepared candidate cannot be silently reused after LIVE source drift", async () => {
  assert.equal(candidatePreparationStateHold({ state: "prepared", source_hash: "old-source" },
    "current-live-source")?.state, "review_required");
  const saved = savedCandidate({ state: "prepared", source_hash: "old-source",
    candidate_id: selected, helper_id: "saved-helper", handoff_id: "saved-handoff" });
  await assert.rejects(
    prepareLaunchCandidate(saved.db, saved.api, { id: live }, tools, "current-live-source", "actor", tenant),
    /source changed; reviewed reconciliation required/,
  );
  assert.equal(saved.writes(), 0, "a stale audit row must stop before provider or database writes");
});

test("even a matching prepared row requires a fresh graph read", async () => {
  const saved = savedCandidate({ state: "prepared", source_hash: "same-source",
    candidate_id: selected, helper_id: "saved-helper", handoff_id: "saved-handoff" });
  await assert.rejects(
    prepareLaunchCandidate(saved.db, saved.api, { id: live }, tools, "same-source", "actor", tenant),
    /already prepared; inspect the provider graph/,
  );
  assert.equal(saved.writes(), 0);
});

test("a partial preparation remains held without retrying providers", async () => {
  const saved = savedCandidate({ state: "rejected", source_hash: "same-source",
    candidate_id: null, helper_id: "saved-helper", handoff_id: null });
  await assert.rejects(
    prepareLaunchCandidate(saved.db, saved.api, { id: live }, tools, "same-source", "actor", tenant),
    /partial or uncertain preparation/,
  );
  assert.equal(saved.writes(), 0);
  assert.equal(candidatePreparationStateHold({ state: "rejected", source_hash: "same-source",
    candidate_id: null, helper_id: null, handoff_id: null }, "same-source"), null,
  "only a source-identical empty rejection remains eligible for a separately authorised retry");
});

test("only fixed, secret-free preparation holds reach the operator", () => {
  const hold = candidatePreparationHold(Error("Launch candidate source changed; reviewed reconciliation required. No provider retry sent."));
  assert.deepEqual(hold, {
    state: "review_required",
    error: "Launch candidate source changed; reviewed reconciliation required. No provider retry sent.",
    providerChanged: false,
    automaticRetrySent: false,
  });
  assert.equal(candidatePreparationHold(Error("Launch candidate provider payload: secret")), null);
  assert.equal(candidatePreparationHold(Error(`${hold?.error} private provider response`)), null);
  assert.equal(candidatePreparationHold(Error("Vapi request rejected: private provider response")), null);
});
