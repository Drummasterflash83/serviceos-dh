import assert from "node:assert/strict";
import test from "node:test";
import { readFocClosureReview } from "./new-dawn-foc-closure-review.ts";

const tenant = "00000000-0000-0000-0000-000000000001";
const actor = "00000000-0000-0000-0000-000000000002";
const row = {
  job_id: "00000000-0000-0000-0000-000000000003",
  job_number: "001",
  external_id: "13427",
  connection_id: "00000000-0000-0000-0000-000000000004",
  source_version_id: "00000000-0000-0000-0000-000000000005",
  source_sha256: "a".repeat(64),
  detail_sha256: "b".repeat(64),
  checked_at: "2026-10-20T12:00:00Z",
  closed_at_source: "2026-10-20T11:00:00",
  foc_reason_source: "Synthetic customer agreement",
};
const response = {
  version: "new-dawn-foc-closure-review/1",
  audience: "openfolk_operator_only",
  tenant_id: tenant,
  actor_id: actor,
  source: "Commusoft exact job detail",
  scope: "recorded_free_of_charge_closure_not_invoice_or_payment",
  checked_at: "2026-10-20T12:01:00Z",
  candidate_count: 1,
  rows: [row],
  audit_id: "00000000-0000-0000-0000-000000000006",
};

test("only exact, dated operator closure evidence is accepted", () => {
  const value = readFocClosureReview(response, tenant, actor);
  assert.equal(value.candidateCount, 1);
  assert.deepEqual(
    value.rows.map((x) => [x.jobNumber, x.externalId]),
    [["001", "13427"]],
  );
  assert.equal("amount" in value.rows[0], false);
  for (const changed of [
    { audience: "client_owner" },
    { tenant_id: actor },
    { actor_id: tenant },
    { scope: "completed_not_invoiced" },
    { candidate_count: 0 },
    { rows: [{ ...row, checked_at: "2026-10-21T12:00:00Z" }] },
    { rows: [{ ...row, source_sha256: "bad" }] },
    { rows: [{ ...row, foc_reason_source: "x".repeat(201) }] },
    { rows: [row, row] },
  ])
    assert.throws(
      () => readFocClosureReview({ ...response, ...changed }, tenant, actor),
      /foc_closure_review_invalid/,
    );
});

test("empty source review makes no absence claim", () => {
  const value = readFocClosureReview({ ...response, candidate_count: 0, rows: [] }, tenant, actor);
  assert.equal(value.rows.length, 0);
});
