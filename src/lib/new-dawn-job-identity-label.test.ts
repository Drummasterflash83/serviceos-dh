import assert from "node:assert/strict";
import test from "node:test";
import { jobSourceIdentity } from "./new-dawn-job-identity-label.ts";

test("unreviewed source names never imply a confirmed OpenFolk customer or site", () => {
  const label = jobSourceIdentity({
    source_customer: "Example Ltd", source_site: "1 Example Road",
    source_postcode: "AB1 2CD", identity_state: "awaiting_review",
  });
  assert.equal(label.sourceLabel, "Example Ltd · 1 Example Road");
  assert.match(label.shortEvidence, /Job source link awaiting review/);
  assert.match(label.shortEvidence, /customer\/site labels unverified/);
  assert.match(label.detailEvidence, /Commusoft source labels/);
  assert.doesNotMatch(label.detailEvidence, /reviewed OpenFolk job link/);
});

test("a reviewed job link does not certify separate customer or site matches", () => {
  const reviewed = jobSourceIdentity({
    source_customer: "Example Ltd", source_site: null,
    source_postcode: "AB1 2CD", identity_state: "reviewed_link",
  });
  assert.equal(reviewed.sourceLabel, "Example Ltd · AB1 2CD");
  assert.match(reviewed.shortEvidence, /Job source linked/);
  assert.match(reviewed.shortEvidence, /customer\/site labels unverified/);
  assert.match(reviewed.detailEvidence, /reviewed OpenFolk job link/);
  assert.match(reviewed.detailEvidence, /does not confirm their own matches/);
  const missing = jobSourceIdentity({
    source_customer: null, source_site: null,
    source_postcode: null, identity_state: "awaiting_review",
  });
  assert.equal(missing.sourceLabel, "Customer not recorded · Site not recorded");
});
