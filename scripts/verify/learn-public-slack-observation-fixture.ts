/** Synthetic fixture generated through the real pure mapper and observe-only handler. */
import assert from "node:assert/strict";
import { buildObservationDraft } from "../../supabase/functions/_shared/observation_ingest.ts";
import { handleLearnObservation } from "../../supabase/functions/_shared/worker_handlers/learn_observation.ts";
const id = (n: number) => `caa14000-aaaa-4000-8000-${String(n).padStart(12, "0")}`;
const sourceVersion = "cefc6c4cc7177e136b4fead773f59106c87304ae2c1b83717fec85a8221824c6";
const proof = {
  version: "learn-retained-source-context/1" as const,
  tenant_id: id(1),
  interaction_id: id(501),
  source_id: id(101),
  source_version: sourceVersion,
  interaction_updated_at: "2026-10-14T06:00:00.123456+00:00",
  scope: "company_source" as const,
  attribution: "unresolved" as const,
};
const draft = buildObservationDraft({
  tenantId: id(1),
  mapperVersion: "obs-ingest/2",
  domain: "core",
  customerCardContext: null,
  graphNodeRefs: [],
  interaction: {
    id: id(501),
    tenant_id: id(1),
    source_type: "chat",
    source_connector_id: "slack",
    source_table: "slack_messages",
    source_id: id(101),
    source_external_id: "TTEST:CTEST:1649347022.123456",
    interaction_type: "slack_message",
    direction: "unknown",
    processing_status: "identity_review",
    occurred_at: "2026-10-14T06:00:01Z",
    subject: null,
    summary: null,
    body_preview: "Synthetic historical request",
    from_name: null,
    from_address: null,
    sentiment: null,
    priority: null,
    related_person_id: null,
    related_company_id: null,
    related_job_id: null,
    metadata: { source_version: sourceVersion },
    updated_at: proof.interaction_updated_at,
    retainedSourceContext: proof,
  },
});
let result: any = null;
const db: any = {
  from(table: string) {
    const chain: any = {};
    for (const m of ["select", "eq", "or", "in", "maybeSingle"]) chain[m] = () => chain;
    chain.then = (resolve: any) =>
      Promise.resolve({ data: table === "tenants" ? { industry: null } : [], error: null }).then(
        resolve,
      );
    return chain;
  },
  async rpc(name: string, args: any) {
    assert.equal(name, "learn_observation_deliver");
    if (!args.p_result)
      return { data: { state: "pending", tenant_id: id(1), job_id: id(900) }, error: null };
    result = args.p_result;
    return {
      data: {
        version: "learn-observation-delivery/1",
        state: "committed",
        tenant_id: id(1),
        job_id: id(900),
        interaction_id: id(501),
        observation_id: result.object.id,
        decision_id: result.package.id,
        can_execute: false,
        action_ids: [],
        graph_nodes: 1,
      },
      error: null,
    };
  },
};
const outcome = await handleLearnObservation({
  supabaseAdmin: db,
  tenantId: id(1),
  jobId: id(900),
  claim: { claimedBy: "fixture", attemptCount: 1 },
  payload: { observation: draft },
});
assert.equal(outcome.success, true);
assert.equal(result.operational.can_execute, false);
assert.equal(draft.attributes.work_context, null);
assert.equal(draft.attributes.customer_context, null);
console.log(JSON.stringify({ draft, result }));
