import test from "node:test";
import assert from "node:assert/strict";
import { JOB_DETAIL_DATES, JOB_DETAIL_FIELDS } from "./learn-commusoft-job-details.ts";
import { parseOperatorJobSource, readOperatorJobSource } from "./new-dawn-operator-job-source.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = id(1), actor = id(2), job = id(3);
function source(): any {
  return {
    version: "commusoft-job-detail/2", tenant_id: tenant, connection_id: id(4),
    version_id: id(5), external_id: "955", observed_at: "2026-10-19T14:20:00Z",
    current: false, property_reference: "3",
    fields: Object.fromEntries(Object.keys(JOB_DETAIL_FIELDS).map(k => [k, { value: null, shortened: false }])),
    dates: Object.fromEntries(Object.keys(JOB_DETAIL_DATES).map(k => [k, { state: "absent", source: null, instant: null }])),
  };
}
function answer(state: string, detail: any = null): any {
  return { version: "new-dawn-operator-job-source/1", tenant_id: tenant, actor_id: actor,
    job_id: job, audit_id: id(6), observed_at: "2026-10-19T14:21:00Z", state, source: detail };
}
const now = Date.parse("2026-10-19T14:22:00Z");

test("exact audited source version stays marked stale and is never silently substituted", () => {
  const value = answer("linked", source());
  assert.equal(parseOperatorJobSource(value, tenant, actor, job, now).source?.current, false);
  value.source.fields.quotedAmount.value = "£100";
  assert.equal(parseOperatorJobSource(value, tenant, actor, job, now).source?.fields.quotedAmount.value, "£100");
});

test("unlinked and conflicting records do not contain source facts", () => {
  for (const state of ["unlinked", "review_required"])
    assert.equal(parseOperatorJobSource(answer(state), tenant, actor, job, now).source, null);
  assert.throws(() => parseOperatorJobSource(answer("unlinked", source()), tenant, actor, job, now));
});

test("foreign actor/job, private fields and expired audit fail closed", () => {
  const invalid = [
    (v: any) => { v.tenant_id = id(9); },
    (v: any) => { v.actor_id = id(9); },
    (v: any) => { v.job_id = id(9); },
    (v: any) => { v.observed_at = "2026-10-19T14:00:00Z"; },
    (v: any) => { v.source.payload = { secret: "never" }; },
    (v: any) => { v.source.connection_id = id(9); v.source.tenant_id = id(9); },
  ];
  for (const mutate of invalid) {
    const value = answer("linked", source()); mutate(value);
    assert.throws(() => parseOperatorJobSource(value, tenant, actor, job, now));
  }
});

test("loader sends only exact tenant, job and reason; denied results reveal no provider detail", async () => {
  let seen: any;
  // Parsing uses the actual clock; use a current timestamp for this loader check.
  const current = answer("unlinked"); current.observed_at = new Date().toISOString();
  const loaded = await readOperatorJobSource({ rpc: async (name, args) => {
    seen = { name, args }; return { data: current, error: null };
  } }, tenant, actor, job, "  Review source  ");
  assert.equal(loaded.state, "unlinked");
  assert.deepEqual(seen, { name: "new_dawn_operator_job_source",
    args: { p_tenant: tenant, p_job: job, p_reason: "Review source" } });
  await assert.rejects(readOperatorJobSource({ rpc: async () => ({ data: null, error: { message: "private" } }) },
    tenant, actor, job, "review"), (e) => e instanceof Error && !e.message.includes("private"));
});
