// Synthetic browser scenarios only; no provider or database access.
import { handoffRows, persistWorkFixture, selectedPolicy } from "./card-fixture";
import { WORK_COLLECTORS, type WorkCollectionKind } from "../../src/lib/learn-work-collection";
const params = new URLSearchParams(location.search);
const scenario = params.get("collection") ?? "complete";
const key = "serviceos:synthetic:collection:1:" + scenario;
const runs: Record<string, any> = JSON.parse(sessionStorage.getItem(key) ?? "{}");
const persist = () => sessionStorage.setItem(key, JSON.stringify(runs));
const actorId = "22222222-2222-4222-8222-222222222222";
const objectId = (n: number) => `99999999-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = (a: any) =>
  JSON.stringify(
    [
      "p_tenant",
      "p_kind",
      "p_subject",
      "p_policy",
      "p_revision",
      "p_start",
      "p_end",
      "p_request",
      "p_reason",
    ].map((k) => a[k]),
  );
const ok = (data: any) => ({ data: structuredClone(data), error: null });
const fail = (code = "PT409") => ({ data: null, error: { code } });
export function workCollectionFixture(name: string, args: any): Promise<any> | null {
  if (!name.startsWith("learn_work_collection_")) return null;
  return run(name, args);
}
async function run(name: string, a: any) {
  let r = runs[a.p_request];
  if (r && r.progress.tenantId !== a.p_tenant) return fail("42501");
  if (name.endsWith("_begin") || name.endsWith("_abandon")) {
    if (r && r.identity !== identity(a)) return fail();
    if (!r) {
      const abandoned = name.endsWith("_abandon");
      r = runs[a.p_request] = {
        identity: identity(a),
        policy: structuredClone(selectedPolicy()),
        failures: {},
        progress: {
          contract: "work-collection@1",
          tenantId: a.p_tenant,
          actorId,
          requestId: a.p_request,
          kind: a.p_kind,
          subjectId: a.p_subject,
          policyId: a.p_policy,
          policyVersion: a.p_revision,
          period: { start: a.p_start, end: a.p_end },
          state: abandoned ? "abandoned" : "collecting",
          population: abandoned ? 0 : 250,
          processed: 0,
          eligible: 0,
          covered: 0,
          snapshotAt: new Date().toISOString(),
          measurementId: null,
          endReason: abandoned ? a.p_end_reason : null,
        },
      };
      persist();
    }
  }
  if (!r) return fail("P0002");
  const p = r.progress;
  const spec = WORK_COLLECTORS[p.kind as WorkCollectionKind];
  const partial = scenario === "partial" || params.get(p.kind) === "partial";
  if (name.endsWith("_begin")) {
    if (scenario === "lost-start" && !r.failures.start) {
      r.failures.start = true;
      persist();
      return fail("synthetic_lost_reply");
    }
    return ok(p);
  }
  if (name.endsWith("_status")) return ok(p);
  if (name.endsWith("_abandon")) {
    if (p.state === "collecting") {
      p.state = "abandoned";
      p.endReason = a.p_end_reason;
      persist();
    }
    return p.state === "abandoned" && p.endReason !== a.p_end_reason ? fail() : ok(p);
  }
  if (name.endsWith("_step")) {
    await new Promise((resolve) => setTimeout(resolve, scenario === "slow" ? 1800 : 180));
    if (a.p_after > p.processed) return fail();
    if (p.state === "collecting" && a.p_after === p.processed) {
      p.processed = Math.min(p.population, p.processed + 100);
      p.eligible = p.processed;
      p.covered = p.processed - (partial && p.processed === 250 ? 1 : 0);
      if (p.processed === p.population) {
        p.state = "completed";
        p.measurementId = p.requestId;
        if (!handoffRows.some((row) => row.id === p.requestId)) {
          handoffRows.push({
            id: p.requestId,
            tenant_id: p.tenantId,
            subject_kind: spec.subjectKind,
            subject_id: p.subjectId,
            policy_id: p.policyId,
            policy_revision: p.policyVersion,
            metric_key: spec.metric,
            value: partial ? null : p.kind === "handoffs" ? 2 : 120,
            unit: spec.unit,
            window_start: p.period.start,
            window_end: p.period.end,
            measured_at: new Date().toISOString(),
            source: spec.source,
            source_through: partial ? null : p.snapshotAt,
            sample_count: p.covered,
            covered_count: p.covered,
            eligible_count: p.eligible,
            review_state: "inferred",
            evidence: [{ table: "learn_work_collection_runs", id: p.requestId }],
            exclusions: [],
            supersedes: null,
            group_ids: [],
          });
          persistWorkFixture();
        }
      }
      persist();
      if (scenario === "lost-step" && !r.failures.step) {
        r.failures.step = true;
        persist();
        return fail("synthetic_lost_reply");
      }
    }
    return ok(p);
  }
  if (name.endsWith("_evidence")) {
    if (p.state !== "completed") return fail();
    const base = {
      contract: "work-collection-evidence@1",
      tenantId: p.tenantId,
      runId: p.requestId,
      part: a.p_part,
    };
    if (a.p_part === "overview")
      return ok({
        ...base,
        policy: r.policy,
        subject: { kind: spec.subjectKind, id: p.subjectId },
        period: p.period,
        sourceSystem: spec.source,
        metricKey: spec.metric,
        observedAt: p.snapshotAt,
        explanation: partial
          ? "Synthetic incomplete history: the value is withheld."
          : "Synthetic retained calculation: all 250 items covered. Human review remains separate.",
        proof: {
          contract: "work-collection@1",
          runId: p.requestId,
          kind: p.kind,
          snapshotAt: p.snapshotAt,
          itemCount: p.population,
          populationCount: p.population,
          processed: p.processed,
          eligibleItems: p.eligible,
          coveredItems: p.covered,
          value: partial ? null : p.kind === "handoffs" ? 2 : 120,
        },
      });
    if (a.p_part === "items") {
      if (scenario === "paging-error" && a.p_after === 100 && !r.failures.page) {
        r.failures.page = true;
        persist();
        return fail("synthetic_read_failure");
      }
      const end = Math.min(p.population, a.p_after + 100);
      return ok({
        ...base,
        population: p.population,
        after: a.p_after,
        next: end === p.population ? null : end,
        items: Array.from({ length: end - a.p_after }, (_, i) => {
          const ordinal = a.p_after + i + 1,
            id = objectId(ordinal);
          return {
            ordinal,
            object_id: id,
            head_sequence: "9007199254740993",
            head_reconciled: true,
            result: {
              objectId: id,
              eligible: true,
              complete: !(partial && ordinal === 250),
              knownValue: p.kind === "handoffs" ? (ordinal <= 2 ? 1 : 0) : 0.48,
              eventIds: [objectId(1000 + ordinal)],
              credited: [{ synthetic: true, minutes: 0.48 }],
            },
          };
        }),
      });
    }
    return ok({
      ...base,
      snapshotAt: p.snapshotAt,
      data:
        a.p_part === "membership"
          ? {
              contract: "member-capture@1",
              tenantId: p.tenantId,
              members: [{ synthetic: true, id: p.subjectId }],
            }
          : [{ synthetic: true, id: objectId(2000), name: "Synthetic frozen team" }],
    });
  }
  return fail();
}
