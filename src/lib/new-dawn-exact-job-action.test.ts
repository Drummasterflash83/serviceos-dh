import assert from "node:assert/strict";
import test from "node:test";
import { applyExactJobLink, reverseExactJobLink } from "./new-dawn-exact-job-action.ts";

const tenant = "00000000-0000-0000-0000-000000000001";
const connection = "11111111-1111-4111-8111-111111111111";
const version = "22222222-2222-4222-8222-222222222222";
const job = "33333333-3333-4333-8333-333333333333";
const link = "44444444-4444-4444-8444-444444444444";
const audit = "55555555-5555-4555-8555-555555555555";
const input = { tenant, connection, external: "1234", version, reason: "Verified exact customer and work-site source IDs" };

test("only an exact, version-checked backend link receipt is accepted", async () => {
  const calls: unknown[] = [];
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]); return { data: { state: "linked", rule: "commusoft_exact_dual_id_v1",
      job_id: job, link_id: link, audit_id: audit, version_id: version }, error: null };
  } };
  assert.deepEqual(await applyExactJobLink(db, input), {
    state: "linked", jobId: job, linkId: link, auditId: audit, versionId: version,
  });
  assert.deepEqual(calls[0], ["new_dawn_commusoft_exact_link_apply", {
    p_tenant: tenant, p_connection: connection, p_external: "1234",
    p_version: version, p_reason: input.reason,
  }]);
  await assert.rejects(applyExactJobLink({ rpc: async () => ({ data: { state: "linked", rule: "commusoft_exact_dual_id_v1", job_id: job, link_id: link, audit_id: audit, version_id: tenant }, error: null }) }, input));
});

test("ambiguity stays review and invalid inputs never invoke the backend", async () => {
  let calls = 0;
  const db = { rpc: async () => { calls++; return { data: { state: "review", reason: "site_mapping_missing_or_stale" }, error: null }; } };
  assert.deepEqual(await applyExactJobLink(db, input), { state: "review", reason: "site_mapping_missing_or_stale" });
  await assert.rejects(applyExactJobLink(db, { ...input, external: "001" }));
  await assert.rejects(applyExactJobLink(db, { ...input, reason: "" }));
  assert.equal(calls, 1);
});

test("reversal uses the exact link and requires a verified audit receipt", async () => {
  const db = { rpc: async (_: string, args: Record<string, unknown>) => {
    assert.deepEqual(args, { p_tenant: tenant, p_link: link, p_action: "reverse", p_reason: "Operator reversed reviewed job link" });
    return { data: { state: "reversed", link_id: link, audit_id: audit }, error: null };
  } };
  assert.deepEqual(await reverseExactJobLink(db, { tenant, link, reason: "Operator reversed reviewed job link" }),
    { state: "reversed", linkId: link, auditId: audit });
  await assert.rejects(reverseExactJobLink({ rpc: async () => ({ data: { state: "reversed", link_id: job, audit_id: audit }, error: null }) },
    { tenant, link, reason: "Operator reversed reviewed job link" }));
});
