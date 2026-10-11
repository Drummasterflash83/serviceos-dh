import { workHistoryFixture } from "./work-history-fixture";
import { normalizeDelayPayload, type DelayEntry } from "../../src/lib/learn-work-delays";
type State = {
  entries: DelayEntry[];
  requests: Record<string, { payload: any; state: "recorded" | "cancelled"; recordedAt: string }>;
  proofs: Record<string, any>;
  captures: Record<string, any>;
  faults: string[];
  seeded: boolean;
};
const actor = "22222222-2222-4222-8222-222222222222";
const at = (value: string) => Date.parse(value);
export function workDelayFixture(name: string, args: any): any {
  const params = new URLSearchParams(location.search),
    scenario = params.get("delay");
  if (!scenario || !(name.startsWith("learn_work_delay_") || name === "learn_work_history_read"))
    return null;
  if (scenario === "viewer") return { data: null, error: { code: "42501" } };
  const key = `serviceos:synthetic:delay:${scenario}`;
  const state: State = JSON.parse(
    sessionStorage.getItem(key) ??
      '{"entries":[],"requests":{},"proofs":{},"captures":{},"faults":[],"seeded":false}',
  );
  const save = () => sessionStorage.setItem(key, JSON.stringify(state));
  const ok = (data: any) => ({ data, error: null });
  const error = (code = "PT409") => ({ data: null, error: { code } });
  const fault = (key: string) => {
    if (state.faults.includes(key)) return false;
    state.faults.push(key);
    save();
    return true;
  };
  const stamp = () =>
    new Date(Math.max(Date.now(), ...state.entries.map((e) => at(e.recordedAt) + 1))).toISOString();
  if (name === "learn_work_history_read") {
    if (scenario === "source-error") return error("synthetic_source_unavailable");
    const result = workHistoryFixture(args);
    if (result.data) {
      state.captures[args.p_object] = result.data;
      save();
    }
    return result;
  }
  const objectId = args.p_object ?? args.p_payload?.objectId;
  if (["many", "page-error"].includes(scenario) && !state.seeded) {
    const end = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").toISOString(),
      start = new Date(at(end) - 86400000).toISOString();
    for (let i = 0; i < 105; i++)
      state.entries.push({
        id: `de1a0000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        tenantId: args.p_tenant,
        objectId,
        revision: i + 1,
        decision: "approve",
        approvalId: null,
        period: { start, end },
        label: `Synthetic approval ${i + 1}`,
        reason: "Synthetic pagination acceptance",
        evidenceIds: ["00000000-0000-4000-8000-000000000090"],
        recordedBy: actor,
        recordedAt: new Date(at(end) + 1000 + i).toISOString(),
      });
    state.entries.push({
      ...state.entries[0],
      id: "de1a0000-0000-4000-8000-000000000106",
      revision: 106,
      decision: "reverse",
      approvalId: state.entries[0].id,
      evidenceIds: [],
      reason: "Reversal retained beyond the first 100 decisions",
      recordedAt: new Date(at(end) + 2000).toISOString(),
    });
    state.seeded = true;
    save();
  }
  if (name === "learn_work_delay_read") {
    if (scenario === "read-error") return error("synthetic_read_unavailable");
    if (scenario === "page-error" && args.p_after === 100 && fault("page"))
      return error("synthetic_page_unavailable");
    const rows = state.entries.filter((e) => e.objectId === objectId),
      head = args.p_through ?? rows.length;
    const entries = rows
        .filter((e) => e.revision > args.p_after && e.revision <= head)
        .slice(0, 100),
      next = entries.at(-1)?.revision ?? args.p_after;
    return ok({
      contract: "work-delay-page@1",
      tenantId: args.p_tenant,
      objectId,
      after: args.p_after,
      through: head,
      next,
      hasMore: next < head,
      entries,
    });
  }
  if (name === "learn_work_delay_evidence") {
    if (scenario === "proof-error" && fault("proof")) return error("synthetic_proof_unavailable");
    const approval = state.entries.find(
        (e) => e.id === args.p_approval && e.objectId === objectId && e.decision === "approve",
      ),
      capture = state.proofs[args.p_approval];
    return approval && capture
      ? ok({
          contract: "work-delay-evidence@1",
          tenantId: args.p_tenant,
          objectId,
          approval,
          capture,
        })
      : error("22023");
  }
  const p = normalizeDelayPayload(args.p_payload),
    retained = state.requests[args.p_request];
  if (retained && JSON.stringify(retained.payload) !== JSON.stringify(p)) return error();
  if (name === "learn_work_delay_resolve") {
    if (!retained && args.p_cancel) {
      state.requests[args.p_request] = { payload: p, state: "cancelled", recordedAt: stamp() };
      save();
    }
    const request = state.requests[args.p_request];
    return ok({
      contract: "work-delay-resolution@1",
      tenantId: args.p_tenant,
      actorId: actor,
      requestId: args.p_request,
      payload: p,
      state: request?.state ?? "pending",
      recordedAt: request?.recordedAt ?? null,
    });
  }
  if (name !== "learn_work_delay_record") return error("unsupported");
  if (retained?.state === "cancelled") return error();
  if (retained)
    return ok({
      contract: "work-delay-record@1",
      entry: state.entries.find((e) => e.id === args.p_request),
    });
  if (scenario === "lost-before-approve" && fault("before")) return error("synthetic_lost_reply");
  const rows = state.entries.filter((e) => e.objectId === objectId);
  if (rows.length !== p.expectedRevision) return error();
  let entry: DelayEntry;
  if (p.decision === "approve") {
    const capture = state.captures[objectId];
    if (
      !capture ||
      !capture.coverageStart ||
      at(p.period.start) < at(capture.coverageStart) ||
      at(p.period.end) > at(capture.period.end)
    )
      return error("22023");
    const previous = capture.events
      .filter((e: any) => at(e.occurredAt) < at(p.period.start))
      .at(-1);
    const events = capture.events.filter(
      (e: any) =>
        e.id === previous?.id ||
        (at(e.occurredAt) >= at(p.period.start) && at(e.occurredAt) <= at(p.period.end)),
    );
    if (p.evidenceIds.some((id) => !events.some((e: any) => e.id === id))) return error("22023");
    const observedAt = new Date().toISOString();
    state.proofs[args.p_request] = {
      ...capture,
      period: p.period,
      observedAt,
      sourceThrough: observedAt,
      count: events.length,
      events,
    };
    entry = {
      id: args.p_request,
      tenantId: args.p_tenant,
      objectId,
      revision: p.expectedRevision + 1,
      decision: "approve",
      approvalId: null,
      period: p.period,
      label: p.label,
      reason: p.reason,
      evidenceIds: p.evidenceIds,
      recordedBy: actor,
      recordedAt: stamp(),
    };
  } else {
    const original = rows.find((e) => e.id === p.approvalId && e.decision === "approve");
    if (!original || rows.some((e) => e.approvalId === p.approvalId)) return error();
    entry = {
      ...original,
      id: args.p_request,
      revision: p.expectedRevision + 1,
      decision: "reverse",
      approvalId: p.approvalId,
      reason: p.reason,
      evidenceIds: [],
      recordedBy: actor,
      recordedAt: stamp(),
    };
  }
  state.entries.push(entry);
  state.requests[args.p_request] = { payload: p, state: "recorded", recordedAt: entry.recordedAt };
  save();
  if (scenario === `lost-${p.decision}` && fault(p.decision)) return error("synthetic_lost_reply");
  return ok({ contract: "work-delay-record@1", entry });
}
