import assert from "node:assert/strict";
import test from "node:test";
import { loadExactSiteTarget } from "./new-dawn-exact-site-target.ts";

const tenant = "00000000-0000-0000-0000-000000000001";
const connection = "11111111-1111-4111-8111-111111111111";
const version = "22222222-2222-4222-8222-222222222222";
const link = "44444444-4444-4444-8444-444444444444";
const audit = "55555555-5555-4555-8555-555555555555";
const input = { tenant, connection, external: "42", reason: "Inspect exact source for saved job" };
const base = { version: "new-dawn-exact-site-target/1", tenant_id: tenant,
  connection_id: connection, external_id: "42", actor_id: audit,
  source_version_id: version, recorded_parent_id: "8", source_address_line: "Workshop",
  audit_id: audit, observed_at: "2026-10-20T09:30:00Z", reason: null };

test("audited target keeps exact tenant, parent and version", async () => {
  const calls: unknown[] = [];
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]); return { data: { ...base, state: "ready", link_id: null }, error: null };
  } };
  assert.deepEqual(await loadExactSiteTarget(db, input), {
    state: "ready", version, parent: "8", address: "Workshop", linkId: null,
    auditId: audit, reason: null, observedAt: "2026-10-20T09:30:00Z",
  });
  assert.deepEqual(calls[0], ["new_dawn_m2_exact_site_target_review", {
    p_tenant: tenant, p_connection: connection, p_external: "42", p_reason: input.reason,
  }]);
  await assert.rejects(loadExactSiteTarget(db, { ...input, external: "00042" }));
  assert.equal(calls.length, 1);
});

test("current and reversed states require a link; cross-tenant and missing audit are rejected", async () => {
  const read = async (data: unknown) => loadExactSiteTarget({ rpc: async () => ({ data, error: null }) }, input);
  assert.equal((await read({ ...base, state: "reversed_valid", link_id: link })).linkId, link);
  await assert.rejects(read({ ...base, state: "linked_current", link_id: null }));
  await assert.rejects(read({ ...base, state: "ready", link_id: link }));
  await assert.rejects(read({ ...base, state: "ready", link_id: null, tenant_id: connection }));
  await assert.rejects(read({ ...base, state: "ready", link_id: null, audit_id: null }));
});
