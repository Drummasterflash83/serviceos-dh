import assert from "node:assert/strict";
import { test } from "node:test";
import { homeJobAction, homeJobState, orderHomeJobs, type HomeJob } from "./new-dawn-job-home.ts";

const job = (id: string, status: string | null, verified = true): HomeJob => ({
  id, tenant_id: "tenant", job_number: id, title: null, status, verified,
  updated_at: "2026-10-19T09:00:00Z", customer: null, site: null,
});

test("saved status and review order do not claim provider urgency or completion", () => {
  const rows = orderHomeJobs([
    job("completed", "completed"), job("open", "open"),
    job("unknown", null, false), job("hold", "on_hold"),
  ]);
  assert.deepEqual(rows.map((row) => row.id), ["unknown", "hold", "open", "completed"]);
  assert.equal(homeJobState(rows[0]), "Status needs confirmation");
  assert.equal(homeJobAction(rows[0]), "Review this job’s source");
  assert.equal(homeJobState(rows[3]), "Recorded complete");
  assert.equal(homeJobAction(rows[3]), "Review the recorded outcome");
});
