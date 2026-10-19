import assert from "node:assert/strict";
import test from "node:test";
import { parseExactJobDetail, readExactJobDetail } from "./new-dawn-exact-job-detail.ts";
const tenant = "00000000-0000-4000-8000-000000000001";
const job = "00000000-0000-4000-8000-000000000002";
const request = "00000000-0000-4000-8000-000000000003";
const sourceVersion = "00000000-0000-4000-8000-000000000004";
const audit = "00000000-0000-4000-8000-000000000005";
const result = { version: "commusoft-exact-job-detail/1", tenant_id: tenant, job_id: job,
  request_id: request, source_version_id: sourceVersion, external_id: "123", audit_id: audit,
  checked_at: "2026-10-19T16:00:00Z", status: "Open", stage: "In progress", pipeline: null,
  expected_onsite: "2026-10-20T08:00:00Z", expected_completion: null,
  provider_updated_at: null, source_assigned_users: [{ source_user_id: "7", name: "Source user" }] };
test("bounded exact result keeps source identity and labels", () => {
  const parsed = parseExactJobDetail(result, { tenant, job, request, sourceVersion, externalId: "123" });
  assert.equal(parsed.sourceUsers[0].id, "7"); assert.equal(parsed.expectedOnsite, result.expected_onsite);
  assert.throws(() => parseExactJobDetail({ ...result, job_id: tenant }, { tenant, job, request, sourceVersion, externalId: "123" }));
  assert.throws(() => parseExactJobDetail({ ...result, source_assigned_users: [{ name: "X" }] }, { tenant, job, request, sourceVersion, externalId: "123" }));
});
test("client submits one generated request and validates returned scope", async () => {
  const seen: unknown[] = [];
  const output = await readExactJobDetail({ functions: { invoke: async (_name, opts) => {
    seen.push(opts.body);
    return { data: { ...result, request_id: (opts.body as Record<string,string>).requestId }, error: null };
  } } }, tenant, job, sourceVersion, "123", "Review job");
  assert.equal(output.auditId, audit); assert.equal(seen.length, 1);
});
