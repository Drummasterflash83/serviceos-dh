import assert from "node:assert/strict";
import test from "node:test";
import { applyExactSite, restoreExactSite } from "./new-dawn-exact-site-action.ts";

const tenant = "00000000-0000-0000-0000-000000000001";
const connection = "11111111-1111-4111-8111-111111111111";
const version = "22222222-2222-4222-8222-222222222222";
const site = "33333333-3333-4333-8333-333333333333";
const link = "44444444-4444-4444-8444-444444444444";
const audit = "55555555-5555-4555-8555-555555555555";
const input = { tenant, connection, external: "42", version, reason: "Reviewed saved work address and exact parent customer ID" };

test("site confirmation accepts only the version-locked audited link", async () => {
  const calls: unknown[] = [];
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]); return { data: { state: "linked", site_id: site,
      link_id: link, source_version_id: version, audit_id: audit }, error: null };
  } };
  assert.deepEqual(await applyExactSite(db, input), { state: "linked", siteId: site,
    linkId: link, sourceVersionId: version, auditId: audit });
  assert.deepEqual(calls[0], ["new_dawn_commusoft_exact_site_apply", {
    p_tenant: tenant, p_connection: connection, p_external: "42",
    p_version: version, p_reason: input.reason,
  }]);
  await assert.rejects(applyExactSite({ rpc: async () => ({ data: { state: "linked", site_id: site,
    link_id: link, source_version_id: tenant, audit_id: audit }, error: null }) }, input));
});

test("missing customer mapping remains held, and invalid scope never calls the provider", async () => {
  let calls = 0;
  const db = { rpc: async () => { calls++; return { data: { state: "review", reason: "customer_mapping_missing_or_stale" }, error: null }; } };
  assert.deepEqual(await applyExactSite(db, input), { state: "review", reason: "customer_mapping_missing_or_stale" });
  await assert.rejects(applyExactSite(db, { ...input, external: "00042" }));
  await assert.rejects(applyExactSite(db, { ...input, version: tenant, reason: "" }));
  assert.equal(calls, 1);
});

test("reversed site can be restored only through audited toggle", async () => {
  const calls: unknown[] = [];
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]);
    return { data: { state: "restored", link_id: link, audit_id: audit }, error: null };
  } };
  assert.deepEqual(await restoreExactSite(db, { tenant, linkId: link, reason: input.reason }),
    { state: "restored", linkId: link, auditId: audit });
  assert.deepEqual(calls[0], ["new_dawn_commusoft_exact_site_toggle", {
    p_tenant: tenant, p_link: link, p_action: "restore", p_reason: input.reason,
  }]);
  await assert.rejects(restoreExactSite(db, { tenant, linkId: "not-uuid", reason: input.reason }));
  assert.equal(calls.length, 1);
});
