import assert from "node:assert/strict";
import test from "node:test";

import {
  PERMISSION_BASIS_LABELS,
  PERMISSION_BULK_CAP,
  PERMISSION_DISCLAIMER,
  validateBulkSelection,
  validatePermissionForm,
} from "./permission.ts";

test("a subscribed decision demands the full evidence set", () => {
  const errors = validatePermissionForm({ decision: "subscribed" });
  assert.ok(errors.basis, "basis required");
  assert.ok(errors.evidence_method, "method required");
  assert.ok(errors.evidence_reference, "reference or note required");
  assert.ok(errors.attestation, "attestation required");
});

test("a complete subscribed decision passes", () => {
  const errors = validatePermissionForm({
    decision: "subscribed",
    basis: "explicit_opt_in",
    evidence_method: "Signup form on our website",
    evidence_reference: "Form submission 2026-08-01",
    attestation: true,
  });
  assert.deepEqual(errors, {});
});

test("a note can stand in for a reference — but not an empty one", () => {
  const withNote = validatePermissionForm({
    decision: "subscribed",
    basis: "existing_customer_documented",
    evidence_method: "Service contract on file",
    note: "Annual service contract includes marketing permission",
    attestation: true,
  });
  assert.deepEqual(withNote, {});
  const empty = validatePermissionForm({
    decision: "subscribed",
    basis: "existing_customer_documented",
    evidence_method: "Service contract on file",
    note: " ",
    attestation: true,
  });
  assert.ok(empty.evidence_reference);
});

test("an uncontrolled basis is refused", () => {
  const errors = validatePermissionForm({
    decision: "subscribed",
    basis: "they_look_friendly",
    evidence_method: "Vibes",
    note: "n/a",
    attestation: true,
  });
  assert.ok(errors.basis);
});

test("recording an unsubscribe needs nothing but the decision", () => {
  assert.deepEqual(validatePermissionForm({ decision: "unsubscribed" }), {});
});

test("a future effective date is refused; past dates are fine", () => {
  const future = validatePermissionForm({
    decision: "unsubscribed",
    effective_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  assert.ok(future.effective_at);
  const past = validatePermissionForm({
    decision: "unsubscribed",
    effective_at: "2026-07-01",
  });
  assert.deepEqual(past, {});
});

test("oversize evidence text is refused", () => {
  const errors = validatePermissionForm({
    decision: "unsubscribed",
    note: "x".repeat(501),
  });
  assert.ok(errors.note);
});

test("bulk selection deduplicates and enforces the cap", () => {
  const dup = validateBulkSelection(["a", "a", "b"]);
  assert.deepEqual(dup.unique, ["a", "b"]);
  assert.equal(dup.error, undefined);
  assert.ok(validateBulkSelection([]).error);
  const over = validateBulkSelection(
    Array.from({ length: PERMISSION_BULK_CAP + 1 }, (_, i) => `id-${i}`),
  );
  assert.match(over.error ?? "", new RegExp(String(PERMISSION_BULK_CAP)));
});

test("the vocabulary is human, and the disclaimer never claims legal authority", () => {
  for (const label of Object.values(PERMISSION_BASIS_LABELS)) {
    assert.doesNotMatch(label, /_/, "labels are words, not enum keys");
  }
  assert.match(PERMISSION_DISCLAIMER, /does not assume permission/);
  assert.match(PERMISSION_DISCLAIMER, /your organisation's decision and evidence/);
});
