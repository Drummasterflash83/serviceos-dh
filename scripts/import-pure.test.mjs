// ServiceOS — pure import-module proofs (no DB, no Deno).
// Run: node --test scripts/import-pure.test.mjs
//
// 1. chooseImportProfile — DETERMINISTIC profile resolution: explicit ids must
//    be active and match the requested source/entity (foreign/wrong-entity/
//    wrong-source/inactive are adversarially rejected); automatic resolution
//    only when unambiguous, tenant preferred; several candidates require an
//    explicit selection. A jobs/customers/staff or inactive profile can never
//    be chosen for a Contacts import.
// 2. maskSampleRecord — the explicit masking policy: known contact PII can
//    never appear verbatim in a preview sample, while vocabulary fields stay
//    reviewable.
import test from "node:test";
import assert from "node:assert/strict";

import { chooseImportProfile } from "../supabase/functions/_shared/imports/profile.ts";
import {
  maskSampleRecord,
  maskEmail,
  maskPhone,
} from "../supabase/functions/_shared/imports/redact.ts";

const DEF = { columns: [] };
const P = (over) => ({
  id: over.id,
  tenant_id: over.tenant_id ?? null,
  source_system: over.source_system ?? "generic",
  entity_type: over.entity_type ?? "contacts",
  name: over.name ?? "Profile",
  version: 1,
  active: over.active ?? true,
  definition: DEF,
});

const REQ = { source: "generic", entity: "contacts" };

test("explicit id: unknown/foreign profile (not in visible rows) → none", () => {
  const r = chooseImportProfile([P({ id: "a" })], { ...REQ, explicitId: "zzz" });
  assert.equal(r.kind, "none");
});

test("explicit id: INACTIVE profile is rejected, never silently substituted", () => {
  const r = chooseImportProfile([P({ id: "a", active: false })], { ...REQ, explicitId: "a" });
  assert.equal(r.kind, "mismatch");
  assert.match(r.reason, /inactive/);
});

test("explicit id: WRONG-ENTITY profile (customers/jobs/staff) cannot serve contacts", () => {
  for (const entity of ["customers", "jobs", "staff"]) {
    const r = chooseImportProfile([P({ id: "a", entity_type: entity })], {
      ...REQ,
      explicitId: "a",
    });
    assert.equal(r.kind, "mismatch");
    assert.match(r.reason, /entity/);
  }
});

test("explicit id: WRONG-SOURCE profile is rejected", () => {
  const r = chooseImportProfile([P({ id: "a", source_system: "commusoft" })], {
    ...REQ,
    explicitId: "a",
  });
  assert.equal(r.kind, "mismatch");
  assert.match(r.reason, /source/);
});

test("explicit id: an active matching profile is chosen exactly", () => {
  const r = chooseImportProfile([P({ id: "a" }), P({ id: "b" })], { ...REQ, explicitId: "b" });
  assert.equal(r.kind, "ok");
  assert.equal(r.profile.id, "b");
});

test("auto: a single platform profile resolves", () => {
  const r = chooseImportProfile([P({ id: "plat" })], REQ);
  assert.equal(r.kind, "ok");
  assert.equal(r.profile.id, "plat");
});

test("auto: ONE tenant profile is preferred over the platform fallback", () => {
  const r = chooseImportProfile([P({ id: "plat" }), P({ id: "ten", tenant_id: "t1" })], REQ);
  assert.equal(r.kind, "ok");
  assert.equal(r.profile.id, "ten");
});

test("auto: SEVERAL eligible tenant profiles require an explicit selection", () => {
  const r = chooseImportProfile(
    [P({ id: "plat" }), P({ id: "t-a", tenant_id: "t1" }), P({ id: "t-b", tenant_id: "t1" })],
    REQ,
  );
  assert.equal(r.kind, "ambiguous");
  assert.deepEqual(r.eligible.map((p) => p.id).sort(), ["t-a", "t-b"]);
});

test("auto: inactive/wrong-entity/wrong-source rows are never eligible", () => {
  const r = chooseImportProfile(
    [
      P({ id: "x", active: false }),
      P({ id: "y", entity_type: "customers" }),
      P({ id: "z", source_system: "commusoft" }),
    ],
    REQ,
  );
  assert.equal(r.kind, "none");
});

// ── masking policy ──────────────────────────────────────────────────────────

const RAW = {
  external_id: "CUST-90210",
  display_name: "Winifred Bramblewick",
  first_name: "Winifred",
  last_name: "Bramblewick",
  company_name: "Bramblewick Boilers Ltd",
  primary_email: "winifred.bramblewick@example-heating.co.uk",
  secondary_email: "winnie.b@personal-mail.test",
  primary_phone: "+447700900123",
  secondary_phone: "01216435555",
  owner_email: "owner.person@drummonds.test",
  address_text: "14 Harborne Park Road, Birmingham",
  postcode: "B17 0DE",
  source_ref: "sheet-row-88",
  relationship_type: "prospect",
  lifecycle_stage: "engaged",
};

test("known contact PII can NEVER appear verbatim in a masked sample", () => {
  const masked = JSON.stringify(maskSampleRecord(RAW));
  const pii = [
    RAW.display_name,
    RAW.first_name,
    RAW.last_name,
    RAW.company_name,
    RAW.primary_email,
    RAW.secondary_email,
    RAW.primary_phone,
    RAW.secondary_phone,
    RAW.owner_email,
    RAW.address_text,
    RAW.postcode,
    RAW.external_id,
    RAW.source_ref,
    // local parts must not leak either
    "winifred.bramblewick",
    "winnie.b",
    "owner.person",
  ];
  for (const value of pii) {
    assert.ok(!masked.includes(value), `PII leaked verbatim: ${value}`);
  }
});

test("the reviewer still understands mapping + vocabulary", () => {
  const masked = maskSampleRecord(RAW);
  // every mapped column is still visible as a key
  for (const k of Object.keys(RAW)) assert.ok(k in masked, `column ${k} lost`);
  // vocabulary fields stay verbatim (not person-identifying)
  assert.equal(masked.relationship_type, "prospect");
  assert.equal(masked.lifecycle_stage, "engaged");
  // masked shapes remain recognisable
  assert.equal(masked.primary_email, "w***@example-heating.co.uk");
  assert.equal(masked.primary_phone, "…0123");
});

test("unknown fields are masked by default, never passed through", () => {
  const masked = maskSampleRecord({ mystery_column: "Deeply Identifying Value" });
  assert.notEqual(masked.mystery_column, "Deeply Identifying Value");
  assert.ok(String(masked.mystery_column).startsWith("D"));
});

test("mask helpers behave on edge cases", () => {
  assert.equal(maskEmail("no-at-sign"), "n…(10)");
  assert.equal(maskPhone("12"), "…");
});
