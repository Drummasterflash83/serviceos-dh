import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expectedActions } from "./learn-test-actions-release.mjs";
import { phoneProcessingAuthContractMatches } from "./learn-phone-processing-auth-contract.mjs";
function fixture() {
  const c = JSON.parse(
      readFileSync(
        new URL(
          "../../docs/operations/evidence/learn-test-auth-fixture-contract-2026-10-09.json",
          import.meta.url,
        ),
      ),
    ),
    e = expectedActions();
  for (const name of ["tenants", "profiles"])
    for (const trigger of [
      "learn_work_authority_input_lock",
      "learn_work_authority_truncate_lock",
    ]) {
      const t = e.tables.find((t) => t.name === name).triggers.find((t) => t.name === trigger);
      c.tables
        .find((t) => t.name === name)
        .triggers.push({
          name: trigger,
          definition: t.definition,
          function: e.functions.find((f) => f.name === t.function).definition,
        });
    }
  const t = c.tables.find((t) => t.name === "phone_transcripts");
  t.columns.push(
    ...Object.entries({
      source_storage_path: "text",
      source_sha256: "text",
      processing_run_id: "uuid",
    }).map(([name, type]) => ({ name, type, default: null, notNull: false })),
  );
  t.constraints.push("FOREIGN KEY (processing_run_id) REFERENCES phone_sync_runs(id)");
  return c;
}
test("known provenance additions preserve the earlier complete Auth fixture contract", () => {
  const c = fixture(),
    before = structuredClone(c);
  assert.equal(phoneProcessingAuthContractMatches(c), true);
  assert.deepEqual(c, before);
});
test("missing, duplicated, altered or additional columns and constraints fail closed", () => {
  const changes = [
    (t) => t.columns.pop(),
    (t) => t.columns.push({ ...t.columns.at(-1) }),
    (t) => (t.columns.at(-1).notNull = true),
    (t) => (t.columns.at(-1).type = "text"),
    (t) => (t.columns.at(-1).default = "gen_random_uuid()"),
    (t) => t.columns.push({ name: "unexpected", type: "text", default: null, notNull: false }),
    (t) => t.constraints.pop(),
    (t) => t.constraints.push(t.constraints.at(-1)),
    (t) => t.constraints.push("CHECK (true)"),
  ];
  for (const change of changes) {
    const c = fixture();
    change(c.tables.find((t) => t.name === "phone_transcripts"));
    assert.equal(phoneProcessingAuthContractMatches(c), false);
  }
});
test("Auth triggers, authority locks and unrelated source columns cannot be normalized away", () => {
  for (const change of [
    (c) => c.authTriggers.push({ definition: "unexpected", function: "unexpected" }),
    (c) => (c.tables.find((t) => t.name === "profiles").triggers.at(-1).function = "changed"),
    (c) => (c.tables.find((t) => t.name === "phone_calls").columns[0].type = "text"),
  ]) {
    const c = fixture();
    change(c);
    assert.equal(phoneProcessingAuthContractMatches(c), false);
  }
  for (const bad of [null, {}, { tables: [] }])
    assert.equal(phoneProcessingAuthContractMatches(bad), false);
});
