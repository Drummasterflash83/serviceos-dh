import assert from "node:assert/strict";
import { test } from "node:test";
import { handleLearnObservation } from "./learn_observation.ts";
import { buildObservationDraft } from "../observation_ingest.ts";
import { shouldCreateIntelligence } from "../intelligence/eligibility.ts";
const id = (n: number) => `ae256482-aaaa-4000-8000-${String(n).padStart(12, "0")}`;
const work = {
  version: "learn-slack-work-context/1",
  state: "reviewed",
  scope: "company",
  job_id: null,
  request_id: id(5),
  reviewed_by: id(6),
  reviewed_at: "2026-10-12T12:00:00Z",
  source_version: "revision",
};
export const interaction: any = {
  id: id(1),
  tenant_id: id(2),
  processing_status: "enriched",
  source_type: "chat",
  direction: "unknown",
  subject: "Technical newsletter shared by the team",
  updated_at: "2026-10-12T12:00:00Z",
  related_person_id: null,
  related_company_id: null,
  metadata: { source_version: "revision", work_context: work },
};
export const draft = buildObservationDraft({
  tenantId: id(2),
  interaction,
  customerCardContext: null,
  graphNodeRefs: [],
  mapperVersion: "obs-ingest/2",
  domain: "core",
});
function fixture(options: any = {}) {
  const calls: any[] = [];
  let result: any = null;
  let saved: any = null;
  let inspected = 0;
  const db: any = {
    from(table: string) {
      const chain: any = {};
      for (const m of ["select", "eq", "or", "in", "maybeSingle"]) chain[m] = () => chain;
      chain.then = (resolve: any, reject: any) =>
        Promise.resolve(
          options.failRead
            ? { data: null, error: { message: "PRIVATE" } }
            : { data: table === "tenants" ? { industry: null } : [], error: null },
        ).then(resolve, reject);
      return chain;
    },
    async rpc(name: string, args: any) {
      calls.push({ name, args });
      assert.equal(name, "learn_observation_deliver");
      if (args.p_result) {
        result = args.p_result;
        saved = {
          version: "learn-observation-delivery/1",
          state: "committed",
          tenant_id: id(2),
          job_id: id(3),
          interaction_id: id(1),
          observation_id: result.object.id,
          decision_id: result.package.id,
          can_execute: false,
          action_ids: [],
          graph_nodes: 1,
        };
        if (options.failWrite) {
          saved = null;
          return { data: null, error: { message: "PRIVATE" } };
        }
        return options.loseReply
          ? { data: null, error: { message: "lost response" } }
          : { data: saved, error: null };
      }
      inspected++;
      return {
        data: saved ?? {
          version: "learn-observation-delivery/1",
          state: "pending",
          tenant_id: id(2),
          job_id: id(3),
        },
        error: null,
      };
    },
  };
  return {
    calls,
    run: () =>
      handleLearnObservation({
        supabaseAdmin: db,
        tenantId: id(2),
        jobId: id(3),
        claim: { claimedBy: "fixture", attemptCount: 1 },
        payload: { observation: draft },
      }),
    get result() {
      return result;
    },
  };
}
test("reviewed technical context survives keyword filtering without inventing inbound direction", () => {
  assert.equal(shouldCreateIntelligence(interaction).reason, "reviewed_work_context");
  assert.equal(draft.attributes.direction, "unknown");
  assert.match(draft.subject, /Direction unknown/);
  assert.deepEqual(draft.attributes.work_context, work);
  assert.equal((draft.attributes.resolution as any).person_id, null);
});
test("stale or mismatched job context cannot bypass filtering", () => {
  for (const patch of [
    { state: "source_changed" },
    { source_version: "stale" },
    { scope: "job", job_id: id(8) },
  ])
    assert.equal(
      shouldCreateIntelligence({
        ...interaction,
        metadata: { ...interaction.metadata, work_context: { ...work, ...patch } },
      }).reason,
      "marketing",
    );
});
test("atomic observe-only result uses real decision engine and a single publication", async () => {
  const f = fixture();
  assert.equal((await f.run()).success, true);
  assert.equal(f.result.operational.can_execute, false);
  assert.equal(f.result.operational.blocked_reason, "mode_observe_only");
  assert.equal(f.calls.filter((x) => x.args.p_result).length, 1);
});
test("lost acknowledgement recovers receipt; repeating the job does not republish", async () => {
  const f = fixture({ loseReply: true });
  assert.equal((await f.run()).success, true);
  assert.equal((await f.run()).success, true);
  assert.equal(f.calls.filter((x) => x.args.p_result).length, 1);
});
test("context reads and failed publication never report success or expose content", async () => {
  for (const options of [{ failRead: true }, { failWrite: true }]) {
    const r = await fixture(options).run();
    assert.equal(r.success, false);
    assert.ok(!JSON.stringify(r).includes("PRIVATE"));
  }
});
if (process.env.LEARN_WRITE_SYNTHETIC_FIXTURE === "1") {
  const { writeFileSync } = await import("node:fs");
  const f = fixture();
  await f.run();
  writeFileSync(
    ".verification-results/learn-observation-synthetic-fixture.json",
    JSON.stringify({ draft, result: f.result }),
    { mode: 0o600 },
  );
}
