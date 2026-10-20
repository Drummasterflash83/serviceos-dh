import assert from "node:assert/strict";
import test from "node:test";
import { readMdAgedInvoicePage } from "./new-dawn-md-aged-invoices.ts";

const tenant = "00000000-0000-0000-0000-000000000001";
const actor = "00000000-0000-0000-0000-000000000002";
const row = {
  invoice_id: "12345", source_version_id: "00000000-0000-0000-0000-000000000003",
  document_number: "32945", balance: "125.50", currency: "GBP",
  due_date: "2026-07-20", source_updated_at: "2026-07-01T10:00:00Z",
  source_observed_at: "2026-10-20T08:00:00Z", source_sha256: "a".repeat(64),
};
const response = {
  version: "new-dawn-md-aged-invoice-review/1", audience: "openfolk_operator_only",
  tenant_id: tenant, actor_id: actor, environment: "production", realm_id: "1197397945",
  as_of: "2026-10-20", read_at: "2026-10-20T09:00:00Z",
  eligible_count: 1, has_more: false, candidates: [row],
  audit_id: "00000000-0000-0000-0000-000000000004",
};

test("accepts one strictly scoped aged invoice lead without inventing a job or customer", () => {
  const page = readMdAgedInvoicePage(response, tenant, actor);
  assert.equal(page.candidates[0].balance, "125.50");
  assert.equal("jobId" in page.candidates[0], false);
  assert.equal("customerId" in page.candidates[0], false);
});

test("rejects client audience, other tenant and stale or non-aged invoices", () => {
  for (const changed of [
    { audience: "client_owner" }, { tenant_id: actor }, { actor_id: tenant },
    { environment: "sandbox" }, { candidates: [{ ...row, due_date: "2026-09-01" }] },
    { candidates: [{ ...row, source_observed_at: "2026-10-01T08:00:00Z" }] },
    { candidates: [{ ...row, balance: "0.00" }] },
    { candidates: [{ ...row, currency: "gbp" }] },
    { candidates: [{ ...row, source_sha256: "invalid" }] },
  ]) assert.throws(() => readMdAgedInvoicePage({ ...response, ...changed }, tenant, actor));
});

test("requires a full next page and a strictly increasing source cursor", () => {
  assert.throws(() => readMdAgedInvoicePage({ ...response, has_more: true }, tenant, actor));
  assert.throws(() => readMdAgedInvoicePage(response, tenant, actor, {
    dueDate: row.due_date, versionId: row.source_version_id,
  }));
});
