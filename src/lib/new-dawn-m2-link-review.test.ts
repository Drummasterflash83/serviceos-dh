import assert from "node:assert/strict";
import test from "node:test";
import {
  exactLinkReviewAction, exactLinkReviewLabel, exactSourceReviewDestination, loadExactLinkReviewPage,
  readExactLinkReviewPage,
} from "./new-dawn-m2-link-review.ts";

const tenant = "00000000-0000-0000-0000-000000000001";
const connection = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const audit = "33333333-3333-4333-8333-333333333333";
const version = "44444444-4444-4444-8444-444444444444";
const now = Date.parse("2026-10-20T09:00:00Z");
const payload = () => ({
  version: "new-dawn-exact-link-review/1", tenant_id: tenant,
  connection_id: connection, actor_id: actor, audit_id: audit,
  observed_at: "2026-10-20T09:00:00Z", next_cursor: "12",
  rows: [
    { external_id: "10", state: "review", reason: "site_mapping_missing_or_stale", source_version_id: null },
    { external_id: "12", state: "ready", reason: null, source_version_id: version },
  ],
});

test("only a fresh, exact-scoped audited page is shown", () => {
  const page = readExactLinkReviewPage(payload(), { tenant, connection, actor }, now);
  assert.deepEqual(page.rows.map(row => row.externalId), ["10", "12"]);
  assert.equal(page.nextCursor, "12");
  assert.equal(exactLinkReviewAction(page.rows[0]), "customer_site");
  assert.equal(exactLinkReviewAction(page.rows[1]), "job");
  assert.match(exactLinkReviewLabel(page.rows[0]), /exact work site/);
});

test("source ambiguity and conflict remain held", () => {
  for (const reason of ["property_source_missing_or_ambiguous", "customer_source_missing_or_ambiguous", "customer_site_conflict"])
    assert.equal(exactLinkReviewAction({ externalId: "10", state: "review", reason, sourceVersionId: null }), "hold");
});

test("only a reviewed customer with an exact retained work-site ID skips customer review", () => {
  const row = { externalId: "10", state: "review" as const,
    reason: "site_mapping_missing_or_stale", sourceVersionId: null };
  assert.equal(exactSourceReviewDestination(row, "reviewed", "42"), "site");
  assert.equal(exactSourceReviewDestination(row, "unreviewed", "42"), "customer");
  assert.equal(exactSourceReviewDestination(row, "reviewed", null), "customer");
  assert.equal(exactSourceReviewDestination({ ...row, reason: "customer_site_conflict" }, "reviewed", "42"), "customer");
});

test("rejects cross-tenant, stale, unordered and unsupported ready evidence", () => {
  const scope = { tenant, connection, actor };
  assert.throws(() => readExactLinkReviewPage({ ...payload(), tenant_id: actor }, scope, now));
  assert.throws(() => readExactLinkReviewPage({ ...payload(), observed_at: "2026-10-20T08:55:00Z" }, scope, now));
  assert.throws(() => readExactLinkReviewPage({ ...payload(), rows: payload().rows.reverse() }, scope, now));
  assert.throws(() => readExactLinkReviewPage({ ...payload(), rows: [{ external_id: "10", state: "ready", reason: null, source_version_id: null }], next_cursor: null }, scope, now));
});

test("loader sends a bounded cursor and never accepts an RPC error", async () => {
  const calls: unknown[] = [];
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]); return { data: { ...payload(), observed_at: new Date().toISOString() }, error: null };
  } };
  await loadExactLinkReviewPage(db, { tenant, connection, actor, reason: "Client source review", after: null });
  assert.deepEqual(calls[0], ["new_dawn_m2_link_review_page", {
    p_tenant: tenant, p_connection: connection, p_after: null,
    p_limit: 50, p_reason: "Client source review",
  }]);
  await assert.rejects(loadExactLinkReviewPage({ rpc: async () => ({ data: payload(), error: Error("denied") }) },
    { tenant, connection, actor, reason: "Client source review", after: null }));
});
