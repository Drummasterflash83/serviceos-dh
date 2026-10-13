// Run: node --test supabase/functions/_shared/controlplane/comm_relevance.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapReason, recordedVerdicts, gatherCommunicationRelevance } from "./comm_relevance.ts";

test("noise reasons map to not_relevant classes", () => {
  assert.deepEqual(mapReason("marketing").relevance, "not_relevant");
  assert.equal(mapReason("marketing").commClass, "marketing_newsletter");
  assert.equal(mapReason("automated_notification").commClass, "system_notification");
  assert.equal(mapReason("automated_notification").relevance, "not_relevant");
  assert.equal(mapReason("outbound_no_signal").commClass, "internal");
  assert.equal(mapReason("outbound_no_signal").relevance, "not_relevant");
  assert.equal(mapReason("empty").commClass, "spam_noise");
});

test("operational reasons map to relevant customer/supplier classes", () => {
  assert.equal(mapReason("customer_risk").commClass, "operational_customer");
  assert.equal(mapReason("customer_risk").relevance, "relevant");
  assert.equal(mapReason("sales_opportunity").commClass, "operational_customer");
  assert.equal(mapReason("supplier_risk").commClass, "supplier_vendor");
});

test("customer context does not establish an actionable issue", () => {
  const v = mapReason("customer_context");
  assert.equal(v.commClass, "operational_customer");
  assert.equal(v.relevance, "relevant");
  assert.match(v.note ?? "", /actionable/i);
});

test("unknown/absent reason is uncertain, never asserted as a customer relationship", () => {
  assert.equal(mapReason(null).commClass, "unknown");
  assert.equal(mapReason(null).relevance, "uncertain");
  assert.equal(mapReason("unclassified_inbound").commClass, "unknown");
});

test("multiple mapper decisions count once; conflicting history is uncertain", () => {
  const result = recordedVerdicts([
    { interaction_id: "a", eligibility_reason: "marketing" },
    { interaction_id: "a", eligibility_reason: "marketing" },
    { interaction_id: "b", eligibility_reason: "marketing" },
    { interaction_id: "b", eligibility_reason: "customer_risk" },
    { interaction_id: "c", eligibility_reason: "reviewed_work_context" },
  ]);
  assert.equal(result.length, 3);
  assert.equal(result[0].verdict.relevance, "not_relevant");
  assert.equal(result[1].verdict.relevance, "uncertain");
  assert.equal(result[1].conflict, true);
  assert.equal(result[2].verdict.commClass, "reviewed_work");
  assert.throws(() => recordedVerdicts([{ interaction_id: null }]), /lineage/);
});

const id = (n: number) => String(n).padStart(8, "0");
function database(
  rows: Record<string, any[]>,
  fault?: (table: string, cursor: string | null, result: any) => any,
) {
  const requests: { table: string; tenant: string; cursor: string | null }[] = [];
  return {
    requests,
    from(table: string) {
      let tenant = "",
        cursor: string | null = null,
        limit = 0;
      const q = {
        select(_cols: string, options: unknown) {
          assert.deepEqual(options, { count: "exact" });
          return q;
        },
        eq(k: string, value: string) {
          assert.equal(k, "tenant_id");
          tenant = value;
          return q;
        },
        order(k: string, options: unknown) {
          assert.equal(k, "id");
          assert.deepEqual(options, { ascending: true });
          return q;
        },
        limit(n: number) {
          limit = n;
          return q;
        },
        gt(k: string, value: string) {
          assert.equal(k, "id");
          cursor = value;
          return q;
        },
        then(resolve: (r: any) => unknown) {
          requests.push({ table, tenant, cursor });
          const rest = (rows[table] ?? []).filter(
            (r) => r.tenant_id === tenant && (!cursor || r.id > cursor),
          );
          const result = { data: rest.slice(0, limit), count: rest.length, error: null };
          return Promise.resolve(fault ? fault(table, cursor, result) : result).then(resolve);
        },
      };
      return q;
    },
  };
}
const row = (n: number, fields = {}) => ({ id: id(n), tenant_id: "tenant", ...fields });
test("complete ordered pages retain distinct counts and conservative exclusion estimates", async () => {
  const rows = Array.from({ length: 1001 }, (_, n) =>
    row(n, { interaction_id: "i" + n, eligibility_reason: "marketing" }),
  );
  rows.push(row(1001, { interaction_id: "i0", eligibility_reason: "customer_risk" }));
  const db = database({
    intelligence_ingestions: [
      ...rows,
      { ...row(9999), tenant_id: "another", interaction_id: "other" },
    ],
    intelligence_objects: [
      row(1, { source_interactions: ["i0"] }),
      row(2, { source_interactions: ["i1"] }),
      row(3, { source_interactions: ["i1", "unclassified"] }),
    ],
    recommendations: [
      row(1, { interaction_id: "i0", status: "open" }),
      row(2, { interaction_id: "i1", status: "open" }),
    ],
  });
  const report = await gatherCommunicationRelevance(db as any, "tenant", "2026-10-13T00:00:00Z");
  assert.equal(report.totalCommunications, 1001);
  assert.equal(report.ledgerRecords, 1002);
  assert.equal(report.conflictingCommunications, 1);
  assert.equal(report.reprocessedCommunications, 1);
  assert.equal(report.byRelevance.uncertain, 1);
  assert.deepEqual(report.exclusion, {
    noiseInteractions: 1000,
    intelligenceObjectsExcluded: 1,
    recommendationsExcluded: 1,
    recommendationsOpenExcluded: 1,
  });
  assert.equal(db.requests.filter((r) => r.table === "intelligence_ingestions").length, 2);
  assert.ok(db.requests.every((r) => r.tenant === "tenant"));
});
test("errors, capped pages, inconsistent counts and unsafe order never return partial totals", async () => {
  const rows = Array.from({ length: 1001 }, (_, n) => row(n, { interaction_id: "i" + n }));
  for (const fault of [
    (_t: string, cursor: string | null, r: any) => (cursor ? { ...r, error: true } : r),
    (_t: string, _c: string | null, r: any) => ({ ...r, data: r.data.slice(0, 500) }),
    (_t: string, cursor: string | null, r: any) => (cursor ? { ...r, count: 2 } : r),
    (_t: string, _c: string | null, r: any) => ({ ...r, count: 100001 }),
    (_t: string, _c: string | null, r: any) => ({ ...r, data: [...r.data].reverse() }),
  ]) {
    const db = database({ intelligence_ingestions: rows }, (t, c, r) =>
      t === "intelligence_ingestions" ? fault(t, c, r) : r,
    );
    await assert.rejects(
      gatherCommunicationRelevance(db as any, "tenant", "2026-10-13T00:00:00Z"),
      /relevance/,
    );
  }
});
