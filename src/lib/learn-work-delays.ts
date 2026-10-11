import type { TimeWindow } from "./learn-scorecards.ts";
export type DelayClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: any }>;
};
type DelayBase = { objectId: string; expectedRevision: number; reason: string };
export type DelayPayload = DelayBase &
  (
    | {
        decision: "approve";
        approvalId: null;
        period: TimeWindow;
        label: string;
        evidenceIds: string[];
      }
    | { decision: "reverse"; approvalId: string; period: null; label: null; evidenceIds: [] }
  );
export type DelayEntry = {
  id: string;
  tenantId: string;
  objectId: string;
  revision: number;
  decision: "approve" | "reverse";
  approvalId: string | null;
  period: TimeWindow;
  label: string;
  reason: string;
  evidenceIds: string[];
  recordedBy: string;
  recordedAt: string;
};
export type DelayPage = {
  contract: "work-delay-page@1";
  tenantId: string;
  objectId: string;
  after: number;
  through: number;
  next: number;
  hasMore: boolean;
  entries: DelayEntry[];
};
export type DelayResolution = {
  contract: "work-delay-resolution@1";
  tenantId: string;
  actorId: string;
  requestId: string;
  payload: DelayPayload;
  state: "pending" | "recorded" | "cancelled";
  recordedAt: string | null;
};
export const delayUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const bounded = (v: unknown, max: number): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= max;
const revision = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 2147483647;
function keys(v: unknown, names: string[]) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).length !== names.length ||
    Object.keys(v).some((k) => !names.includes(k))
  )
    throw Error("Delay request is incomplete or unsupported.");
}
/** Normalize offsets without discarding PostgreSQL microseconds. */
export function delayStamp(value: unknown): string {
  if (typeof value !== "string") throw Error("Explicit delay timestamp required.");
  const m = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!m) throw Error("Delay timestamps need a date, time and explicit timezone.");
  const [, y, month, d, h, minute, second, fraction = ""] = m;
  if (
    +month < 1 ||
    +month > 12 ||
    +d < 1 ||
    +d > new Date(Date.UTC(+y, +month, 0)).getUTCDate() ||
    +h > 23 ||
    +minute > 59 ||
    +second > 59 ||
    !Number.isFinite(Date.parse(value))
  )
    throw Error("Invalid delay timestamp.");
  return new Date(Date.parse(value))
    .toISOString()
    .replace(/\.(\d{3})Z$/, (_, ms) => `.${ms}${fraction.padEnd(6, "0").slice(3)}Z`);
}
function instant(s: string): bigint {
  const normalized = delayStamp(s);
  return BigInt(Date.parse(normalized)) * 1000n + BigInt(normalized.slice(-4, -1));
}
function period(value: TimeWindow): TimeWindow {
  keys(value, ["start", "end"]);
  const start = delayStamp(value.start),
    end = delayStamp(value.end),
    a = instant(start),
    b = instant(end);
  if (
    b <= a ||
    b - a > 366n * 86400000000n ||
    a < instant("2000-01-01T00:00:00Z") ||
    b > instant("2201-01-01T00:00:00Z")
  )
    throw Error("Choose a delay interval of at most 366 days.");
  return { start, end };
}
function evidence(ids: unknown, approve: boolean): string[] {
  if (
    !Array.isArray(ids) ||
    ids.length < (approve ? 1 : 0) ||
    ids.length > (approve ? 50 : 0) ||
    !ids.every(delayUuid)
  )
    throw Error("Captured work evidence is required.");
  const normalized = ids.map((id) => id.toLowerCase()).sort();
  if (new Set(normalized).size !== normalized.length) throw Error("Duplicate delay evidence.");
  return normalized;
}
export function normalizeDelayPayload(value: DelayPayload): DelayPayload {
  keys(value, [
    "objectId",
    "expectedRevision",
    "decision",
    "approvalId",
    "period",
    "label",
    "evidenceIds",
    "reason",
  ]);
  if (
    !delayUuid(value.objectId) ||
    !revision(value.expectedRevision) ||
    value.expectedRevision >= 2147483647 ||
    !bounded(value.reason, 1000)
  )
    throw Error("Work item, expected revision and reason required.");
  const base = {
    objectId: value.objectId.toLowerCase(),
    expectedRevision: value.expectedRevision,
    reason: value.reason.trim(),
  };
  if (value.decision === "approve") {
    if (value.approvalId !== null || !bounded(value.label, 200))
      throw Error("A delay label and new approval are required.");
    return {
      ...base,
      decision: "approve",
      approvalId: null,
      period: period(value.period),
      label: value.label.trim(),
      evidenceIds: evidence(value.evidenceIds, true),
    };
  }
  if (
    value.decision !== "reverse" ||
    !delayUuid(value.approvalId) ||
    value.period !== null ||
    value.label !== null
  )
    throw Error("Reversal must reference an existing approval.");
  evidence(value.evidenceIds, false);
  return {
    ...base,
    decision: "reverse",
    approvalId: value.approvalId.toLowerCase(),
    period: null,
    label: null,
    evidenceIds: [],
  };
}
export function parseDelayEntry(data: unknown, tenantId: string, objectId: string): DelayEntry {
  const d = data as DelayEntry;
  if (
    !delayUuid(tenantId) ||
    !delayUuid(objectId) ||
    !d ||
    !delayUuid(d.id) ||
    d.tenantId !== tenantId ||
    d.objectId !== objectId ||
    !revision(d.revision) ||
    d.revision < 1 ||
    !["approve", "reverse"].includes(d.decision) ||
    !bounded(d.label, 200) ||
    !bounded(d.reason, 1000) ||
    !delayUuid(d.recordedBy) ||
    (d.decision === "approve"
      ? d.approvalId !== null
      : !delayUuid(d.approvalId) || d.approvalId === d.id)
  )
    throw Error("Delay review entry could not be verified.");
  const window = period(d.period),
    at = delayStamp(d.recordedAt),
    ids = evidence(d.evidenceIds, d.decision === "approve");
  if (instant(window.end) > instant(at))
    throw Error("Delay approval predates the interval it reviews.");
  return { ...d, period: window, recordedAt: at, evidenceIds: ids };
}
export function parseDelayPage(
  data: unknown,
  tenantId: string,
  objectId: string,
  after: number,
  through: number | null,
): DelayPage {
  const d = data as DelayPage;
  if (
    !d ||
    d.contract !== "work-delay-page@1" ||
    !delayUuid(tenantId) ||
    !delayUuid(objectId) ||
    d.tenantId !== tenantId ||
    d.objectId !== objectId ||
    !revision(after) ||
    d.after !== after ||
    !revision(d.through) ||
    (through !== null && d.through !== through) ||
    d.through < after ||
    !Array.isArray(d.entries) ||
    d.entries.length !== Math.min(100, d.through - after) ||
    d.next !== after + d.entries.length ||
    d.hasMore !== d.next < d.through
  )
    throw Error("Complete delay review page could not be verified.");
  const entries = d.entries.map((v) => parseDelayEntry(v, tenantId, objectId));
  if (
    new Set(entries.map((v) => v.id)).size !== entries.length ||
    entries.some(
      (v, i) =>
        v.revision !== after + i + 1 ||
        (i > 0 && instant(v.recordedAt) <= instant(entries[i - 1].recordedAt)),
    )
  )
    throw Error("Delay history contains a gap or changed ordering.");
  return { ...d, entries };
}
function failure(error: any) {
  return Error(
    error?.code === "42501"
      ? "Only a current company owner or admin outside preview can review delays."
      : error?.code === "PT409"
        ? "Delay review history changed or this request already ended. Check the saved request before making another change."
        : "Delay evidence or outcome could not be confirmed. Keep the original request and check again.",
  );
}
export async function readDelayPage(
  db: DelayClient,
  tenantId: string,
  objectId: string,
  after = 0,
  through: number | null = null,
) {
  if (
    !delayUuid(tenantId) ||
    !delayUuid(objectId) ||
    !revision(after) ||
    !(through === null || (revision(through) && through >= after))
  )
    throw Error("Work item and valid delay cursor required.");
  const { data, error } = await db.rpc("learn_work_delay_read", {
    p_tenant: tenantId,
    p_object: objectId,
    p_after: after,
    p_through: through,
  });
  if (error) throw failure(error);
  return parseDelayPage(data, tenantId, objectId, after, through);
}
export async function recordWorkDelay(
  db: DelayClient,
  tenantId: string,
  actorId: string,
  requestId: string,
  payload: DelayPayload,
) {
  if (![tenantId, actorId, requestId].every(delayUuid))
    throw Error("Company, actor and request required.");
  const p = normalizeDelayPayload(payload);
  const { data, error } = await db.rpc("learn_work_delay_record", {
    p_tenant: tenantId,
    p_request: requestId,
    p_payload: p,
  });
  if (error) throw failure(error);
  const entry = parseDelayEntry(data?.entry, tenantId, p.objectId);
  if (
    data.contract !== "work-delay-record@1" ||
    entry.id !== requestId ||
    entry.recordedBy !== actorId ||
    entry.revision !== p.expectedRevision + 1 ||
    entry.decision !== p.decision ||
    entry.approvalId !== p.approvalId ||
    entry.reason !== p.reason ||
    (p.decision === "approve" &&
      (JSON.stringify(entry.period) !== JSON.stringify(p.period) ||
        entry.label !== p.label ||
        JSON.stringify(entry.evidenceIds) !== JSON.stringify(p.evidenceIds)))
  )
    throw Error("Recorded delay differs from the original request.");
  return entry;
}
export async function resolveWorkDelay(
  db: DelayClient,
  tenantId: string,
  actorId: string,
  requestId: string,
  payload: DelayPayload,
  cancel: boolean,
): Promise<DelayResolution> {
  if (![tenantId, actorId, requestId].every(delayUuid))
    throw Error("Company, actor and request required.");
  const p = normalizeDelayPayload(payload);
  const { data: d, error } = await db.rpc("learn_work_delay_resolve", {
    p_tenant: tenantId,
    p_request: requestId,
    p_payload: p,
    p_cancel: cancel,
  });
  if (error) throw failure(error);
  if (
    !d ||
    d.contract !== "work-delay-resolution@1" ||
    d.tenantId !== tenantId ||
    d.actorId !== actorId ||
    d.requestId !== requestId ||
    !["pending", "recorded", "cancelled"].includes(d.state) ||
    (cancel && d.state === "pending") ||
    (d.state === "pending" ? d.recordedAt !== null : !d.recordedAt) ||
    JSON.stringify(normalizeDelayPayload(d.payload)) !== JSON.stringify(p)
  )
    throw Error("Delay request outcome could not be verified. Keep the original request.");
  return { ...d, payload: p, recordedAt: d.recordedAt === null ? null : delayStamp(d.recordedAt) };
}
/** Validate retained capture at its original microsecond precision. The general
 * timeline display rounds to milliseconds and cannot prove sub-millisecond gaps. */
function verifyDelayCapture(capture: any, approval: DelayEntry) {
  const object = (v: any) => !!v && typeof v === "object" && !Array.isArray(v);
  const owner = (v: any) =>
    v === null || (object(v) && bounded(v.kind, 500) && bounded(v.ref, 500));
  const snapshot = (v: any) =>
    object(v) &&
    bounded(v.status, 500) &&
    Number.isSafeInteger(v.version) &&
    v.version > 0 &&
    owner(v.responsible_ref) &&
    owner(v.accountable_ref) &&
    owner(v.waiting_on_ref) &&
    object(v.attributes);
  const canonical = (v: any): string =>
    Array.isArray(v)
      ? "[" + v.map(canonical).join(",") + "]"
      : object(v)
        ? "{" +
          Object.keys(v)
            .sort()
            .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
            .join(",") +
          "}"
        : JSON.stringify(v);
  const start = instant(approval.period.start),
    end = instant(approval.period.end);
  if (
    !capture ||
    capture.contract !== "work-capture@1" ||
    capture.tenantId !== approval.tenantId ||
    capture.objectId !== approval.objectId ||
    !Number.isInteger(capture.count) ||
    capture.count < 1 ||
    capture.count > 1000 ||
    !Array.isArray(capture.events) ||
    capture.events.length !== capture.count ||
    instant(capture.coverageStart) > start ||
    instant(capture.sourceThrough) < end ||
    instant(capture.sourceThrough) > instant(capture.observedAt)
  )
    throw Error("Delay approval lacks complete captured evidence.");
  const seen = new Set<string>();
  let previous: any = null;
  for (const event of capture.events) {
    if (
      !event ||
      !delayUuid(event.id) ||
      seen.has(event.id) ||
      event.tenantId !== approval.tenantId ||
      event.objectId !== approval.objectId ||
      typeof event.sequence !== "string" ||
      !/^[1-9]\d{0,18}$/.test(event.sequence) ||
      BigInt(event.sequence) > 9223372036854775807n ||
      !["insert", "update", "baseline"].includes(event.kind) ||
      !snapshot(event.before) ||
      !snapshot(event.after)
    )
      throw Error("Delay capture contains malformed or repeated evidence.");
    const time = instant(event.occurredAt);
    if (
      time > end ||
      time < instant(capture.coverageStart) ||
      (event.kind !== "update" && canonical(event.before) !== canonical(event.after)) ||
      (!previous && time > start) ||
      (previous &&
        (time < start ||
          time < instant(previous.occurredAt) ||
          BigInt(event.sequence) <= BigInt(previous.sequence) ||
          canonical(previous.after) !== canonical(event.before)))
    )
      throw Error("Delay capture has a missing or disconnected interval.");
    seen.add(event.id);
    previous = event;
  }
  if (approval.evidenceIds.some((id) => !seen.has(id)))
    throw Error("Delay approval lacks its selected source evidence.");
}

export async function readDelayEvidence(
  db: DelayClient,
  tenantId: string,
  objectId: string,
  approvalId: string,
) {
  if (![tenantId, objectId, approvalId].every(delayUuid))
    throw Error("Delay approval scope required.");
  const { data: d, error } = await db.rpc("learn_work_delay_evidence", {
    p_tenant: tenantId,
    p_object: objectId,
    p_approval: approvalId,
  });
  if (error) throw failure(error);
  if (
    !d ||
    d.contract !== "work-delay-evidence@1" ||
    d.tenantId !== tenantId ||
    d.objectId !== objectId
  )
    throw Error("Delay proof scope differs from the selected work.");
  const approval = parseDelayEntry(d.approval, tenantId, objectId);
  if (
    approval.id !== approvalId ||
    approval.decision !== "approve" ||
    JSON.stringify(period(d.capture?.period)) !== JSON.stringify(approval.period) ||
    instant(d.capture?.observedAt) > instant(approval.recordedAt)
  )
    throw Error("Delay proof differs from the original approval.");
  verifyDelayCapture(d.capture, approval);
  return { approval, capture: d.capture };
}
export type DelaySnapshot = {
  contract: "work-delay-snapshot@1";
  tenantId: string;
  objectId: string;
  through: number;
  observedAt: string;
  period: TimeWindow;
  approvals: DelayEntry[];
  windows: TimeWindow[];
};
export function parseDelaySnapshot(
  data: unknown,
  tenantId: string,
  objectId: string,
  expectedPeriod: TimeWindow,
  observedAt: string,
): DelaySnapshot {
  const d = data as DelaySnapshot,
    expected = period(expectedPeriod),
    at = delayStamp(observedAt);
  if (
    !d ||
    d.contract !== "work-delay-snapshot@1" ||
    !delayUuid(tenantId) ||
    !delayUuid(objectId) ||
    d.tenantId !== tenantId ||
    d.objectId !== objectId ||
    !revision(d.through) ||
    JSON.stringify(period(d.period)) !== JSON.stringify(expected) ||
    delayStamp(d.observedAt) !== at ||
    instant(expected.end) > instant(at) ||
    !Array.isArray(d.approvals) ||
    d.approvals.length > 1000 ||
    !Array.isArray(d.windows)
  )
    throw Error("Delay snapshot scope could not be verified.");
  const approvals = d.approvals.map((v) => parseDelayEntry(v, tenantId, objectId));
  if (
    new Set(approvals.map((v) => v.id)).size !== approvals.length ||
    approvals.some(
      (v, i) =>
        v.decision !== "approve" ||
        v.revision > d.through ||
        instant(v.recordedAt) > instant(at) ||
        instant(v.period.start) >= instant(expected.end) ||
        instant(v.period.end) <= instant(expected.start) ||
        (i > 0 && v.revision <= approvals[i - 1].revision),
    )
  )
    throw Error("Delay snapshot contains unrelated or duplicate approvals.");
  const windows: TimeWindow[] = [];
  const clipped = approvals
    .map((v) => ({
      start: instant(v.period.start) < instant(expected.start) ? expected.start : v.period.start,
      end: instant(v.period.end) > instant(expected.end) ? expected.end : v.period.end,
    }))
    .sort((a, b) =>
      instant(a.start) < instant(b.start) ? -1 : instant(a.start) > instant(b.start) ? 1 : 0,
    );
  for (const w of clipped) {
    const last = windows.at(-1);
    if (last && instant(w.start) <= instant(last.end)) {
      if (instant(w.end) > instant(last.end)) last.end = w.end;
    } else windows.push({ ...w });
  }
  if (JSON.stringify(d.windows.map(period)) !== JSON.stringify(windows))
    throw Error("Delay windows differ from the union of their retained approvals.");
  return { ...d, observedAt: at, period: expected, approvals, windows };
}
