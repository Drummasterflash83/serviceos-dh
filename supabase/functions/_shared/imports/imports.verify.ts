// Reference proof of the pure import engine. Run:
//   node supabase/functions/_shared/imports/imports.verify.ts
import assert from "node:assert/strict";
import { extractJobReferences, normalizeJobNumber } from "./job_number.ts";
import {
  resolveColumnMapping,
  mapRow,
  parseMoneyPennies,
  parseDate,
  normalizePhone,
  type ImportProfileDef,
} from "./profile.ts";
import {
  decideMatch,
  CUSTOMER_MATCH_PRIORITY,
  JOB_MATCH_PRIORITY,
  writableFields,
} from "./matching.ts";

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};

ok("job-number normalization strips prefixes/symbols", () => {
  assert.equal(normalizeJobNumber("#123456"), "123456");
  assert.equal(normalizeJobNumber("Job 123456"), "123456");
  assert.equal(normalizeJobNumber("J123456"), "123456");
  assert.equal(normalizeJobNumber("Commusoft 123456"), "123456");
  assert.equal(normalizeJobNumber("no digits"), null);
});

ok("extractJobReferences: prefixed high-confidence, bare low-confidence", () => {
  const refs = extractJobReferences("Engineer running late for job 123456 and #84721");
  const norms = refs.map((r) => r.normalized).sort();
  assert.deepEqual(norms, ["123456", "84721"]);
  assert.ok(refs.every((r) => r.form === "prefixed" && r.confidence === 0.9));
});

ok("extractJobReferences: excludes phone numbers and money", () => {
  const refs = extractJobReferences("call 07700900123 about £1,234.56 for job 55123");
  const norms = refs.map((r) => r.normalized);
  assert.ok(norms.includes("55123"), "job number found");
  assert.ok(!norms.includes("07700900123"), "phone excluded");
  assert.ok(!refs.some((r) => r.normalized === "123456"), "no money digits");
  // the 9+ digit phone must never appear
  assert.ok(!norms.some((n) => n.length >= 9));
});

ok("bare digit only emitted at low confidence", () => {
  const refs = extractJobReferences("ticket 45231 please", { prefixes: ["job"] });
  const bare = refs.find((r) => r.normalized === "45231");
  assert.ok(bare && bare.form === "bare" && bare.confidence === 0.4);
});

const CUSTOMER_PROFILE: ImportProfileDef = {
  columns: [
    { canonical: "external_id", aliases: ["customer id", "customer_ref"], type: "text" },
    { canonical: "company_name", aliases: ["company", "company name"], type: "text" },
    { canonical: "first_name", aliases: ["first name", "forename"], type: "text" },
    { canonical: "last_name", aliases: ["surname", "last name"], type: "text" },
    {
      canonical: "primary_phone",
      aliases: ["telephone", "phone", "tel"],
      type: "phone",
      required: true,
    },
    { canonical: "primary_email", aliases: ["email"], type: "email" },
    { canonical: "postcode", aliases: ["post code", "postcode"], type: "postcode" },
  ],
};

ok("resolveColumnMapping maps aliases case/space-insensitively", () => {
  const headers = ["Customer ID", "Company Name", "Telephone", "E-Mail", "Post Code"];
  const m = resolveColumnMapping(headers, CUSTOMER_PROFILE);
  assert.equal(m.mapping.external_id, 0);
  assert.equal(m.mapping.company_name, 1);
  assert.equal(m.mapping.primary_phone, 2);
  assert.equal(m.missingRequired.length, 0);
});

ok("missing required column detected", () => {
  const m = resolveColumnMapping(["Company", "Email"], CUSTOMER_PROFILE);
  assert.ok(m.missingRequired.includes("primary_phone"));
});

ok("mapRow coerces phone/email/postcode + flags invalid", () => {
  const headers = ["Customer ID", "Company Name", "Telephone", "E-Mail", "Post Code"];
  const m = resolveColumnMapping(headers, CUSTOMER_PROFILE);
  const good = mapRow(
    ["C-1", "Acme Ltd", "07700 900123", "A@Acme.CO.UK", "sw1a 1aa"],
    CUSTOMER_PROFILE,
    m.mapping,
    1,
  );
  assert.equal(good.errors.length, 0);
  assert.equal(good.record.primary_phone, "+447700900123");
  assert.equal(good.record.primary_email, "a@acme.co.uk");
  assert.equal(good.record.postcode, "SW1A1AA");
  const bad = mapRow(["C-2", "Beta", "", "not-an-email", ""], CUSTOMER_PROFILE, m.mapping, 2);
  assert.ok(bad.errors.some((e) => e.field === "primary_phone")); // required + empty
  assert.ok(bad.errors.some((e) => e.field === "primary_email")); // invalid
});

ok("money → integer pennies; dates parse day-first", () => {
  assert.equal(parseMoneyPennies("£1,234.56"), 123456);
  assert.equal(parseMoneyPennies("500"), 50000);
  assert.equal(parseMoneyPennies("bad"), null);
  assert.equal(parseDate("31/01/2026")?.slice(0, 10), "2026-01-31");
  assert.equal(parseDate("2026-08-15")?.slice(0, 10), "2026-08-15");
  assert.equal(normalizePhone("0161 496 0000"), "+441614960000");
});

ok("decideMatch: external_id wins; ambiguous → probable; none → new", () => {
  const matched = decideMatch(CUSTOMER_MATCH_PRIORITY, [
    { strategy: "external_id", entityIds: ["cust-1"], confidence: 1 },
    { strategy: "phone", entityIds: ["cust-1", "cust-9"], confidence: 0.92 },
  ]);
  assert.equal(matched.action, "matched");
  assert.equal(matched.entityId, "cust-1");
  assert.equal(matched.strategy, "external_id");

  const probable = decideMatch(CUSTOMER_MATCH_PRIORITY, [
    { strategy: "phone", entityIds: ["a", "b"], confidence: 0.92 },
  ]);
  assert.equal(probable.action, "probable");
  assert.deepEqual(probable.conflicts, ["a", "b"]);

  const fresh = decideMatch(JOB_MATCH_PRIORITY, []);
  assert.equal(fresh.action, "new");
});

ok("writableFields never overwrites verified canonical data", () => {
  const r1 = writableFields(
    { primary_email: "new@x.com", postcode: "AB1 2CD" },
    { primary_email: "old@x.com", postcode: null },
    true,
  );
  assert.ok(!("primary_email" in r1.fields), "verified email not overwritten");
  assert.ok(r1.conflicts.includes("primary_email"));
  assert.equal(r1.fields.postcode, "AB1 2CD"); // blank filled
  const r2 = writableFields(
    { primary_email: "same@x.com" },
    { primary_email: "same@x.com" },
    false,
  );
  assert.equal(Object.keys(r2.fields).length, 0); // no-op on identical
});

console.log(`\n${passed} import-engine assertions passed ✓`);
