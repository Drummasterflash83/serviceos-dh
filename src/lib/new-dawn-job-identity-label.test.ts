import assert from "node:assert/strict";
import test from "node:test";
import { jobSourceIdentity } from "./new-dawn-job-identity-label.ts";

test("unreviewed source names never imply a confirmed OpenFolk customer or site", () => {
  const label = jobSourceIdentity({
    source_customer: "Example Ltd", source_site: "1 Example Road",
    source_postcode: "AB1 2CD", identity_state: "awaiting_review",
  });
  assert.equal(label.sourceLabel, "Example Ltd · 1 Example Road");
  assert.match(label.shortEvidence, /awaiting review/);
  assert.match(label.detailEvidence, /Commusoft source labels/);
  assert.doesNotMatch(label.detailEvidence, /reviewed OpenFolk link/);
});

test("reviewed IDs still attribute display names to Commusoft and missing names stay missing", () => {
  const reviewed = jobSourceIdentity({
    source_customer: "Example Ltd", source_site: null,
    source_postcode: "AB1 2CD", identity_state: "reviewed_link",
  });
  assert.equal(reviewed.sourceLabel, "Example Ltd · AB1 2CD");
  assert.match(reviewed.detailEvidence, /reviewed OpenFolk link/);
  assert.match(reviewed.detailEvidence, /names shown are from Commusoft/);
  const missing = jobSourceIdentity({
    source_customer: null, source_site: null,
    source_postcode: null, identity_state: "awaiting_review",
  });
  assert.equal(missing.sourceLabel, "Customer not recorded · Site not recorded");
});
