/** Build factual residence intervals from the database capture contract. These
 * are elapsed intervals, not employee scores, business hours or approved delays.
 * Legacy status logs and user-entered dates cannot establish missing ownership.
 */
export interface WorkOwnerRef {
  kind: string;
  ref: string;
}
export interface WorkSnapshot {
  status: string;
  version: number;
  responsible_ref: WorkOwnerRef | null;
  accountable_ref: WorkOwnerRef | null;
  waiting_on_ref: WorkOwnerRef | null;
  attributes: Record<string, unknown>;
}
export interface CapturedWorkEvent {
  id: string;
  tenantId: string;
  objectId: string;
  sequence: string;
  kind: "insert" | "update" | "baseline";
  occurredAt: string;
  before: WorkSnapshot;
  after: WorkSnapshot;
}
export interface WorkHistoryScope {
  tenantId: string;
  objectId: string;
  period: { start: string; end: string };
}
export interface WorkResidenceInterval {
  start: string;
  end: string;
  elapsedMinutes: number;
  state: string;
  responsible: WorkOwnerRef | null;
  accountable: WorkOwnerRef | null;
  waitingOn: WorkOwnerRef | null;
  evidenceIds: string[];
}
export interface WorkTimeline extends WorkHistoryScope {
  coverage: "complete" | "partial" | "missing";
  coverageStart: string | null;
  sourceThrough: string | null;
  observedAt: string;
  knownMinutes: number;
  unknownMinutes: number;
  intervals: WorkResidenceInterval[];
  handoffs: { occurredAt: string; from: WorkOwnerRef; to: WorkOwnerRef; evidenceId: string }[];
  eventCount: number;
}
export interface WorkHistoryClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const named = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 500;
function stamp(v: unknown): number {
  if (typeof v !== "string") return NaN;
  const m = v.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!m) return NaN;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return NaN;
  return Date.parse(v);
}
function ref(v: unknown): v is WorkOwnerRef | null {
  return v === null || (object(v) && named(v.kind) && named(v.ref));
}
function snapshot(v: unknown): v is WorkSnapshot {
  return (
    object(v) &&
    named(v.status) &&
    Number.isSafeInteger(v.version) &&
    v.version > 0 &&
    ref(v.responsible_ref) &&
    ref(v.accountable_ref) &&
    ref(v.waiting_on_ref) &&
    object(v.attributes)
  );
}
const canonical = (v: any): string => {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (object(v))
    return (
      "{" +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
};
const sameRef = (a: WorkOwnerRef | null, b: WorkOwnerRef | null) =>
  a === b || (!!a && !!b && a.kind === b.kind && a.ref === b.ref);
const iso = (v: number) => new Date(v).toISOString();
function scopeTimes(scope: WorkHistoryScope): [number, number] {
  const start = stamp(scope?.period?.start),
    end = stamp(scope?.period?.end);
  if (
    !uuid(scope?.tenantId) ||
    !uuid(scope?.objectId) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 366 * 86400000
  )
    throw Error("Invalid work history scope");
  return [start, end];
}

export function buildWorkTimeline(scope: WorkHistoryScope, data: unknown): WorkTimeline {
  const [start, end] = scopeTimes(scope);
  if (
    !object(data) ||
    data.contract !== "work-capture@1" ||
    data.tenantId !== scope.tenantId ||
    data.objectId !== scope.objectId ||
    stamp(data.period?.start) !== start ||
    stamp(data.period?.end) !== end ||
    !Number.isFinite(stamp(data.observedAt)) ||
    stamp(data.observedAt) < end ||
    !Number.isSafeInteger(data.count) ||
    data.count < 0 ||
    data.count > 1000 ||
    !Array.isArray(data.events) ||
    data.count !== data.events.length
  )
    throw Error("Complete tenant-scoped work history could not be verified");
  const coverageStart = data.coverageStart === null ? null : stamp(data.coverageStart);
  const through = data.sourceThrough === null ? null : stamp(data.sourceThrough);
  if (
    (coverageStart === null) !== (through === null) ||
    (coverageStart !== null &&
      (!Number.isFinite(coverageStart) ||
        !Number.isFinite(through) ||
        through! < end ||
        coverageStart > through! ||
        through! > stamp(data.observedAt))) ||
    (coverageStart === null && data.events.length)
  )
    throw Error("Work capture coverage is inconsistent");
  const events: CapturedWorkEvent[] = data.events;
  const ids = new Set<string>();
  let previous: CapturedWorkEvent | undefined;
  for (const event of events) {
    const at = stamp(event?.occurredAt);
    if (
      !event ||
      !uuid(event.id) ||
      ids.has(event.id) ||
      event.tenantId !== scope.tenantId ||
      event.objectId !== scope.objectId ||
      typeof event.sequence !== "string" ||
      !/^[1-9]\d{0,18}$/.test(event.sequence) ||
      !["insert", "update", "baseline"].includes(event.kind) ||
      !Number.isFinite(at) ||
      at > end ||
      coverageStart === null ||
      at < coverageStart ||
      !snapshot(event.before) ||
      !snapshot(event.after) ||
      (event.kind !== "update" && canonical(event.before) !== canonical(event.after)) ||
      (previous &&
        (BigInt(event.sequence) <= BigInt(previous.sequence) ||
          at < stamp(previous.occurredAt) ||
          at < start ||
          canonical(previous.after) !== canonical(event.before)))
    )
      throw Error("Work history contains duplicate, malformed or disconnected events");
    ids.add(event.id);
    previous = event;
  }
  if (
    coverageStart !== null &&
    coverageStart < end &&
    (!events.length || stamp(events[0].occurredAt) > Math.max(start, coverageStart))
  )
    throw Error("Work history is missing its opening state");
  const intervals: WorkResidenceInterval[] = [];
  const handoffs: WorkTimeline["handoffs"] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const at = stamp(event.occurredAt),
      next = events[i + 1];
    const from = Math.max(start, at),
      to = Math.min(end, next ? stamp(next.occurredAt) : end);
    if (to > from)
      intervals.push({
        start: iso(from),
        end: iso(to),
        elapsedMinutes: (to - from) / 60000,
        state: event.after.status,
        responsible: event.after.responsible_ref,
        accountable: event.after.accountable_ref,
        waitingOn: event.after.waiting_on_ref,
        evidenceIds: next ? [event.id, next.id] : [event.id],
      });
    const before = event.before.responsible_ref,
      after = event.after.responsible_ref;
    if (
      event.kind === "update" &&
      at >= start &&
      at < end &&
      before &&
      after &&
      !sameRef(before, after)
    )
      handoffs.push({ occurredAt: iso(at), from: before, to: after, evidenceId: event.id });
  }
  // Sum integer milliseconds before converting: fractional minute addition can
  // otherwise turn a complete period into a tiny, fictitious coverage gap.
  const knownMilliseconds = intervals.reduce((n, v) => n + stamp(v.end) - stamp(v.start), 0);
  const knownMinutes = knownMilliseconds / 60000;
  const unknownMinutes = Math.max(0, end - start - knownMilliseconds) / 60000;
  return {
    ...scope,
    coverage: knownMinutes === 0 ? "missing" : unknownMinutes > 0 ? "partial" : "complete",
    coverageStart: coverageStart === null ? null : iso(coverageStart),
    sourceThrough: through === null ? null : iso(through),
    observedAt: iso(stamp(data.observedAt)),
    knownMinutes,
    unknownMinutes,
    intervals,
    handoffs,
    eventCount: events.length,
  };
}

export async function loadWorkTimeline(
  db: WorkHistoryClient,
  scope: WorkHistoryScope,
): Promise<WorkTimeline> {
  const [start, end] = scopeTimes(scope);
  const { data, error } = await db.rpc("learn_work_history_read", {
    p_tenant: scope.tenantId,
    p_object: scope.objectId,
    p_start: iso(start),
    p_end: iso(end),
  });
  if (error) throw Error("Work history is unavailable or incomplete with your current access");
  return buildWorkTimeline(scope, data);
}

/** Current display names only. This never resolves historical membership or
 * turns a legacy email/name into a staff identity for scoring. */
export async function loadWorkOwnerLabels(
  db: { from(table: string): any },
  timeline: WorkTimeline,
): Promise<Record<string, string>> {
  return loadWorkReferenceLabels(
    db,
    timeline.tenantId,
    timeline.intervals
      .flatMap((i) => [i.responsible, i.accountable, i.waitingOn])
      .concat(timeline.handoffs.flatMap((h) => [h.from, h.to])),
  );
}
/** Current directory labels for captured references; never historical scoring identities. */
export async function loadWorkReferenceLabels(
  db: { from(table: string): any },
  tenantId: string,
  references: (WorkOwnerRef | null)[],
): Promise<Record<string, string>> {
  if (!uuid(tenantId)) throw Error("Company scope is required for owner labels");
  const refs = references.filter((r): r is WorkOwnerRef => !!r && uuid(r.ref));
  const labels: Record<string, string> = {};
  for (const [kind, column] of [
    ["member", "id"],
    ["user", "profile_id"],
  ] as const) {
    const ids = [...new Set(refs.filter((r) => r.kind === kind).map((r) => r.ref))];
    if (!ids.length) continue;
    if (ids.length > 500) throw Error("Owner directory exceeds this review window");
    const { data, error, count } = await db
      .from("team_members")
      .select("id,tenant_id,profile_id,display_name", { count: "exact" })
      .eq("tenant_id", tenantId)
      .in(column, ids)
      .limit(501);
    if (
      error ||
      !Array.isArray(data) ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > 500 ||
      count !== data.length ||
      data.some(
        (r: any) => !r || r.tenant_id !== tenantId || !uuid(r.id) || !ids.includes(r[column]),
      )
    )
      throw Error("Current owner labels could not be verified");
    for (const id of ids) {
      const matches = data.filter((r: any) => r[column] === id);
      if (matches.length === 1 && named(matches[0].display_name))
        labels[`${kind}:${id}`] = matches[0].display_name;
    }
  }
  return labels;
}
