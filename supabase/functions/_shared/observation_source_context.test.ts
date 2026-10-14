import assert from "node:assert/strict";
import { test } from "node:test";
import { retainedSourceContext } from "./observation_source_context.ts";
const proof = {
  version: "learn-retained-source-context/1" as const,
  tenant_id: "tenant",
  interaction_id: "interaction",
  source_id: "source",
  source_version: "a".repeat(64),
  interaction_updated_at: "2026-10-14T06:00:00.123456Z",
  scope: "company_source" as const,
  attribution: "unresolved" as const,
};
const row = {
  id: "interaction",
  tenant_id: "tenant",
  source_id: "source",
  metadata: { source_version: "a".repeat(64) },
  updated_at: "2026-10-14T06:00:00.123456+00:00",
  retainedSourceContext: proof,
};
test("UTC proof preserves PostgreSQL microseconds and equivalent zero padding", () => {
  assert.equal(retainedSourceContext(row), proof);
  assert.equal(retainedSourceContext({ ...row, updated_at: "2026-10-14T06:00:00.123455Z" }), null);
  assert.ok(
    retainedSourceContext({
      ...row,
      updated_at: "2026-10-14T06:00:00.123000Z",
      retainedSourceContext: { ...proof, interaction_updated_at: "2026-10-14T06:00:00.123+00:00" },
    }),
  );
});
for (const change of [
  { retainedSourceContext: null },
  { tenant_id: "foreign" },
  { id: "foreign" },
  { source_id: "foreign" },
  { metadata: {} },
  { updated_at: "invalid" },
  { updated_at: "2026-10-14T07:00:00.123456+01:00" },
  { related_person_id: "person" },
  { related_company_id: "company" },
  { related_job_id: "job" },
  { retainedSourceContext: { ...proof, attribution: "resolved" } },
  { retainedSourceContext: { ...proof, interaction_updated_at: "invalid" } },
])
  test("rejects missing, changed or attributed binding: " + JSON.stringify(change), () => {
    assert.equal(retainedSourceContext({ ...row, ...change } as any), null);
  });
