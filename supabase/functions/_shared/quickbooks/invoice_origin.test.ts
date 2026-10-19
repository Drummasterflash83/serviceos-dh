import assert from "node:assert/strict";
import { test } from "node:test";
import { invoiceCheckCorsOrigin } from "./invoice_origin.ts";

test("LIVE invoice check accepts only exact configured and signed-in app origins", () => {
  assert.equal(invoiceCheckCorsOrigin("https://www.openfolk.ai", "https://app.openfolk.ai"), "https://app.openfolk.ai");
  assert.equal(invoiceCheckCorsOrigin("https://www.openfolk.ai", "https://www.openfolk.ai"), "https://www.openfolk.ai");
  assert.equal(invoiceCheckCorsOrigin("https://www.openfolk.ai", null), "https://www.openfolk.ai");
  for (const origin of ["http://app.openfolk.ai", "https://test.openfolk.ai", "https://evil.openfolk.ai", "https://app.openfolk.ai.evil.test"])
    assert.equal(invoiceCheckCorsOrigin("https://www.openfolk.ai", origin), null);
});

test("other deployments keep their one configured origin", () => {
  assert.equal(invoiceCheckCorsOrigin("https://test.openfolk.ai", "https://test.openfolk.ai"), "https://test.openfolk.ai");
  assert.equal(invoiceCheckCorsOrigin("https://test.openfolk.ai", "https://app.openfolk.ai"), null);
});
