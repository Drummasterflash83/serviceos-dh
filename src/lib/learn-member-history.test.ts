import test from "node:test";
import assert from "node:assert/strict";
import {
  readMemberHistory,
  resolveHistoricalMember,
  loadMemberHistory,
} from "./learn-member-history.ts";
const id = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const at = (hour: number) => `2026-10-01T${String(hour).padStart(2, "0")}:00:00.000Z`;
const scope = { tenantId: id(1), period: { start: at(1), end: at(10) } };
const state = {
  profileId: id(3),
  teamId: id(4),
  confirmedAt: at(0),
  effectiveFrom: at(0),
  effectiveTo: null,
};
function fixture(): any {
  return {
    contract: "member-capture@1",
    ...scope,
    observedAt: at(11),
    count: 1,
    members: [
      {
        memberId: id(2),
        coverageStart: at(0),
        sourceThrough: at(11),
        firstKind: "insert",
        count: 2,
        events: [
          {
            id: id(10),
            sequence: "1",
            kind: "insert",
            observedAt: at(0),
            before: state,
            after: state,
          },
          {
            id: id(11),
            sequence: "2",
            kind: "update",
            observedAt: at(5),
            before: state,
            after: { ...state, teamId: id(5) },
          },
        ],
      },
    ],
  };
}
const read = (data: any = fixture()) => readMemberHistory(scope, data);
const resolve = (data: any, hour: number, kind = "member", ref = id(2)) =>
  resolveHistoricalMember(read(data), { kind, ref }, at(hour));
test("transfers resolve by observed time and retain evidence, not current membership", () => {
  const f = fixture();
  assert.deepEqual(resolve(f, 3), {
    state: "resolved",
    memberId: id(2),
    teamId: id(4),
    evidenceIds: [id(10), id(11)],
  });
  assert.equal(resolve(f, 5).teamId, id(5));
  assert.equal(resolve(f, 3, "user", id(3)).memberId, id(2));
  assert.equal(resolve(f, 9).teamId, id(5));
  assert.throws(() => resolve(f, 10), /outside/);
});
test("legacy baseline and first update cannot extend coverage to a backdated effective date", () => {
  for (const kind of ["baseline", "update"]) {
    const f = fixture();
    f.members[0].firstKind = kind;
    f.members[0].coverageStart = at(2);
    f.members[0].events[0].kind = kind;
    f.members[0].events[0].observedAt = at(2);
    assert.equal(resolve(f, 1).state, "unknown");
    assert.equal(resolve(f, 3).state, "resolved");
  }
  const f = fixture();
  f.members[0].coverageStart = null;
  f.members[0].firstKind = null;
  f.members[0].sourceThrough = null;
  f.members[0].events = [];
  f.members[0].count = 0;
  assert.equal(resolve(f, 5).state, "unknown");
});
test("new insert proves prior absence, but incomplete peers prevent user identity guessing", () => {
  const f = fixture();
  f.members[0].coverageStart = at(2);
  f.members[0].events[0].observedAt = at(2);
  assert.equal(resolve(f, 1).state, "inactive");
  f.members.push({
    memberId: id(8),
    coverageStart: null,
    sourceThrough: null,
    firstKind: null,
    count: 0,
    events: [],
  });
  f.count = 2;
  assert.equal(resolve(f, 3, "user", id(3)).state, "unknown");
  assert.equal(resolve(f, 3).state, "resolved");
});
test("duplicate active user identities are ambiguous even if only one is confirmed", () => {
  const f = fixture();
  const second = structuredClone(f.members[0]);
  second.memberId = id(9);
  second.events = second.events.map((e: any, i: number) => ({
    ...e,
    id: id(20 + i),
    sequence: String(3 + i),
    before: { ...e.before, confirmedAt: null },
    after: { ...e.after, confirmedAt: null },
  }));
  f.members.push(second);
  f.count = 2;
  assert.equal(resolve(f, 3, "user", id(3)).state, "ambiguous");
});
test("effective limits and confirmation dates constrain the observed state without rewriting earlier history", () => {
  const f = fixture();
  f.members[0].events[1].after = { ...state, effectiveTo: at(6) };
  assert.equal(resolve(f, 5).state, "resolved");
  assert.equal(resolve(f, 6).state, "inactive");
  f.members[0].events[1].after = { ...state, effectiveFrom: at(7), confirmedAt: at(8) };
  assert.equal(resolve(f, 6).state, "inactive");
  assert.equal(resolve(f, 7).state, "unconfirmed");
  assert.equal(resolve(f, 8).state, "resolved");
  assert.equal(resolve(f, 3).teamId, id(4));
  f.members[0].events[1].after = { ...state, confirmedAt: null };
  assert.equal(resolve(f, 6).state, "unconfirmed");
});
test("foreign, truncated, duplicate, disconnected and malformed histories fail as a whole", () => {
  const mutations = [
    (f: any) => (f.tenantId = id(99)),
    (f: any) => (f.count = 2),
    (f: any) => (f.members[0].count = 3),
    (f: any) => (f.members[0].events[1].id = id(10)),
    (f: any) => (f.members[0].events[1].sequence = "1"),
    (f: any) =>
      (f.members[0].events[1].before = { ...f.members[0].events[1].before, teamId: id(99) }),
    (f: any) => (f.members[0].events[1].after.effectiveFrom = "2026-02-30T00:00:00Z"),
    (f: any) => (f.members[0].sourceThrough = at(9)),
    (f: any) => (f.members[0].firstKind = "invented"),
    (f: any) => f.members[0].events.shift(),
    (f: any) => (f.members[0].events[1].kind = "baseline"),
  ];
  for (const mutate of mutations) {
    const f = structuredClone(fixture());
    mutate(f);
    assert.throws(() => read(f));
  }
});
test("unsupported identity labels never become a person by text matching", () => {
  assert.equal(resolve(fixture(), 3, "user", "person@example.test").state, "unsupported");
  assert.equal(resolve(fixture(), 3, "team", id(4)).state, "unsupported");
  assert.equal(resolve(fixture(), 3, "member", id(99)).state, "unknown");
});
test("real RPC reader binds tenant and completed period and refuses unavailable reads", async () => {
  let args: any;
  const r = await loadMemberHistory(
    {
      rpc: async (name, a) => {
        assert.equal(name, "learn_member_history_read");
        args = a;
        return { data: fixture(), error: null };
      },
    },
    scope,
  );
  assert.deepEqual(args, {
    p_tenant: scope.tenantId,
    p_start: scope.period.start,
    p_end: scope.period.end,
  });
  assert.equal(r.members.length, 1);
  await assert.rejects(() =>
    loadMemberHistory({ rpc: async () => ({ data: null, error: { code: "denied" } }) }, scope),
  );
});
test("work time is split at team and effective-date boundaries, with work gaps retained", async () => {
  const { attributeWorkMembership } = await import("./learn-member-history.ts");
  const f = fixture();
  f.members[0].events[1].after = { ...state, teamId: id(5), effectiveTo: at(8) };
  const timeline: any = {
    ...scope,
    objectId: id(30),
    unknownMinutes: 60,
    intervals: [
      {
        start: at(2),
        end: at(10),
        responsible: { kind: "member", ref: id(2) },
        evidenceIds: [id(40)],
      },
    ],
  };
  const result = attributeWorkMembership(timeline, read(f));
  assert.deepEqual(
    result.segments.map((s) => [s.elapsedMinutes, s.member?.state, s.member?.teamId]),
    [
      [180, "resolved", id(4)],
      [180, "resolved", id(5)],
      [120, "inactive", null],
    ],
  );
  assert.equal(result.workUnknownMinutes, 60);
  assert.deepEqual(result.segments[0].workEvidenceIds, [id(40)]);
  assert.throws(
    () => attributeWorkMembership({ ...timeline, tenantId: id(99) }, read(f)),
    /scopes differ/,
  );
  timeline.intervals[0].responsible = null;
  assert.ok(attributeWorkMembership(timeline, read(f)).segments.every((s) => s.member === null));
});
