import assert from "node:assert/strict";
import { test } from "node:test";
import { handleIntelligenceIngest } from "./intelligence_ingest.ts";

const tenant = "00000000-0000-4000-8000-000000000001";
const id = "00000000-0000-4000-8000-000000000002";
const person = "00000000-0000-4000-8000-000000000003";
const row = {
  id,
  tenant_id: tenant,
  processing_status: "enriched",
  direction: "inbound",
  source_type: "email",
  subject: "The heating is broken again",
  related_person_id: person,
};
const failure = { data: null, error: { code: "XX000", message: "PRIVATE SOURCE VALUE" } };
function fixture(options: Record<string, any> = {}) {
  const queries: any[] = [];
  let savedJob: string | null = options.savedJob ?? null;
  let ledger: any = options.ledger ?? null;
  let lineageFailures = options.lineageFailures ?? 0;
  const rpcCalls: any[] = [];
  const db = {
    rpc(name: string, args: any) {
      rpcCalls.push({ name, args });
      if (options.proofError) return Promise.resolve(failure);
      const proofs = options.proofs ?? [options.proof ?? null];
      return Promise.resolve({
        data: proofs[Math.min(rpcCalls.length - 1, proofs.length - 1)],
        error: null,
      });
    },
    from(table: string) {
      const q: any = { table, operation: "read", filters: [], single: false };
      const chain: any = {};
      for (const method of [
        "select",
        "eq",
        "in",
        "or",
        "order",
        "limit",
        "insert",
        "update",
        "single",
        "maybeSingle",
      ])
        chain[method] = (...args: any[]) => {
          if (["eq", "in"].includes(method)) q.filters.push([method, ...args]);
          if (["insert", "update"].includes(method)) {
            q.operation = method;
            q.values = args[0];
          }
          if (["single", "maybeSingle"].includes(method)) q.single = true;
          return chain;
        };
      chain.then = (resolve: any, reject: any) =>
        Promise.resolve()
          .then(() => {
            queries.push(q);
            const point = table + "." + q.operation + (q.single ? ".single" : "");
            if (options.fail === point) return failure;
            if (table === "interactions")
              return {
                data: q.single ? (options.row ?? row) : (options.rows ?? [options.row ?? row]),
                error: null,
              };
            if (table === "customer_cards") return { data: null, error: null };
            if (table === "graph_nodes") return { data: [], error: null };
            if (table === "intelligence_ingestions") {
              if (q.operation === "insert") {
                if (ledger) return { data: null, error: { code: "23505" } };
                ledger = { id: "ledger", observe_job_id: null, status: q.values.status };
                return { data: q.single ? ledger : null, error: null };
              }
              if (q.operation === "update") {
                if (lineageFailures-- > 0) return failure;
                ledger = { ...ledger, ...q.values };
                return { data: ledger, error: null };
              }
              return { data: ledger, error: null };
            }
            if (table === "platform_jobs") {
              if (q.operation === "insert") savedJob = "job";
              return { data: savedJob ? { id: savedJob } : null, error: null };
            }
            throw Error("Unexpected table " + table);
          })
          .then(resolve, reject);
      return chain;
    },
  };
  return {
    queries,
    rpcCalls,
    run: (payload: any = { interaction_id: id }) =>
      handleIntelligenceIngest({
        supabaseAdmin: db as any,
        tenantId: tenant,
        jobId: null,
        payload,
      }),
    get ledger() {
      return ledger;
    },
  };
}

test("confirmed hand-off is reported as queued, never completed analysis", async () => {
  const f = fixture(),
    r = await f.run();
  assert.equal(r.success, true);
  assert.equal(r.recordsProcessed, 1);
  assert.equal(r.result?.stage, "observe_job_linked");
  assert.equal(f.ledger.observe_job_id, "job");
  for (const q of f.queries.filter((q) => q.operation === "read" || q.operation === "update"))
    assert.ok(q.filters.some((v: any) => v[0] === "eq" && v[1] === "tenant_id" && v[2] === tenant));
});
for (const fail of [
  "interactions.read",
  "interactions.read.single",
  "customer_cards.read.single",
  "graph_nodes.read",
  "intelligence_ingestions.insert.single",
  "platform_jobs.insert.single",
  "intelligence_ingestions.update.single",
])
  test("does not acknowledge database failure: " + fail, async () => {
    const r = await fixture({ fail }).run();
    assert.equal(r.success, false);
    assert.equal(r.error?.retryable, true);
    assert.ok(!JSON.stringify(r).includes("PRIVATE SOURCE VALUE"));
  });
test("skip audit failure is visible and retryable", async () => {
  const r = await fixture({
    row: { ...row, subject: "newsletter unsubscribe" },
    fail: "intelligence_ingestions.insert",
  }).run();
  assert.equal(r.success, false);
  assert.equal(r.error?.retryable, true);
});
test("preserves an earlier skipped verdict even if current text is eligible", async () => {
  const f = fixture({ ledger: { id: "ledger", status: "skipped", observe_job_id: null } }),
    r = await f.run();
  assert.equal(r.success, true);
  assert.equal(r.result?.skipped, 1);
  assert.equal(r.recordsProcessed, 0);
  assert.ok(!f.queries.some((q) => q.table === "platform_jobs"));
});
test("failed durable job lookup cannot be treated as permission to enqueue again", async () => {
  const f = fixture({
    ledger: { id: "ledger", status: "enqueued", observe_job_id: null },
    fail: "platform_jobs.read.single",
  });
  assert.equal((await f.run()).success, false);
  assert.ok(!f.queries.some((q) => q.table === "platform_jobs" && q.operation === "insert"));
});
test("unknown claim after uniqueness conflict fails closed", async () => {
  const f = fixture({
    ledger: { id: "ledger", status: "enqueued", observe_job_id: null },
    fail: "intelligence_ingestions.read.single",
  });
  assert.equal((await f.run()).success, false);
  assert.ok(!f.queries.some((q) => q.table === "platform_jobs"));
});
test("lineage failure retries by recovering the existing job, without enqueueing another", async () => {
  const f = fixture({ lineageFailures: 1 });
  assert.equal((await f.run()).success, false);
  const r = await f.run();
  assert.equal(r.success, true);
  assert.equal(r.result?.reused, 1);
  assert.equal(
    f.queries.filter((q) => q.table === "platform_jobs" && q.operation === "insert").length,
    1,
  );
  assert.equal(f.ledger.observe_job_id, "job");
});
test("missing or unenriched requested records cannot yield a successful empty batch", async () => {
  const missing = await fixture({ rows: [] }).run();
  assert.equal(missing.success, false);
  assert.equal(missing.error?.retryable, false);
  const pending = await fixture({ row: { ...row, processing_status: "pending" } }).run();
  assert.equal(pending.success, false);
  assert.equal(pending.error?.retryable, true);
});
test("oversized and malformed batches fail before database work", async () => {
  const f = fixture();
  for (const payload of [
    {
      interaction_ids: Array.from(
        { length: 26 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      ),
    },
    { interaction_id: "invalid" },
  ]) {
    assert.equal((await f.run(payload)).error?.code, "invalid_payload");
  }
  assert.equal(f.queries.length, 0);
});

test("an observed ledger missing its job link needs review, never a new observation", async () => {
  const f = fixture({ ledger: { id: "ledger", status: "observed", observe_job_id: null } });
  const r = await f.run();
  assert.equal(r.success, false);
  assert.equal(r.error?.retryable, false);
  assert.ok(!f.queries.some((q) => q.table === "platform_jobs"));
});

const held = {
  ...row,
  processing_status: "identity_review",
  direction: "unknown",
  source_type: "chat",
  source_connector_id: "slack",
  source_table: "slack_messages",
  interaction_type: "slack_message",
  source_id: "00000000-0000-4000-8000-000000000020",
  subject: null,
  body_preview: "The heating is broken again",
  related_person_id: null,
  related_company_id: null,
  related_job_id: null,
  updated_at: "2026-10-14T06:00:00.123456+00:00",
  metadata: { source_version: "a".repeat(64) },
};
const proof = {
  version: "learn-retained-source-context/1",
  tenant_id: tenant,
  interaction_id: id,
  source_id: held.source_id,
  source_version: held.metadata.source_version,
  interaction_updated_at: held.updated_at,
  scope: "company_source",
  attribution: "unresolved",
};
test("verified retained source queues an unresolved observation after two tenant-scoped checks", async () => {
  const before = structuredClone(held),
    f = fixture({ row: held, proof });
  assert.equal((await f.run()).success, true);
  assert.equal(f.rpcCalls.length, 2);
  for (const call of f.rpcCalls)
    assert.deepEqual(call, {
      name: "learn_public_slack_observation_context",
      args: { p_tenant: tenant, p_interaction: id },
    });
  const draft = f.queries.find((q) => q.table === "platform_jobs" && q.operation === "insert")
    .values.payload.observation;
  assert.deepEqual(draft.attributes.retained_source_context, proof);
  assert.deepEqual(draft.attributes.resolution, {
    resolved: false,
    person_id: null,
    company_id: null,
    job_id: null,
  });
  assert.equal(draft.attributes.customer_context, null);
  assert.equal(draft.attributes.direction, "unknown");
  assert.deepEqual(held, before);
  assert.ok(!f.queries.some((q) => q.table === "interactions" && q.operation !== "read"));
  assert.equal((await f.run()).success, true);
  assert.equal(
    f.queries.filter((q) => q.table === "platform_jobs" && q.operation === "insert").length,
    1,
  );
});
for (const options of [
  { proof: null },
  { proofError: true },
  { proof: { ...proof, tenant_id: person } },
  { proof: { ...proof, source_version: "b".repeat(64) } },
  { proof: { ...proof, interaction_updated_at: "2026-10-14T06:00:00.123455Z" } },
  { proofs: [proof, null] },
  { proofs: [proof, { ...proof, source_id: person }] },
])
  test(
    "retained source requires current independent proof: " + JSON.stringify(options),
    async () => {
      const f = fixture({ row: held, ...options });
      assert.equal((await f.run()).success, false);
      assert.equal(f.ledger, null);
      assert.ok(!f.queries.some((q) => q.table === "platform_jobs"));
    },
  );
test("payload, metadata and raw row proof cannot grant eligibility", async () => {
  const f = fixture({
    row: {
      ...held,
      retainedSourceContext: proof,
      metadata: { ...held.metadata, retained_source_context: proof },
    },
  });
  assert.equal((await f.run({ interaction_id: id, retainedSourceContext: proof })).success, false);
  assert.equal(f.ledger, null);
});
test("withdrawn proof cannot create a durable skipped verdict", async () => {
  const f = fixture({
    row: { ...held, body_preview: "newsletter unsubscribe" },
    proofs: [proof, null],
  });
  assert.equal((await f.run()).success, false);
  assert.equal(f.ledger, null);
});
test("public retained source may be audited as skipped only after fresh proof", async () => {
  const f = fixture({ row: { ...held, body_preview: "newsletter unsubscribe" }, proof });
  assert.equal((await f.run()).success, true);
  assert.equal(f.ledger.status, "skipped");
  assert.equal(f.rpcCalls.length, 2);
});
