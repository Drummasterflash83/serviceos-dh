import test from "node:test";
import assert from "node:assert/strict";
import { JOB_DETAIL_DATES, JOB_DETAIL_FIELDS } from "./learn-commusoft-job-details.ts";
import { mdPreviewJobFacts } from "./new-dawn-md-job-facts.ts";
import type { OperatorJobSource } from "./new-dawn-operator-job-source.ts";
import type { SourceHomeJob } from "./new-dawn-source-job-home.ts";

const tenant = "00000000-0000-0000-0000-000000000001";
const jobId = "00000000-0000-0000-0000-000000000002";
const job: SourceHomeJob = {
  id: jobId,
  fields: {
    address: "Site",
    customer: "Customer",
    job_number: "001",
    postcode: null,
    status: "open",
    title: "Repair",
    updated_at: "2026-10-19T10:00:00Z",
    verified: true,
  },
  source_state: "reviewed_latest",
  source_observed_at: "2026-10-19T11:00:00Z",
};
function read(): OperatorJobSource {
  return {
    version: "new-dawn-operator-job-source/1",
    tenant_id: tenant,
    actor_id: "00000000-0000-0000-0000-000000000003",
    job_id: jobId,
    audit_id: "00000000-0000-0000-0000-000000000004",
    observed_at: "2026-10-19T11:01:00Z",
    state: "linked",
    source: {
      version: "commusoft-job-detail/2",
      tenant_id: tenant,
      connection_id: "00000000-0000-0000-0000-000000000005",
      version_id: "00000000-0000-0000-0000-000000000006",
      external_id: "955",
      observed_at: "2026-10-19T11:00:00Z",
      current: true,
      property_reference: null,
      fields: Object.fromEntries(
        Object.keys(JOB_DETAIL_FIELDS).map((key) => [key, { value: null, shortened: false }]),
      ) as NonNullable<OperatorJobSource["source"]>["fields"],
      dates: Object.fromEntries(
        Object.keys(JOB_DETAIL_DATES).map((key) => [
          key,
          { state: "absent", source: null, instant: null },
        ]),
      ) as NonNullable<OperatorJobSource["source"]>["dates"],
    },
  };
}

test("MD detail includes only facts from the exact current reviewed source", () => {
  const evidence = read();
  evidence.source!.fields.description.value = "  Replace faulty valve  ";
  evidence.source!.dates.reported = {
    state: "timezone_required",
    source: "2026-10-19 08:30:00",
    instant: null,
  };
  evidence.source!.fields.closedOutcome.value = "Awaiting parts";
  assert.deepEqual(mdPreviewJobFacts(tenant, job, evidence), {
    work: "Replace faulty valve",
    workShortened: false,
    reported: "2026-10-19 08:30:00",
    completed: null,
    outcome: "Awaiting parts",
    observedAt: "2026-10-19T11:00:00Z",
  });
});

test("changed, ambiguous, foreign and no-longer-current links add no MD source facts", () => {
  const evidence = read();
  assert.equal(
    mdPreviewJobFacts(tenant, { ...job, source_state: "source_changed" }, evidence),
    null,
  );
  assert.equal(
    mdPreviewJobFacts(tenant, { ...job, source_state: "source_ambiguous" }, evidence),
    null,
  );
  assert.equal(mdPreviewJobFacts(tenant, job, { ...evidence, job_id: evidence.actor_id }), null);
  assert.equal(mdPreviewJobFacts(evidence.actor_id, job, evidence), null);
  assert.equal(
    mdPreviewJobFacts(tenant, job, { ...evidence, state: "review_required", source: null }),
    null,
  );
  evidence.source!.current = false;
  assert.equal(mdPreviewJobFacts(tenant, job, evidence), null);
});
