import assert from "node:assert/strict";
import test from "node:test";
import { parseExactJobDetail, parseExactTrialOffer, readExactJobDetail } from "./new-dawn-exact-job-detail.ts";
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
test("trial offer is bound to signed-in actor, job, source version and deadline", () => {
  const now = Date.parse("2026-10-19T16:00:00Z");
  const scope = { tenant, job, actor: audit, sourceVersion, externalId: "123" };
  const offer = { request_id: request, tenant_id: tenant, job_id: job, actor_id: audit,
    source_version_id: sourceVersion, external_id: "123", expires_at: "2026-10-19T16:05:00Z" };
  assert.equal(parseExactTrialOffer(null, scope, now), null);
  assert.equal(parseExactTrialOffer(offer, scope, now)?.requestId, request);
  assert.throws(() => parseExactTrialOffer({ ...offer, actor_id: job }, scope, now));
  assert.throws(() => parseExactTrialOffer({ ...offer, source_version_id: job }, scope, now));
  assert.throws(() => parseExactTrialOffer({ ...offer, expires_at: "2026-10-19T15:59:00Z" }, scope, now));
});
test("bounded exact result keeps source identity and labels", () => {
  const parsed = parseExactJobDetail(result, { tenant, job, request, sourceVersion, externalId: "123" });
  assert.equal(parsed.sourceUsers[0].id, "7"); assert.equal(parsed.expectedOnsite, result.expected_onsite);
  assert.throws(() => parseExactJobDetail({ ...result, job_id: tenant }, { tenant, job, request, sourceVersion, externalId: "123" }));
  assert.throws(() => parseExactJobDetail({ ...result, source_assigned_users: [{ name: "X" }] }, { tenant, job, request, sourceVersion, externalId: "123" }));
});
test("new source operational facts keep absent, null and false separate", () => {
  const facts = {
    isJobOnHold: { state: "present", value: false },
    onHoldReasonDescription: { state: "not_supplied", value: null },
    hasSLA: { state: "present", value: true },
    SLAStatus: { state: "source_null", value: null },
    contractID: { state: "present", value: "00123" },
  };
  const scope = { tenant, job, request, sourceVersion, externalId: "123" };
  // Provider numeric IDs are canonical decimal strings; job codes retain their
  // own formatting in saved source records and are never used as identity here.
  const current = { ...result, version: "commusoft-exact-job-detail/2",
    source_operational_facts: { ...facts, contractID: { state: "present", value: "123" } } };
  const parsed = parseExactJobDetail(current, scope);
  assert.equal(parsed.sourceOperationalFacts?.isJobOnHold.value, false);
  assert.equal(parsed.sourceOperationalFacts?.onHoldReasonDescription.state, "not_supplied");
  assert.equal(parsed.sourceOperationalFacts?.SLAStatus.state, "source_null");
  assert.equal(parsed.sourceOperationalFacts?.contractID.value, "123");
  assert.equal(parseExactJobDetail(result, scope).sourceOperationalFacts, null);
  assert.throws(() => parseExactJobDetail({ ...current, source_operational_facts: facts }, scope));
  assert.throws(() => parseExactJobDetail({ ...current, source_operational_facts: {
    ...current.source_operational_facts, isJobOnHold: { state: "present", value: "false" },
  } }, scope));
  assert.throws(() => parseExactJobDetail({ ...current, source_operational_facts: {
    ...current.source_operational_facts, SLAStatus: { state: "not_supplied", value: "Open" },
  } }, scope));
  assert.throws(() => parseExactJobDetail({ ...result, source_operational_facts: current.source_operational_facts }, scope));
});
test("current quote is source text with distinct absent and null states", () => {
  const scope = { tenant, job, request, sourceVersion, externalId: "123" };
  const operational = {
    isJobOnHold: { state: "not_supplied", value: null },
    onHoldReasonDescription: { state: "not_supplied", value: null },
    hasSLA: { state: "not_supplied", value: null },
    SLAStatus: { state: "not_supplied", value: null },
    contractID: { state: "not_supplied", value: null },
  };
  const current = { ...result, version: "commusoft-exact-job-detail/3",
    source_operational_facts: operational,
    source_quoted_amount: { state: "present", value: "001.25" } };
  assert.equal(parseExactJobDetail(current, scope).sourceQuotedAmount?.value, "001.25");
  assert.equal(parseExactJobDetail({ ...current, source_quoted_amount: { state: "source_null", value: null } }, scope).sourceQuotedAmount?.state, "source_null");
  assert.equal(parseExactJobDetail({ ...current, source_quoted_amount: { state: "not_supplied", value: null } }, scope).sourceQuotedAmount?.state, "not_supplied");
  assert.throws(() => parseExactJobDetail({ ...current, source_quoted_amount: { state: "present", value: 1.25 } }, scope));
  assert.throws(() => parseExactJobDetail({ ...current, source_quoted_amount: { state: "present", value: "x".repeat(201) } }, scope));
  assert.throws(() => parseExactJobDetail({ ...result, source_quoted_amount: current.source_quoted_amount }, scope));
});
test("client submits one generated request and validates returned scope", async () => {
  const seen: unknown[] = [];
  const output = await readExactJobDetail({ functions: { invoke: async (_name, opts) => {
    seen.push(opts.body);
    return { data: { ...result, request_id: (opts.body as Record<string,string>).requestId }, error: null };
  } } }, tenant, job, sourceVersion, "123", "Review job");
  assert.equal(output.auditId, audit); assert.equal(seen.length, 1);
});
test("client uses only the explicitly armed request UUID", async () => {
  const seen: Record<string, string>[] = [];
  await readExactJobDetail({ functions: { invoke: async (_name, opts) => {
    seen.push(opts.body);
    return { data: result, error: null };
  } } }, tenant, job, sourceVersion, "123", "Review job", request);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].requestId, request);
  await assert.rejects(() => readExactJobDetail({ functions: { invoke: async () => {
    throw Error("should not be called");
  } } }, tenant, job, sourceVersion, "123", "Review job", "wrong"));
});
