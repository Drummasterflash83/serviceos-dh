import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectJobScoreEvidence,
  JOB_SCORE_EVIDENCE_RULES,
} from "./new-dawn-job-score-evidence.ts";
import type { ClientJobRecord } from "./new-dawn-client-job-record.ts";
import type { OpenJobRow } from "./new-dawn-open-job-page.ts";

const row: OpenJobRow = {
  connection_id: "00000000-0000-0000-0000-000000000001",
  external_id: "001",
  source_version_id: "00000000-0000-0000-0000-000000000002",
  source_observed_at: "2026-10-20T09:00:00Z",
  status_first_saved_at: "2026-10-20T09:00:00Z",
  status_evidence: "timing_unknown",
  status: "open",
  title: "Saved job",
  source_customer: "Customer",
  source_site: "Site",
  source_postcode: null,
  property_external_id: "23",
  customer_external_id: "45",
  context_state: "source_customer_and_property",
  identity_state: "reviewed_link",
};
const record: ClientJobRecord = {
  sourceObservedAt: row.source_observed_at,
  readAt: "2026-10-20T09:01:00Z",
  auditId: "00000000-0000-0000-0000-000000000003",
  status: "open",
  priority: null,
  description: null,
  exactDetail: {
    checkedAt: "2026-10-20T09:00:30Z",
    stage: "In progress",
    pipeline: null,
    sourceUsers: [{ id: "9", name: "Source user" }],
    holdReason: null,
    providerUpdatedAt: null,
  },
};

test("draft measures match the review weights, but produce no score", () => {
  assert.equal(
    JOB_SCORE_EVIDENCE_RULES.reduce((n, rule) => n + rule.weight, 0),
    100,
  );
  const evidence = inspectJobScoreEvidence(row, record);
  assert.equal(evidence.length, 7);
  assert.equal(
    evidence.every((item) => !("score" in item)),
    true,
  );
  assert.equal(evidence.find((item) => item.key === "stage_progress")?.state, "source_fragment");
  assert.equal(evidence.find((item) => item.key === "owner_next_step")?.state, "source_fragment");
  assert.equal(evidence.find((item) => item.key === "margin")?.state, "missing");
  assert.equal(evidence.find((item) => item.key === "customer_contact")?.state, "missing");
  assert.equal(
    evidence.find((item) => item.key === "commercial_close")?.state,
    "not_yet_applicable",
  );
  assert.equal(
    evidence.find((item) => item.key === "invoice_timeliness")?.state,
    "not_yet_applicable",
  );
});

test("unreviewed source identity cannot borrow an exact stage or source person", () => {
  const evidence = inspectJobScoreEvidence({ ...row, identity_state: "awaiting_review" }, record);
  assert.equal(evidence.find((item) => item.key === "stage_progress")?.state, "missing");
  assert.equal(evidence.find((item) => item.key === "owner_next_step")?.state, "missing");
});
