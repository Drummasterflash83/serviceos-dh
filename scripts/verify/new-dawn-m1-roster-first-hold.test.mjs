import { test } from "node:test";
import assert from "node:assert/strict";
import { assessRoster, readRoster, QUERY } from "./new-dawn-m1-roster-first-hold.mjs";

const row = () => ({
  observed_at: "2026-10-20T13:50:27Z",
  configured_connections: 1,
  observed_job_ids: 8,
  unlinked_job_ids: 7,
  distinct_referenced_property_ids: 5,
  ambiguous_latest_job_ids: 0,
  ambiguous_latest_property_ids: 0,
  job_first_holds: {
    customer_property_outside_dual_id: 2,
    customer_identity_unreviewed: 2,
    postcode_collision: 1,
    provisional_site_review: 2,
  },
  distinct_property_ids_by_first_hold: {
    customer_property_outside_dual_id: 1,
    customer_identity_unreviewed: 2,
    postcode_collision: 1,
    provisional_site_review: 1,
  },
});

test("whole-roster receipt stays aggregate-only and never claims a safe link set", () => {
  const result = assessRoster(row());
  assert.equal(result.unlinked_job_ids, 7);
  assert.equal(result.job_first_holds.customer_property_outside_dual_id, 2);
  assert.equal(result.clean_exact_batch_proven, false);
  assert.equal(result.links_applied_by_verifier, 0);
  assert.equal(result.job_first_holds.job_source_hold, 0);
  assert.ok(!JSON.stringify(result).includes("external_id"));
});

test("partition gaps, unknown buckets and multiple configured connections fail closed", () => {
  const gap = row();
  gap.job_first_holds.provisional_site_review = 1;
  assert.throws(() => assessRoster(gap), /whole unlinked roster/);
  const unknown = row();
  unknown.job_first_holds.ready_to_link = 1;
  assert.throws(() => assessRoster(unknown), /Unexpected first-hold/);
  const multi = row();
  multi.configured_connections = 2;
  assert.throws(() => assessRoster(multi), /connection or source roster/);
});

test("network call uses the read-only endpoint and returns no source rows", async () => {
  let called = 0;
  const fetcher = async (url, options) => {
    called++;
    assert.match(url, /\/database\/query\/read-only$/);
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    const body = JSON.parse(options.body);
    assert.equal(body.query, QUERY);
    assert.match(body.query, /where v\.tenant_id='00000000-0000-0000-0000-000000000001'/);
    return { ok: true, json: async () => [row()] };
  };
  const result = await readRoster({ token: "synthetic", fetcher });
  assert.equal(called, 1);
  assert.equal(result.unlinked_job_ids, 7);
  assert.ok(!("rows" in result));
});
