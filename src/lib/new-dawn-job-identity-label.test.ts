import assert from "node:assert/strict";
import test from "node:test";
import { jobSourceIdentity } from "./new-dawn-job-identity-label.ts";

test("unreviewed source names never imply a confirmed OpenFolk customer or site", () => {
  const label = jobSourceIdentity({
    source_customer: "Example Ltd", source_site: "1 Example Road",
    source_postcode: "AB1 2CD", identity_state: "awaiting_review",
  });
  assert.equal(label.sourceLabel, "Example Ltd · 1 Example Road");
  assert.equal(label.shortEvidence, "Customer and site still to confirm");
  assert.match(label.detailEvidence, /from Commusoft/);
  assert.match(label.detailEvidence, /not yet been confirmed/);
});

test("a reviewed job link does not certify separate customer or site matches", () => {
  const reviewed = jobSourceIdentity({
    source_customer: "Example Ltd", source_site: null,
    source_postcode: "AB1 2CD", identity_state: "reviewed_link",
  });
  assert.equal(reviewed.sourceLabel, "Example Ltd · AB1 2CD");
  assert.equal(reviewed.shortEvidence, null);
  assert.match(reviewed.detailEvidence, /reviewed job link/);
  assert.match(reviewed.detailEvidence, /check whether the customer and site match is confirmed/);
  const missing = jobSourceIdentity({
    source_customer: null, source_site: null,
    source_postcode: null, identity_state: "awaiting_review",
  });
  assert.equal(missing.sourceLabel, "Customer not recorded · Site not recorded");
});
