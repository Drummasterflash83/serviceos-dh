import assert from "node:assert/strict";
import test from "node:test";
import { customerSourceForReview, loadSourceJobPage, readSourceJobPage } from "./learn-commusoft-source-jobs.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { tenant: id(1), actor: id(2), connection: id(3), query: "", openOnly: true, after: null };
const now = Date.parse("2026-10-16T14:00:00Z");
function response() { return {
  version: "commusoft-source-job-cards/1", tenant_id: scope.tenant, actor_id: scope.actor, connection_id: scope.connection,
  query: "", open_only: true, after: null, audit_id: id(4), observed_at: new Date(now).toISOString(), latest_job_page_at: null,
  next_after: null, counts: { retained_jobs: 1, open_jobs: 1, matching_jobs: 1, reviewed_jobs: 0, source_relationship_gaps: 0, unreviewed_customer_identities: 1 },
  rows: [{ external_id: "17", version_id: id(5), observed_at: "2026-10-15T14:00:00+00:00", title: "001. Domestic Income - Maintenance", source_status: "Open", business_unit: "001. Gas",
    property_reference: "42", customer_reference: "42", company_name: null, contact_name: "Named Contact", relationship_state: "customer_source_retained", customer_identity_state: "unreviewed", reviewed_job_id: null }],
}; }
test("unclassified source jobs remain visible with leading-zero work text and a separate contact", () => {
  const p = readSourceJobPage(response(), scope, now);
  assert.equal(p.rows[0].title, "001. Domestic Income - Maintenance");
  assert.equal(p.rows[0].business_unit, "001. Gas");
  assert.equal(p.rows[0].company_name, null);
  assert.equal(p.rows[0].customer_identity_state, "unreviewed");
});
test("customer-review navigation requires an exact retained parent, never a missing or conflicted identity", () => {
  const row = readSourceJobPage(response(), scope, now).rows[0];
  assert.equal(customerSourceForReview(row), "42");
  assert.equal(customerSourceForReview({ ...row, relationship_state: "site_customer_source_retained", property_reference: "19" }), "42");
  assert.equal(customerSourceForReview({ ...row, relationship_state: "customer_source_missing" }), null);
  assert.equal(customerSourceForReview({ ...row, version_id: null }), null);
  assert.equal(customerSourceForReview({ ...row, customer_reference: null }), null);
});
test("reject foreign tenant, actor, connection and stale/mismatched read scopes", () => {
  for (const field of ["tenant_id", "actor_id", "connection_id", "audit_id"]) {
    const r: any = response(); r[field] = field === "audit_id" ? "bad" : id(99);
    assert.throws(() => readSourceJobPage(r, scope, now));
  }
  for (const patch of [{ observed_at: "2020-01-01T00:00:00Z" }, { open_only: false }, { query: "other" }, { after: "10" }])
    assert.throws(() => readSourceJobPage({ ...response(), ...patch }, scope, now));
});
test("conflicts cannot carry picked latest status or a reviewed link", () => {
  const r: any = response(); r.open_only = false; r.rows[0].version_id = null; r.rows[0].relationship_state = "job_source_conflict";
  assert.throws(() => readSourceJobPage(r, { ...scope, openOnly: false }, now));
  r.rows[0].source_status = null;
  assert.equal(readSourceJobPage(r, { ...scope, openOnly: false }, now).rows[0].version_id, null);
  r.rows[0].reviewed_job_id = id(7);
  assert.throws(() => readSourceJobPage(r, { ...scope, openOnly: false }, now));
});
test("reject duplicate records, false pagination, malformed counts and unsupported relationship states", () => {
  const mutations = [
    (r: any) => r.rows.push(r.rows[0]), (r: any) => r.next_after = "17",
    (r: any) => r.counts.open_jobs = 2, (r: any) => r.rows[0].relationship_state = "matched_by_work_code",
    (r: any) => r.rows[0].property_reference = 42, (r: any) => r.rows[0].business_unit = 1,
  ];
  for (const change of mutations) { const r = response(); change(r); assert.throws(() => readSourceJobPage(r, scope, now)); }
});
test("invalid scope cannot invoke an RPC and server failures do not become empty success", async () => {
  let calls = 0;
  const db = { rpc: async () => { calls++; return { data: null, error: Error("denied") }; } };
  await assert.rejects(loadSourceJobPage(db, { ...scope, query: "bad\nquery" })); assert.equal(calls, 0);
  await assert.rejects(loadSourceJobPage(db, scope)); assert.equal(calls, 1);
});
