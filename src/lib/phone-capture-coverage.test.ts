import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const endpoint = readFileSync(
  new URL("../../supabase/functions/phone-capture-coverage/index.ts", import.meta.url),
  "utf8",
);
const ui = readFileSync(
  new URL("../components/app/PhoneCaptureCoverage.tsx", import.meta.url),
  "utf8",
);

test("coverage is operator-only and every data read is tenant-scoped", () => {
  assert.match(endpoint, /notification_require_actor/);
  assert.match(endpoint, /care_desk_operator/);
  assert.match(endpoint, /chris@openfolk\.ai/);
  assert.match(endpoint, /auth\.getUser\(\)/);
  assert.match(endpoint, /db\.auth\.admin\.getUserById\(body\.actorId\)/);
  assert.match(endpoint, /actor\.data\.user\?\.email\?\.toLowerCase\(\) !== "chris@openfolk\.ai"/);
  assert.match(endpoint, /\.eq\("tenant_id", body\.tenantId\)/);
  assert.doesNotMatch(endpoint, /transcript_text|from_number|to_number|recording_uri|\.storage\./);
});
test("coverage remains honest about different denominators and missing whole-call reconciliation", () => {
  assert.match(endpoint, /completeness: "not_reconciled"/);
  assert.match(ui, /Whole-call coverage still needs\s+reconciliation/);
  assert.match(ui, /No claim that one call equals one\s+recording/);
  assert.match(ui, /Last known figures are not a live check/);
  assert.doesNotMatch(ui, /100%|Every call captured|All calls recorded/);
});
test("unknown metrics are not represented as zero or a healthy state", () => {
  assert.match(endpoint, /typeof h\[key\] === "number" \? h\[key\] : null/);
  assert.match(ui, /typeof n === "number" \? n.toLocaleString\("en-GB"\) : "Not verified"/);
  assert.match(endpoint, /result\.some\(\(r\) => r\.error\)/);
});
