/** Observed identity/team history, never a retrospective reconstruction from
 * today's directory. Effective dates constrain observed states; they do not
 * extend capture coverage backwards. */
import type { WorkOwnerRef, WorkTimeline } from "./learn-work-history.ts";
export type MembershipState = {
  profileId: string | null;
  teamId: string | null;
  confirmedAt: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
};
type Event = {
  id: string;
  sequence: string;
  kind: "insert" | "update" | "baseline";
  observedAt: string;
  before: MembershipState;
  after: MembershipState;
};
export type MemberHistory = {
  memberId: string;
  coverageStart: string | null;
  firstKind: Event["kind"] | null;
  sourceThrough: string | null;
  count: number;
  events: Event[];
};
export type RosterHistory = {
  contract: "member-capture@1";
  tenantId: string;
  period: { start: string; end: string };
  observedAt: string;
  count: number;
  members: MemberHistory[];
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const obj = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const stamp = (v: unknown): number => {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(v)
  )
    return NaN;
  const y = Number(v.slice(0, 4)),
    m = Number(v.slice(5, 7)),
    d = Number(v.slice(8, 10));
  if (
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > new Date(Date.UTC(y, m, 0)).getUTCDate() ||
    Number(v.slice(11, 13)) > 23 ||
    Number(v.slice(14, 16)) > 59 ||
    Number(v.slice(17, 19)) > 59
  )
    return NaN;
  return Date.parse(v);
};
const validState = (v: unknown): v is MembershipState =>
  obj(v) &&
  (v.profileId === null || uuid(v.profileId)) &&
  (v.teamId === null || uuid(v.teamId)) &&
  (v.confirmedAt === null || Number.isFinite(stamp(v.confirmedAt))) &&
  Number.isFinite(stamp(v.effectiveFrom)) &&
  (v.effectiveTo === null ||
    (Number.isFinite(stamp(v.effectiveTo)) && stamp(v.effectiveTo) >= stamp(v.effectiveFrom)));
const same = (a: MembershipState, b: MembershipState) =>
  a.profileId === b.profileId &&
  a.teamId === b.teamId &&
  a.confirmedAt === b.confirmedAt &&
  a.effectiveFrom === b.effectiveFrom &&
  a.effectiveTo === b.effectiveTo;
function times(scope: Pick<RosterHistory, "tenantId" | "period">) {
  const start = stamp(scope?.period?.start),
    end = stamp(scope?.period?.end);
  if (
    !uuid(scope?.tenantId) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    end - start > 366 * 86400000
  )
    throw Error("Invalid membership history scope");
  return { start, end };
}
export function readMemberHistory(
  scope: Pick<RosterHistory, "tenantId" | "period">,
  data: unknown,
): RosterHistory {
  const { start, end } = times(scope);
  const fail = () => {
    throw Error("Complete tenant-scoped membership history could not be verified");
  };
  if (
    !obj(data) ||
    data.contract !== "member-capture@1" ||
    data.tenantId !== scope.tenantId ||
    stamp(data.period?.start) !== start ||
    stamp(data.period?.end) !== end ||
    !Number.isFinite(stamp(data.observedAt)) ||
    stamp(data.observedAt) < end ||
    !Number.isSafeInteger(data.count) ||
    data.count < 0 ||
    data.count > 500 ||
    !Array.isArray(data.members) ||
    data.members.length !== data.count
  )
    return fail();
  const ids = new Set<string>(),
    eventIds = new Set<string>(),
    sequences = new Set<string>();
  let eventCount = 0;
  for (const member of data.members) {
    if (
      !obj(member) ||
      !uuid(member.memberId) ||
      ids.has(member.memberId) ||
      !Number.isSafeInteger(member.count) ||
      member.count < 0 ||
      member.count > 1000 ||
      !Array.isArray(member.events) ||
      member.events.length !== member.count
    )
      return fail();
    ids.add(member.memberId);
    eventCount += member.count;
    if (eventCount > 5000) return fail();
    const coverage = member.coverageStart === null ? null : stamp(member.coverageStart);
    if (coverage === null) {
      if (member.firstKind !== null || member.sourceThrough !== null || member.count !== 0)
        return fail();
      continue;
    }
    if (
      !Number.isFinite(coverage) ||
      !["insert", "update", "baseline"].includes(member.firstKind) ||
      !Number.isFinite(stamp(member.sourceThrough)) ||
      stamp(member.sourceThrough) < end ||
      stamp(member.sourceThrough) > stamp(data.observedAt) ||
      coverage > stamp(member.sourceThrough)
    )
      return fail();
    let previous: Event | null = null;
    for (const event of member.events) {
      const at = stamp(event?.observedAt);
      if (
        !obj(event) ||
        !uuid(event.id) ||
        eventIds.has(event.id) ||
        typeof event.sequence !== "string" ||
        !/^[1-9]\d{0,18}$/.test(event.sequence) ||
        sequences.has(event.sequence) ||
        !["insert", "update", "baseline"].includes(event.kind) ||
        !Number.isFinite(at) ||
        at < coverage ||
        at > end ||
        !validState(event.before) ||
        !validState(event.after) ||
        (event.kind !== "update" && !same(event.before, event.after)) ||
        (previous &&
          (at < start ||
            at < stamp(previous.observedAt) ||
            BigInt(event.sequence) <= BigInt(previous.sequence) ||
            !same(previous.after, event.before) ||
            event.kind !== "update"))
      )
        return fail();
      eventIds.add(event.id);
      sequences.add(event.sequence);
      previous = event as Event;
    }
    if (
      coverage < end &&
      (!member.count || stamp(member.events[0].observedAt) > Math.max(start, coverage))
    )
      return fail();
    if (
      member.count &&
      stamp(member.events[0].observedAt) === coverage &&
      member.events[0].kind !== member.firstKind
    )
      return fail();
  }
  return structuredClone(data) as RosterHistory;
}
export async function loadMemberHistory(
  db: {
    rpc(
      name: string,
      args: Record<string, unknown>,
    ): PromiseLike<{ data: unknown; error: unknown }>;
  },
  scope: Pick<RosterHistory, "tenantId" | "period">,
): Promise<RosterHistory> {
  times(scope);
  const { data, error } = await db.rpc("learn_member_history_read", {
    p_tenant: scope.tenantId,
    p_start: scope.period.start,
    p_end: scope.period.end,
  });
  if (error) throw Error("Membership history is unavailable with your current access");
  return readMemberHistory(scope, data);
}
export type MemberResolution = {
  state: "resolved" | "unknown" | "ambiguous" | "inactive" | "unconfirmed" | "unsupported";
  memberId: string | null;
  teamId: string | null;
  evidenceIds: string[];
};
function observedMember(member: MemberHistory, at: number) {
  const coverage = member.coverageStart === null ? null : stamp(member.coverageStart);
  if (coverage === null || at < coverage)
    return { known: member.firstKind === "insert" && coverage !== null, event: null, next: null };
  let i = member.events.length - 1;
  while (i >= 0 && stamp(member.events[i].observedAt) > at) i--;
  return {
    known: i >= 0,
    event: i >= 0 ? member.events[i] : null,
    next: i >= 0 ? (member.events[i + 1] ?? null) : null,
  };
}
/** Requires validated readMemberHistory output. User mappings need the complete
 * roster because an unobserved membership could map the same login to another
 * person. Names/emails and present-day roster matches never resolve identity. */
export function resolveHistoricalMember(
  history: RosterHistory,
  owner: WorkOwnerRef,
  at: string,
): MemberResolution {
  const time = stamp(at),
    { start, end } = times(history);
  if (!Number.isFinite(time) || time < start || time >= end)
    throw Error("Ownership time is outside membership review period");
  const result = (
    state: MemberResolution["state"],
    memberId: string | null = null,
    teamId: string | null = null,
    evidenceIds: string[] = [],
  ): MemberResolution => ({ state, memberId, teamId, evidenceIds });
  if (!owner || !["member", "user"].includes(owner.kind) || !uuid(owner.ref))
    return result("unsupported");
  const rows =
    owner.kind === "member"
      ? history.members.filter((m) => m.memberId === owner.ref)
      : history.members;
  if (!rows.length) return result("unknown");
  let unknown = false;
  const matches: { member: MemberHistory; event: Event; next: Event | null }[] = [];
  for (const member of rows) {
    const observed = observedMember(member, time);
    if (!observed.known) {
      unknown = true;
      continue;
    }
    if (!observed.event) continue; // Proven database insertion was later than this instant.
    if (owner.kind === "member" || observed.event.after.profileId === owner.ref)
      matches.push({ member, event: observed.event, next: observed.next });
  }
  if (unknown) return result("unknown");
  const active = matches.filter(
    ({ event }) =>
      stamp(event.after.effectiveFrom) <= time &&
      (event.after.effectiveTo === null || time < stamp(event.after.effectiveTo)),
  );
  if (active.length > 1) return result("ambiguous");
  if (!active.length) return result("inactive");
  const { member, event, next } = active[0];
  const evidence = next ? [event.id, next.id] : [event.id];
  if (event.after.confirmedAt === null || stamp(event.after.confirmedAt) > time)
    return result("unconfirmed", member.memberId, null, evidence);
  return result("resolved", member.memberId, event.after.teamId, evidence);
}

/** Per-item elapsed ownership, split at membership/confirmation boundaries.
 * These are factual durations, not productivity, business time or a score.
 * Across-item intervals must not be summed as if they were hours worked. */
export function attributeWorkMembership(timeline: WorkTimeline, history: RosterHistory) {
  if (
    timeline.tenantId !== history.tenantId ||
    stamp(timeline.period.start) !== stamp(history.period.start) ||
    stamp(timeline.period.end) !== stamp(history.period.end)
  )
    throw Error("Work and membership scopes differ");
  const boundaries = new Set<number>();
  for (const member of history.members) {
    if (member.coverageStart !== null) boundaries.add(stamp(member.coverageStart));
    for (const event of member.events) {
      boundaries.add(stamp(event.observedAt));
      boundaries.add(stamp(event.after.effectiveFrom));
      if (event.after.effectiveTo !== null) boundaries.add(stamp(event.after.effectiveTo));
      if (event.after.confirmedAt !== null) boundaries.add(stamp(event.after.confirmedAt));
    }
  }
  const ordered = [...boundaries].sort((a, b) => a - b);
  const segments: {
    start: string;
    end: string;
    elapsedMinutes: number;
    member: MemberResolution | null;
    workEvidenceIds: string[];
  }[] = [];
  for (const interval of timeline.intervals) {
    const start = stamp(interval.start),
      end = stamp(interval.end);
    const points = [start, ...ordered.filter((t) => t > start && t < end), end];
    for (let i = 0; i < points.length - 1; i++) {
      if (segments.length >= 10000) throw Error("Membership attribution exceeds bounded review");
      const from = new Date(points[i]).toISOString(),
        to = new Date(points[i + 1]).toISOString();
      segments.push({
        start: from,
        end: to,
        elapsedMinutes: (points[i + 1] - points[i]) / 60000,
        member: interval.responsible
          ? resolveHistoricalMember(history, interval.responsible, from)
          : null,
        workEvidenceIds: [...interval.evidenceIds],
      });
    }
  }
  return {
    tenantId: timeline.tenantId,
    objectId: timeline.objectId,
    period: timeline.period,
    workUnknownMinutes: timeline.unknownMinutes,
    segments,
  };
}
