import assert from "node:assert/strict";
import { test } from "node:test";
import { readClientJobRecord } from "./new-dawn-client-job-record.ts";
import type { OpenJobRow } from "./new-dawn-open-job-page.ts";

const tenant = "00000000-0000-0000-0000-000000000001";
const actor = "00000000-0000-0000-0000-000000000002";
const row: OpenJobRow = {
  connection_id: "00000000-0000-0000-0000-000000000003",
  external_id: "123",
  source_version_id: "00000000-0000-0000-0000-000000000004",
  source_observed_at: "2026-10-20T08:00:00Z",
  job_created_at: "2026-10-19T08:00:00Z",
  status_first_saved_at: "2026-10-20T08:00:00Z",
  status_evidence: "timing_unknown",
  status: "on_hold", title: "Check boiler", source_customer: "Client",
  source_site: "Site", source_postcode: "SO1 1AA",
  property_external_id: "34", customer_external_id: "12",
  context_state: "source_customer_and_property", identity_state: "reviewed_link",
};
const now = Date.parse("2026-10-20T09:00:00Z");
const base = {
  version: "new-dawn-client-job-record/1",
  tenant_id: tenant, actor_id: actor,
  connection_id: row.connection_id, external_id: row.external_id,
  source_version_id: row.source_version_id,
  source_observed_at: row.source_observed_at,
  read_at: "2026-10-20T09:00:00Z",
  audit_id: "00000000-0000-0000-0000-000000000005",
  status: "on_hold", priority: null, description: "Check boiler",
  exact_detail: {
    checked_at: "2026-10-20T08:30:00Z", stage: "Awaiting parts",
    pipeline: "Reactive", source_users: [
      { source_user_id: "7", name: "Source user" },
    ], hold_reason: "Parts requested", provider_updated_at: null,
  },
};

test("reads exact stage and source people without converting them into assignments", () => {
  const record = readClientJobRecord(base, tenant, actor, row, now);
  assert.equal(record.exactDetail?.stage, "Awaiting parts");
  assert.deepEqual(record.exactDetail?.sourceUsers, [{ id: "7", name: "Source user" }]);
  assert.equal(record.exactDetail?.holdReason, "Parts requested");
});

test("holds exact detail for an unreviewed job, and refuses changed scope", () => {
  assert.throws(() => readClientJobRecord(base, tenant, actor,
    { ...row, identity_state: "awaiting_review" }, now));
  assert.throws(() => readClientJobRecord(base, tenant, actor,
    { ...row, source_version_id: "00000000-0000-0000-0000-000000000006" }, now));
  assert.throws(() => readClientJobRecord({ ...base, external_id: "124" },
    tenant, actor, row, now));
  assert.throws(() => readClientJobRecord({ ...base, read_at: "2026-10-20T08:50:00Z" },
    tenant, actor, row, now));
  assert.equal(readClientJobRecord({ ...base, exact_detail: null }, tenant, actor, row, now).exactDetail, null);
});
