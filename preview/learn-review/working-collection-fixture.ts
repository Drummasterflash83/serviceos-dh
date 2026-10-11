// Synthetic display data only. Real arithmetic is checked against SQL readback.
import { workingMinutes } from "../../src/lib/learn-working-time";
const id = (n: number) => `99999999-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function workingCollectionFixture(p: any, policy: any, spec: any, partial: boolean) {
  const states = policy.metrics.find((m: any) => m.key === spec.metric).workStates;
  const scope = { tenantId: p.tenantId, observedAt: p.snapshotAt, period: p.period };
  const start = Date.parse(p.period.start),
    end = Math.min(Date.parse(p.period.end), start + 60000);
  const middle = Math.floor((start + end) / 2);
  const span = { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
  const delay = { start: span.start, end: new Date(middle).toISOString() };
  const assessed = { start: delay.end, end: span.end };
  const total = BigInt(end - start) * 1000n,
    excluded = BigInt(middle - start) * 1000n;
  const exact = total - excluded;
  const calendar = {
    ...scope,
    contract: "work-calendar-snapshot@1",
    complete: true,
    missing: [],
    versions: [
      {
        ...p.period,
        publicationId: id(9000),
        versionId: id(9001),
        definition: { name: "Synthetic company hours", timezone: "UTC" },
      },
    ],
    windows: [p.period],
  };
  return {
    value: partial ? null : workingMinutes(exact * BigInt(p.population)),
    proof: {
      calculation: "work-working-time-item@1",
      states,
      calendarComplete: true,
      assessedMicros: String(exact * BigInt(p.population)),
    },
    calendar: { calendar, states, assessedMicros: String(exact * BigInt(p.population)) },
    item(ordinal: number) {
      const objectId = id(ordinal),
        eventId = id(1000 + ordinal),
        approvalId = id(3000 + ordinal);
      const complete = !(partial && ordinal === p.population);
      const ownership = {
        ...span,
        objectId,
        status: states[0],
        owner: `${spec.subjectKind}:${p.subjectId}`,
        workEventIds: [eventId],
        ...(spec.subjectKind === "team" ? { teamId: p.subjectId } : {}),
      };
      const result = {
        ...scope,
        contract: "work-working-time-item@1",
        objectId,
        subject: { kind: spec.subjectKind, id: p.subjectId },
        states,
        eligible: true,
        complete,
        ownershipComplete: complete,
        calendarComplete: true,
        reasons: complete ? [] : ["ownership_history_incomplete"],
        unit: "working_item_minutes",
        elapsedOwnedMicros: String(total),
        selectedOwnedMicros: String(total),
        calendarMicros: String(total),
        excludedMicros: String(excluded),
        assessedMicros: String(exact),
        knownValue: workingMinutes(exact),
        value: complete ? workingMinutes(exact) : null,
        delayThrough: 1,
        delayApprovalIds: [approvalId],
        calendarPublicationIds: [id(9000)],
        eventIds: [eventId],
        segments: [
          {
            ownership,
            selectedState: true,
            calendarWindows: [span],
            excludedWindows: [delay],
            assessedWindows: [assessed],
          },
        ],
      };
      return {
        ordinal,
        object_id: objectId,
        head_sequence: "9007199254740993",
        head_reconciled: true,
        result,
      };
    },
    inputs(ordinal: number) {
      const objectId = id(ordinal);
      return {
        ordinal,
        objectId,
        delayThrough: 1,
        history: {
          objectId,
          count: 1,
          events: [
            {
              id: id(1000 + ordinal),
              sequence: "9007199254740993",
              kind: "insert",
              occurredAt: span.start,
              status: states[0],
            },
          ],
        },
        delays: {
          ...scope,
          contract: "work-delay-snapshot@1",
          objectId,
          through: 1,
          windows: [delay],
          approvals: [
            {
              id: id(3000 + ordinal),
              tenantId: p.tenantId,
              objectId,
              decision: "approve",
              revision: 1,
              recordedAt: p.snapshotAt,
              period: delay,
              label: "Synthetic approved delay",
              reason: "Synthetic display example",
            },
          ],
        },
      };
    },
  };
}
