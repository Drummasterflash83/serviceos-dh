import assert from "node:assert/strict";
import { test } from "node:test";
import { assessParentPath, readParentPath, QUERY } from "./new-dawn-m2-parent-identity-readback.mjs";

const row = {
  observed_at: "2026-10-20T15:00:00Z", held_jobs: 3,
  held_workaddresses: 2, held_parent_ids: 1,
  holds: {customer_link_missing:{jobs:3,workaddresses:2,parent_ids:1}},
  existing_target_clues: {no_source_keyed_target:1,one_source_keyed_target:0,
    multiple_source_keyed_targets:0,legacy_target_rows:0,direct_target_rows:0},
  parent_name_shapes:{company_name_and_contact:0,company_name_only:0,
    contact_name_only:1,neither_name_shape:0,unresolved_source_kind:0},
  site_source_shapes:{postcode_collision:0,site_field_hold:0,
    existing_identity_review:0,source_shape_candidate_after_parent_review:2},
  jobs_on_site_source_shape_candidates:3,
};

test("parent-path query is aggregate-only and reuses the tenant-bounded first hold", () => {
  assert.match(QUERY, /first_hold='customer_identity_unreviewed'/);
  assert.match(QUERY, /held_parents as materialized/);
  assert.match(QUERY, /legacy_targets\+direct_people\+direct_companies/);
  assert.doesNotMatch(QUERY, /\b(insert|update|delete|truncate|perform)\b/i);
});

test("assesses the entire held partition without granting auto-link permission", () => {
  const assessed = assessParentPath(row);
  assert.equal(assessed.holds.customer_link_missing.jobs, 3);
  assert.equal(assessed.automatic_identity_batch_proven, false);
  assert.equal(assessed.customer_links_applied_by_verifier, 0);
  assert.equal(assessed.site_links_applied_by_verifier, 0);
  assert.equal(assessed.jobs_on_site_source_shape_candidates,3);
});

test("unexpected ready, incomplete categories, and incomplete target clues fail closed", () => {
  assert.throws(() => assessParentPath({...row,holds:{unexpected_ready:{jobs:3,workaddresses:2,parent_ids:1}}}));
  assert.throws(() => assessParentPath({...row,holds:{customer_link_missing:{jobs:2,workaddresses:2,parent_ids:1}}}));
  assert.throws(() => assessParentPath({...row,existing_target_clues:{...row.existing_target_clues,no_source_keyed_target:0}}));
  assert.throws(() => assessParentPath({...row,site_source_shapes:{...row.site_source_shapes,site_field_hold:1}}));
});

test("readback uses the read-only endpoint and validates the one-row response", async () => {
  let called = 0;
  const result = await readParentPath({token:"test-token",fetcher:async (url,options) => {
    called++;
    assert.match(url,/\/database\/query\/read-only$/);
    assert.equal(options.method,"POST");
    assert.equal(options.headers.Authorization,"Bearer test-token");
    return {ok:true,json:async()=>[row]};
  }});
  assert.equal(called,1);
  assert.equal(result.held_jobs,3);
});
