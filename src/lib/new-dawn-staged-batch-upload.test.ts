import test from "node:test";
import assert from "node:assert/strict";
import { reviewStagedBatchUpload } from "./new-dawn-staged-batch-upload.ts";

const tenant = "00000000-0000-4000-8000-000000000001";
const manifest = {
  batch_id: "00000000-0000-4000-8000-000000000002", tenant_id: tenant,
  connection_id: "00000000-0000-4000-8000-000000000003",
  kind_map: { 2: "company" }, kind_evidence_sha256: "a".repeat(64),
  reason: "Reviewed synthetic company source",
  items: ["customer", "site", "job"].map((kind) => ({ kind,
    source_version_id: "00000000-0000-4000-8000-000000000004" })),
};
const map = { kind_map: { 2: "company" }, kind_evidence_sha256: "a".repeat(64),
  status: "reviewed_for_registration" };

test("only an exact reviewed company manifest for the chosen tenant can register", () => {
  assert.deepEqual(reviewStagedBatchUpload(manifest, map, tenant)?.jobs, 1);
  assert.equal(reviewStagedBatchUpload(manifest, { ...map,
    status: "provisional_not_apply_authorized" }, tenant), null);
  assert.equal(reviewStagedBatchUpload(manifest, map,
    "00000000-0000-4000-8000-000000000099"), null);
  assert.equal(reviewStagedBatchUpload({ ...manifest, kind_map: { 2: "person" } }, map, tenant), null);
  assert.equal(reviewStagedBatchUpload({ ...manifest,
    items: [...manifest.items].reverse() }, map, tenant), null);
  assert.equal(reviewStagedBatchUpload({ ...manifest,
    kind_evidence_sha256: "b".repeat(64) }, map, tenant), null);
});
