/** Independent exact verifier for the private working-time item contract.
 * This does not collect observations, approve scores or infer working hours.
 */
import { delayStamp, delayUuid } from "./learn-work-delays.ts";
import type { TimeWindow } from "./learn-scorecards.ts";
type Range = [bigint, bigint];
export type WorkingTimeScope = {
  tenantId: string;
  objectId: string;
  subject: { kind: "member" | "team"; id: string };
  period: TimeWindow;
  observedAt: string;
  states: string[];
};
export type WorkingTimeItem = WorkingTimeScope & {
  contract: "work-working-time-item@1";
  eligible: boolean;
  complete: boolean;
  ownershipComplete: boolean;
  calendarComplete: boolean;
  reasons: string[];
  unit: "working_item_minutes";
  elapsedOwnedMicros: string;
  selectedOwnedMicros: string;
  calendarMicros: string;
  excludedMicros: string;
  assessedMicros: string;
  knownValue: number;
  value: number | null;
  delayThrough: number;
  delayApprovalIds: string[];
  calendarPublicationIds: string[];
  eventIds: string[];
  segments: {
    ownership: {
      objectId: string;
      start: string;
      end: string;
      status: string;
      owner: string;
      workEventIds: string[];
      teamId?: string;
      [key: string]: unknown;
    };
    selectedState: boolean;
    calendarWindows: TimeWindow[];
    excludedWindows: TimeWindow[];
    assessedWindows: TimeWindow[];
  }[];
};
function micros(v: unknown): bigint {
  const s = delayStamp(v);
  return BigInt(Date.parse(s.slice(0, 19) + "Z")) * 1000n + BigInt(s.slice(20, 26));
}
function range(v: TimeWindow): Range {
  const a = micros(v?.start),
    b = micros(v?.end);
  if (a >= b) throw Error("Working-time interval must be positive.");
  return [a, b];
}
function union(spans: Range[]): Range[] {
  const result: Range[] = [];
  for (const [a, b] of [...spans].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))) {
    const last = result.at(-1);
    if (last && a <= last[1]) {
      if (b > last[1]) last[1] = b;
    } else result.push([a, b]);
  }
  return result;
}
function windows(value: TimeWindow[], period: Range): Range[] {
  if (!Array.isArray(value) || value.length > 10000) throw Error("Invalid working-time windows.");
  return union(
    value.map((v) => {
      const r = range(v);
      if (r[0] < period[0] || r[1] > period[1])
        throw Error("Working-time window is outside its period.");
      return r;
    }),
  );
}
function intersect(a: Range[], b: Range[]): Range[] {
  const answer: Range[] = [];
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    const start = a[i][0] > b[j][0] ? a[i][0] : b[j][0];
    const end = a[i][1] < b[j][1] ? a[i][1] : b[j][1];
    if (start < end) answer.push([start, end]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return union(answer);
}
function subtract(a: Range[], b: Range[]): Range[] {
  const answer: Range[] = [];
  for (const [start, end] of a) {
    let at = start;
    for (const [cutStart, cutEnd] of b) {
      if (cutEnd <= at) continue;
      if (cutStart >= end) break;
      if (cutStart > at) answer.push([at, cutStart]);
      if (cutEnd > at) at = cutEnd;
      if (at >= end) break;
    }
    if (at < end) answer.push([at, end]);
  }
  return answer;
}
const duration = (v: Range[]) => v.reduce((total, [a, b]) => total + b - a, 0n);
const equal = (a: Range[], b: Range[]) =>
  a.length === b.length && a.every((r, i) => r[0] === b[i][0] && r[1] === b[i][1]);
const sameIds = (a: unknown, b: string[]) =>
  Array.isArray(a) &&
  a.length === b.length &&
  a.every((id, i) => id === b[i] && delayUuid(id)) &&
  new Set(a).size === a.length;
/** Match PostgreSQL numeric round(microseconds / 60000000, 12) before converting
 * its JSON decimal to a Number. Exact microsecond totals remain decimal strings. */
export function workingMinutes(microseconds: bigint): number {
  if (microseconds < 0n) throw Error("Negative working time.");
  const scaled = (microseconds * 1000000n + 30n) / 60n;
  return Number(`${scaled / 1000000000000n}.${String(scaled % 1000000000000n).padStart(12, "0")}`);
}
export function parseWorkingTimeItem(
  data: unknown,
  scope: WorkingTimeScope,
  snapshots: { calendar: any; delays: any },
): WorkingTimeItem {
  const d = data as WorkingTimeItem,
    p = range(scope.period),
    observed = micros(scope.observedAt);
  if (
    ![scope.tenantId, scope.objectId, scope.subject?.id].every(delayUuid) ||
    !["member", "team"].includes(scope.subject.kind) ||
    p[1] > observed ||
    p[1] - p[0] > 366n * 86400000000n ||
    !Array.isArray(scope.states) ||
    !scope.states.length ||
    scope.states.length > 50 ||
    scope.states.some(
      (s) => typeof s !== "string" || !s.trim() || s.trim() !== s || s.length > 200,
    ) ||
    new Set(scope.states).size !== scope.states.length
  )
    throw Error("Invalid working-time scope.");
  const states = [...scope.states].sort();
  const checkScope = (v: any) => {
    if (
      !v ||
      v.tenantId !== scope.tenantId ||
      micros(v.observedAt) !== observed ||
      !equal([range(v.period)], [p])
    )
      throw Error("Working-time evidence belongs to a different snapshot.");
  };
  checkScope(d);
  checkScope(snapshots.calendar);
  checkScope(snapshots.delays);
  const { calendar, delays } = snapshots;
  if (
    !d ||
    d.contract !== "work-working-time-item@1" ||
    d.objectId !== scope.objectId ||
    d.subject?.kind !== scope.subject.kind ||
    d.subject?.id !== scope.subject.id ||
    d.unit !== "working_item_minutes" ||
    !Array.isArray(d.states) ||
    d.states.length !== states.length ||
    new Set(d.states).size !== states.length ||
    d.states.some((state) => !states.includes(state)) ||
    [d.eligible, d.complete, d.ownershipComplete, d.calendarComplete].some(
      (v) => typeof v !== "boolean",
    ) ||
    !Array.isArray(d.segments) ||
    d.segments.length > 10000 ||
    !Array.isArray(d.eventIds) ||
    d.eventIds.length > 1000 ||
    !sameIds(d.eventIds, d.eventIds)
  )
    throw Error("Working-time result scope is invalid.");
  if (
    calendar.contract !== "work-calendar-snapshot@1" ||
    typeof calendar.complete !== "boolean" ||
    !Array.isArray(calendar.versions) ||
    calendar.versions.length > 100 ||
    delays.contract !== "work-delay-snapshot@1" ||
    delays.objectId !== scope.objectId ||
    !Array.isArray(delays.approvals) ||
    delays.approvals.length > 1000 ||
    !Number.isSafeInteger(delays.through) ||
    delays.through < 0
  )
    throw Error("Working-time inputs are invalid.");
  const hours = windows(calendar.windows, p),
    coverage = windows(calendar.versions, p),
    missing = windows(calendar.missing, p);
  if (
    !equal(missing, subtract([p], coverage)) ||
    duration(calendar.versions.map(range)) !== duration(coverage) ||
    calendar.complete !== (missing.length === 0) ||
    subtract(hours, coverage).length
  )
    throw Error("Published calendar coverage does not reconcile.");
  const excluded = windows(delays.windows, p);
  if (new Set(delays.approvals.map((a: any) => a.revision)).size !== delays.approvals.length)
    throw Error("Delay snapshot repeats a decision revision.");
  const approvals = delays.approvals.map((a: any) => {
    if (
      !a ||
      !delayUuid(a.id) ||
      a.tenantId !== scope.tenantId ||
      a.objectId !== scope.objectId ||
      a.decision !== "approve" ||
      !Number.isSafeInteger(a.revision) ||
      a.revision < 1 ||
      a.revision > delays.through ||
      micros(a.recordedAt) > observed
    )
      throw Error("Delay approval does not belong to this item snapshot.");
    const r = range(a.period);
    if (r[0] >= p[1] || r[1] <= p[0] || r[1] > micros(a.recordedAt))
      throw Error("Delay approval is outside the retained calculation.");
    return [r[0] < p[0] ? p[0] : r[0], r[1] > p[1] ? p[1] : r[1]] as Range;
  });
  if (
    !equal(excluded, union(approvals)) ||
    d.delayThrough !== delays.through ||
    !sameIds(
      d.delayApprovalIds,
      [...delays.approvals].sort((a, b) => a.revision - b.revision).map((a) => a.id),
    ) ||
    !sameIds(
      d.calendarPublicationIds,
      [...calendar.versions]
        .sort((a, b) => (micros(a.start) < micros(b.start) ? -1 : 1))
        .map((a) => a.publicationId),
    ) ||
    d.calendarComplete !== calendar.complete
  )
    throw Error("Working-time references differ from the frozen inputs.");
  let owned: Range[] = [],
    selected: Range[] = [],
    business: Range[] = [],
    removed: Range[] = [],
    assessed: Range[] = [];
  for (const segment of d.segments) {
    const o = segment.ownership,
      span = range(o),
      chosen = states.includes(o.status);
    if (
      !o ||
      o.objectId !== scope.objectId ||
      span[0] < p[0] ||
      span[1] > p[1] ||
      segment.selectedState !== chosen ||
      !Array.isArray(o.workEventIds) ||
      !o.workEventIds.length ||
      !o.workEventIds.every((id) => d.eventIds.includes(id)) ||
      (scope.subject.kind === "member"
        ? o.owner !== `member:${scope.subject.id}`
        : o.teamId !== scope.subject.id)
    )
      throw Error("Working-time ownership segment is unrelated to this result.");
    const b = chosen ? intersect([span], hours) : [],
      x = intersect(b, excluded),
      a = subtract(b, excluded);
    if (
      !equal(windows(segment.calendarWindows, p), b) ||
      !equal(windows(segment.excludedWindows, p), x) ||
      !equal(windows(segment.assessedWindows, p), a)
    )
      throw Error("Working-time segment arithmetic does not match frozen hours and delays.");
    owned.push(span);
    if (chosen) selected.push(span);
    business.push(...b);
    removed.push(...x);
    assessed.push(...a);
  }
  if (duration(owned) !== duration(union(owned)))
    throw Error("Overlapping ownership segments would double count this item.");
  const totals = {
    elapsedOwnedMicros: duration(owned),
    selectedOwnedMicros: duration(selected),
    calendarMicros: duration(business),
    excludedMicros: duration(removed),
    assessedMicros: duration(assessed),
  };
  for (const [key, expected] of Object.entries(totals)) {
    if ((d as any)[key] !== String(expected))
      throw Error("Working-time totals do not reconcile with their intervals.");
  }
  const complete = d.ownershipComplete && (d.calendarComplete || !d.eligible);
  const reasons = [
    ...(!d.ownershipComplete ? ["ownership_history_incomplete"] : []),
    ...(!d.calendarComplete && d.eligible ? ["calendar_history_incomplete"] : []),
  ];
  if (
    d.complete !== complete ||
    JSON.stringify(d.reasons) !== JSON.stringify(reasons) ||
    d.knownValue !== workingMinutes(totals.assessedMicros) ||
    d.value !== (complete ? d.knownValue : null) ||
    (!d.eligible && (d.segments.length || !d.ownershipComplete))
  )
    throw Error("Incomplete working-time evidence cannot become an assessed value.");
  return d;
}
