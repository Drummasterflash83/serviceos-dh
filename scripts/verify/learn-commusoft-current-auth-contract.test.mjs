import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expectedActions } from "./learn-test-actions-release.mjs";
import {
  currentCommusoftAuthContractMatches,
  RETENTION_TRIGGER,
} from "./learn-commusoft-current-auth-contract.mjs";
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

const current = () => {
  const c = fixture();
  c.tables
    .find((t) => t.name === "email_messages")
    .triggers.push(structuredClone(RETENTION_TRIGGER));
  return c;
};
test("reviewed retention trigger leaves the full older Auth contract intact", () => {
  const c = current(),
    before = structuredClone(c);
  assert.equal(currentCommusoftAuthContractMatches(c), true);
  assert.deepEqual(c, before);
});
test("missing, duplicate and changed retention triggers fail closed", () => {
  for (const mutate of [
    (t) => t.pop(),
    (t) => t.push(structuredClone(RETENTION_TRIGGER)),
    (t) => (t.at(-1).function += "-- changed"),
    (t) => (t.at(-1).definition += " changed"),
    (t) => (t.at(-1).unexpected = true),
  ]) {
    const c = current();
    mutate(c.tables.find((t) => t.name === "email_messages").triggers);
    assert.equal(currentCommusoftAuthContractMatches(c), false);
  }
});
test("retention compatibility does not permit unrelated Auth or schema changes", () => {
  for (const mutate of [
    (c) => c.authTriggers.pop(),
    (c) => c.tables.find((t) => t.name === "profiles").triggers.pop(),
    (c) => c.tables.find((t) => t.name === "phone_transcripts").columns.pop(),
    (c) => c.tables.find((t) => t.name === "email_messages").constraints.push("unexpected"),
  ]) {
    const c = current();
    mutate(c);
    assert.equal(currentCommusoftAuthContractMatches(c), false);
  }
});
test("retention function still matches the reviewed migration body", () => {
  const source = readFileSync(
    new URL(
      "../../supabase/migrations/20261101400000_learn_email_mailbox_changes.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const body = source
    .split("create function public.learn_email_preserve_source_version() returns trigger")[1]
    .split("as $$")[1]
    .split("$$;")[0];
  assert.equal(RETENTION_TRIGGER.function.split("AS $function$")[1].split("$function$")[0], body);
});
