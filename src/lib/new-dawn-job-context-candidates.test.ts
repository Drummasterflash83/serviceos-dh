import assert from "node:assert/strict";
import test from "node:test";
import { parseJobContextCandidates, readJobContextCandidates } from "./new-dawn-job-context-candidates.ts";

const tenant = "00000000-0000-4000-8000-000000000010";
const actor = "00000000-0000-4000-8000-000000000011";
const job = "00000000-0000-4000-8000-000000000012";
const source = "00000000-0000-4000-8000-000000000013";
const page = () => ({
  version: "new-dawn-job-context-candidates/1",
  tenant_id: tenant,
  job_id: job,
  actor_id: actor,
  audit_id: "00000000-0000-4000-8000-000000000014",
  read_at: new Date().toISOString(),
  window_days: 90,
  state: "customer_context_only",
  commusoft_job_source_id: "001",
  commusoft_job_source_version_id: source,
  job_source_freshness: "unverified",
  communication_freshness: "retained_occurrence_only",
  job_link_state: "unverified",
  finance_state: "held_no_reviewed_cross_provider_job_mapping",
  has_more: false,
  candidates: [{
    interaction_id: "00000000-0000-4000-8000-000000000015",
    source_table: "slack_messages",
    source_id: "00000000-0000-4000-8000-000000000016",
    occurred_at: new Date().toISOString(),
    customer_evidence: "company",
    job_identity: "unverified",
  }],
});

test("one bounded read preserves the source job code and unverified context", async () => {
  let calls = 0;
  const result = await readJobContextCandidates({ rpc(name, args) {
    calls++;
    assert.equal(name, "new_dawn_job_context_candidates");
    assert.deepEqual(args, { p_tenant: tenant, p_job: job, p_reason: "review job context", p_limit: 20 });
    return { abortSignal: async () => ({ data: page(), error: null }) };
  } }, { tenant, actor, job, reason: " review job context " }, AbortSignal.timeout(1000));
  assert.equal(calls, 1);
  assert.equal(result.commusoft_job_source_id, "001");
  assert.equal(result.candidates[0].job_identity, "unverified");
});

test("refuses a forged linked state, cross-tenant result or excess page", () => {
  const forged = page();
  forged.candidates[0].job_identity = "verified";
  assert.throws(() => parseJobContextCandidates(forged, tenant, actor, job));
  const foreign = page();
  foreign.tenant_id = "00000000-0000-4000-8000-000000000099";
  assert.throws(() => parseJobContextCandidates(foreign, tenant, actor, job));
  const excess = page();
  excess.candidates = Array.from({ length: 21 }, () => page().candidates[0]);
  assert.throws(() => parseJobContextCandidates(excess, tenant, actor, job));
});

test("invalid or missing operator reason makes no provider or database call", async () => {
  await assert.rejects(readJobContextCandidates({ rpc() { throw Error("must not call"); } },
    { tenant, actor, job, reason: "" }, AbortSignal.timeout(1000)));
});
