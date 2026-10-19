import assert from "node:assert/strict";
import { test } from "node:test";
import { canSeeCompanyJobs, homeJobAction, homeJobState, orderHomeJobs, readOperatorHomePage, type HomeJob } from "./new-dawn-job-home.ts";

const job = (id: string, status: string | null, verified = true): HomeJob => ({
  id, tenant_id: "tenant", job_number: id, title: null, status, verified,
  updated_at: "2026-10-19T09:00:00Z", customer: null, site: null,
});

test("ordinary team membership does not reveal the company-wide job list", () => {
  assert.equal(canSeeCompanyJobs("owner"), true);
  assert.equal(canSeeCompanyJobs("admin"), true);
  assert.equal(canSeeCompanyJobs("member"), false);
  assert.equal(canSeeCompanyJobs("ops"), false);
  assert.equal(canSeeCompanyJobs(undefined), false);
});

test("operator preview requires a fresh audited tenant-and-actor response", () => {
  const tenant = "00000000-0000-0000-0000-000000000001";
  const actor = "00000000-0000-0000-0000-000000000002";
  const response = {
    version: "new-dawn-operator-job-home/1", tenant_id: tenant, actor_id: actor,
    audit_id: "00000000-0000-0000-0000-000000000003", observed_at: new Date().toISOString(),
    rows: [{ id: "00000000-0000-0000-0000-000000000004", fields: {
      job_number: "001", title: "Saved job", status: "open", customer: null,
      address: null, postcode: null, verified: false, updated_at: null,
    } }],
  };
  assert.equal(readOperatorHomePage(response, tenant, actor)[0].fields.job_number, "001");
  assert.throws(() => readOperatorHomePage(response, "00000000-0000-0000-0000-000000000009", actor));
  assert.throws(() => readOperatorHomePage({ ...response, audit_id: null }, tenant, actor));
  assert.throws(() => readOperatorHomePage({ ...response, observed_at: "2020-01-01" }, tenant, actor));
});

test("saved status and review order do not claim provider urgency or completion", () => {
  const rows = orderHomeJobs([
    job("completed", "completed"), job("open", "open"),
    job("unknown", null, false), job("hold", "on_hold"),
  ]);
  assert.deepEqual(rows.map((row) => row.id), ["hold", "open", "unknown", "completed"]);
  assert.equal(homeJobState(rows[2]), "Status needs confirmation");
  assert.equal(homeJobAction(rows[2]), "Confirm this job’s status with its source");
  assert.equal(homeJobState(rows[3]), "Recorded complete");
  assert.equal(homeJobAction(rows[3]), "Review the recorded outcome");
});
