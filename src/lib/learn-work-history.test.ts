import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkTimeline,
  loadWorkTimeline,
  loadWorkOwnerLabels,
  type WorkSnapshot,
  type CapturedWorkEvent,
} from "./learn-work-history.ts";
const tenantId = "10000000-0000-4000-8000-000000000001";
const objectId = "40000000-0000-4000-8000-000000000001";
const a = { kind: "member", ref: "30000000-0000-4000-8000-000000000001" };
const b = { kind: "member", ref: "30000000-0000-4000-8000-000000000002" };
const time = (hour: number) => `2026-10-08T${String(hour).padStart(2, "0")}:00:00Z`;
const state = (owner: typeof a | null, status = "in_progress", version = 1): WorkSnapshot => ({
  status,
  version,
  responsible_ref: owner,
  accountable_ref: a,
  waiting_on_ref: null,
  attributes: {},
});
const event = (
  i: number,
  hour: number,
  before: WorkSnapshot,
  after = before,
  kind: CapturedWorkEvent["kind"] = "update",
): CapturedWorkEvent => ({
  id: `50000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  tenantId,
  objectId,
  sequence: String(i),
  kind,
  occurredAt: time(hour),
  before,
  after,
});
const scope = { tenantId, objectId, period: { start: time(9), end: time(12) } };
const response = (events: CapturedWorkEvent[], coverageStart: string | null = time(8)) => ({
  contract: "work-capture@1",
  ...scope,
  observedAt: time(13),
  sourceThrough: coverageStart ? time(13) : null,
  coverageStart,
  count: events.length,
  events,
});

test("calculates clipped residence and handoff from both database snapshots", () => {
  const events = [
    event(1, 8, state(a), state(a), "baseline"),
    event(2, 10, state(a), state(b)),
    event(3, 11, state(b), state(b, "waiting")),
  ];
  const r = buildWorkTimeline(scope, response(events));
  assert.equal(r.coverage, "complete");
  assert.equal(r.knownMinutes, 180);
  assert.equal(r.unknownMinutes, 0);
  assert.deepEqual(
    r.intervals.map((i) => [i.responsible?.ref, i.state, i.elapsedMinutes]),
    [
      [a.ref, "in_progress", 60],
      [b.ref, "in_progress", 60],
      [b.ref, "waiting", 60],
    ],
  );
  assert.deepEqual(r.handoffs, [
    { occurredAt: "2026-10-08T10:00:00.000Z", from: a, to: b, evidenceId: events[1].id },
  ]);
  assert.deepEqual(r.intervals[0].evidenceIds, [events[0].id, events[1].id]);
});
test("baseline never reconstructs earlier ownership from its before state", () => {
  const r = buildWorkTimeline(
    scope,
    response([event(1, 10, state(a), state(a), "baseline")], time(10)),
  );
  assert.equal(r.coverage, "partial");
  assert.equal(r.knownMinutes, 120);
  assert.equal(r.unknownMinutes, 60);
  assert.equal(r.intervals[0].start, "2026-10-08T10:00:00.000Z");
  assert.equal(r.handoffs.length, 0);
});
test("missing capture and capture beginning after the period remain missing", () => {
  for (const data of [response([], null), response([], time(13))]) {
    const r = buildWorkTimeline(scope, data);
    assert.equal(r.coverage, "missing");
    assert.equal(r.unknownMinutes, 180);
    assert.deepEqual(r.intervals, []);
  }
});
test("half-open period counts no handoff at its end; exact timestamp ties follow capture sequence", () => {
  const events = [
    event(1, 8, state(a), state(a), "baseline"),
    event(2, 10, state(a), state(b)),
    event(3, 10, state(b), state(b, "waiting")),
    event(4, 12, state(b, "waiting"), state(a)),
  ];
  const r = buildWorkTimeline(scope, response(events));
  assert.equal(r.handoffs.length, 1);
  assert.equal(r.intervals.length, 2);
  assert.equal(r.intervals[1].state, "waiting");
  assert.equal(r.intervals[1].elapsedMinutes, 120);
});
test("unassigned work and unresolved legacy names remain references, not credited staff", () => {
  const events = [
    event(1, 8, state(null), state(null), "baseline"),
    event(2, 10, state(null), state({ kind: "user", ref: "old@example.test" })),
  ];
  const r = buildWorkTimeline(scope, response(events));
  assert.equal(r.intervals[0].responsible, null);
  assert.equal(r.intervals[1].responsible?.ref, "old@example.test");
  assert.equal(r.handoffs.length, 0);
});
test("failed count, scope, sequence, timestamp, opening state or snapshot continuity rejects the read", () => {
  const base = [event(1, 8, state(a), state(a), "baseline"), event(2, 10, state(a), state(b))];
  const variants = [
    { ...response(base), count: 1 },
    { ...response(base), count: null },
    { ...response(base), tenantId: "other" },
    { ...response(base), sourceThrough: time(11) },
    { ...response(base), coverageStart: null },
    response([base[0], { ...base[1], id: base[0].id }]),
    response([base[0], { ...base[1], sequence: "1" }]),
    response([base[0], { ...base[1], sequence: "-1" }]),
    response([{ ...base[0], occurredAt: "2026-10-08T08:00:00" }]),
    response([{ ...base[0], occurredAt: "2026-02-30T08:00:00Z" }]),
    response([base[0], { ...base[1], occurredAt: time(7) }]),
    response([base[1]]),
    response([base[0], { ...base[1], before: state(b) }]),
    response([{ ...base[0], kind: "baseline" as const, after: state(b) }]),
    response([{ ...base[0], objectId: tenantId }]),
  ];
  for (const data of variants) assert.throws(() => buildWorkTimeline(scope, data));
});
test("JSON object key order does not manufacture a state gap", () => {
  const first = state(a);
  first.attributes = { one: 1, two: 2 };
  const second = state(a);
  second.attributes = { two: 2, one: 1 };
  assert.equal(
    buildWorkTimeline(
      scope,
      response([event(1, 8, first, first, "baseline"), event(2, 10, second, state(b))]),
    ).coverage,
    "complete",
  );
});
test("reader uses one authenticated RPC and rejects unavailable history without partial calculations", async () => {
  const calls: unknown[] = [];
  const data = response([event(1, 8, state(a), state(a), "baseline")]);
  const result = await loadWorkTimeline(
    {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data, error: null };
      },
    },
    scope,
  );
  assert.equal(result.coverage, "complete");
  assert.deepEqual(calls, [
    {
      name: "learn_work_history_read",
      args: {
        p_tenant: tenantId,
        p_object: objectId,
        p_start: "2026-10-08T09:00:00.000Z",
        p_end: "2026-10-08T12:00:00.000Z",
      },
    },
  ]);
  await assert.rejects(() =>
    loadWorkTimeline({ rpc: async () => ({ data, error: "denied" }) }, scope),
  );
});

test("fractional-minute boundaries cannot create a fictitious coverage gap", () => {
  const events = Array.from({ length: 50 }, (_, i) => ({
    ...event(i + 1, 9, state(a), state(a), i === 0 ? "baseline" : "update"),
    occurredAt: new Date(Date.parse(time(9)) + i * 101).toISOString(),
  }));
  const timeline = buildWorkTimeline(scope, response(events, time(9)));
  assert.equal(timeline.knownMinutes, 180);
  assert.equal(timeline.unknownMinutes, 0);
  assert.equal(timeline.coverage, "complete");
});

test("directory labels are tenant checked, exact-count checked and never resolve ambiguous or legacy identities", async () => {
  const profile = "20000000-0000-4000-8000-000000000001";
  const timeline = buildWorkTimeline(
    scope,
    response([
      event(1, 8, state(a), state(a), "baseline"),
      event(2, 10, state(a), state({ kind: "user", ref: profile })),
      event(
        3,
        11,
        state({ kind: "user", ref: profile }),
        state({ kind: "user", ref: "legacy@example.test" }),
      ),
    ]),
  );
  const queries: unknown[] = [];
  const member = {
    id: a.ref,
    tenant_id: tenantId,
    profile_id: profile,
    display_name: "Example owner",
  };
  const client = (rows: (typeof member)[], count = rows.length, error: unknown = null) => ({
    from: (table: string) => {
      const query = {
        select: (columns: string, options: unknown) => {
          queries.push({ table, columns, options });
          return query;
        },
        eq: (column: string, value: string) => {
          assert.equal(column, "tenant_id");
          assert.equal(value, tenantId);
          return query;
        },
        in: (column: string, ids: string[]) => {
          assert.deepEqual(ids, [column === "id" ? a.ref : profile]);
          return query;
        },
        limit: async (n: number) => {
          assert.equal(n, 501);
          return { data: rows, count, error };
        },
      };
      return query;
    },
  });
  assert.deepEqual(await loadWorkOwnerLabels(client([member]), timeline), {
    [`member:${a.ref}`]: "Example owner",
    [`user:${profile}`]: "Example owner",
  });
  assert.equal(queries.length, 2);
  assert.deepEqual(await loadWorkOwnerLabels(client([member, member]), timeline), {});
  for (const db of [
    client([{ ...member, tenant_id: objectId }]),
    client([member], 2),
    client([member], 1, "denied"),
  ])
    await assert.rejects(() => loadWorkOwnerLabels(db, timeline));
});
