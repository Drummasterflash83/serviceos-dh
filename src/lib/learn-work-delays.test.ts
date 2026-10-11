import test from "node:test";
import assert from "node:assert/strict";
import {
  delayStamp,
  normalizeDelayPayload,
  parseDelayEntry,
  parseDelayPage,
  parseDelaySnapshot,
  readDelayPage,
  recordWorkDelay,
  resolveWorkDelay,
  readDelayEvidence,
  type DelayPayload,
} from "./learn-work-delays.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = id(1),
  object = id(2),
  actor = id(3),
  approval = id(4),
  source = id(5);
const period = { start: "2026-10-05T09:00:00Z", end: "2026-10-05T10:00:00Z" };
const input: DelayPayload = {
  objectId: object,
  expectedRevision: 0,
  decision: "approve",
  approvalId: null,
  period,
  label: "Supplier wait",
  evidenceIds: [source],
  reason: "Owner verified supplier delay",
};
const entry = {
  id: approval,
  tenantId: tenant,
  objectId: object,
  revision: 1,
  decision: "approve",
  approvalId: null,
  period,
  label: input.label,
  evidenceIds: [source],
  reason: input.reason,
  recordedBy: actor,
  recordedAt: "2026-10-05T11:00:00.000123Z",
};
const reverse: DelayPayload = {
  objectId: object,
  expectedRevision: 1,
  decision: "reverse",
  approvalId: approval,
  period: null,
  label: null,
  evidenceIds: [],
  reason: "Delay attribution corrected",
};
const reversed = {
  ...entry,
  id: id(6),
  revision: 2,
  decision: "reverse",
  approvalId: approval,
  evidenceIds: [],
  reason: reverse.reason,
  recordedAt: "2026-10-05T11:30:00Z",
};
const snapshot = {
  contract: "work-delay-snapshot@1",
  tenantId: tenant,
  objectId: object,
  through: 1,
  period,
  observedAt: "2026-10-05T12:00:00Z",
  approvals: [entry],
  windows: [period],
};

test("delay identities normalize evidence, reasons and offset timestamps without dropping microseconds", () => {
  assert.equal(delayStamp("2026-10-05T10:00:00.123456+01:00"), "2026-10-05T09:00:00.123456Z");
  assert.equal(delayStamp("2026-10-05T09:00:00.000001Z"), "2026-10-05T09:00:00.000001Z");
  assert.equal(delayStamp("2026-10-05T09:00:00.1Z"), "2026-10-05T09:00:00.100000Z");
  const p = normalizeDelayPayload({
    ...input,
    label: " Supplier wait ",
    reason: " Checked ",
    evidenceIds: [id(20), source],
  });
  assert.equal(p.reason, "Checked");
  assert.equal(p.label, "Supplier wait");
  assert.deepEqual(p.evidenceIds, [source, id(20)]);
  for (const value of [
    "2026-02-30T00:00:00Z",
    "2026-10-05T24:00:00Z",
    "2026-10-05T09:00:00",
    "2026-10-05",
    "2026-10-05T09:00:00.1234567Z",
  ])
    assert.throws(() => delayStamp(value));
});
test("approval and reversal descriptors cannot carry missing, extra or contradictory scope", () => {
  for (const patch of [
    { expectedRevision: -1 },
    { expectedRevision: 1.5 },
    { expectedRevision: 2147483647 },
    { reason: "" },
    { label: null },
    { approvalId: approval },
    { evidenceIds: [] },
    { evidenceIds: [source, source] },
    { period: { ...period, end: period.start } },
    { period: { ...period, end: "2028-10-05T00:00:00Z" } },
    { surprise: true },
  ])
    assert.throws(() => normalizeDelayPayload({ ...input, ...patch } as any));
  for (const patch of [
    { approvalId: null },
    { period },
    { label: "Replacement" },
    { evidenceIds: [source] },
    { decision: "reinstate" },
  ])
    assert.throws(() => normalizeDelayPayload({ ...reverse, ...patch } as any));
  assert.equal(normalizeDelayPayload(reverse).decision, "reverse");
});
test("recorded entries enforce tenant, object, decision, completed interval and captured evidence shape", () => {
  assert.equal(parseDelayEntry(entry, tenant, object).recordedAt, entry.recordedAt);
  assert.equal(parseDelayEntry(reversed, tenant, object).approvalId, approval);
  for (const patch of [
    { tenantId: id(99) },
    { objectId: id(99) },
    { revision: 0 },
    { decision: "automatic" },
    { evidenceIds: [] },
    { approvalId: id(9) },
    { recordedAt: "2026-10-05T08:00:00Z" },
  ])
    assert.throws(() => parseDelayEntry({ ...entry, ...patch }, tenant, object));
});
test("fixed-head pages reject missing rows, duplicated identities and skipped or reordered revisions", async () => {
  const page = {
    contract: "work-delay-page@1",
    tenantId: tenant,
    objectId: object,
    after: 0,
    through: 2,
    next: 2,
    hasMore: false,
    entries: [entry, reversed],
  };
  assert.equal(parseDelayPage(page, tenant, object, 0, null).entries.length, 2);
  for (const patch of [
    { entries: [entry] },
    { through: 3 },
    { hasMore: true },
    { next: 1 },
    { entries: [reversed, entry] },
    { entries: [entry, { ...reversed, recordedAt: entry.recordedAt }] },
  ])
    assert.throws(() => parseDelayPage({ ...page, ...patch }, tenant, object, 0, null));
  assert.throws(() => parseDelayPage(page, tenant, object, 0, 1));
  const db = {
    rpc: async (name: string, args: any) => {
      assert.equal(name, "learn_work_delay_read");
      assert.deepEqual(args, { p_tenant: tenant, p_object: object, p_after: 0, p_through: 2 });
      return { data: page, error: null };
    },
  };
  assert.equal((await readDelayPage(db, tenant, object, 0, 2)).through, 2);
});
test("100-entry pages preserve the fixed head for the remaining decisions", () => {
  const entries = Array.from({ length: 100 }, (_, i) => ({
    ...entry,
    id: id(100 + i),
    revision: i + 1,
    recordedAt: new Date(Date.parse(entry.recordedAt) + i + 1).toISOString(),
  }));
  const page = {
    contract: "work-delay-page@1",
    tenantId: tenant,
    objectId: object,
    after: 0,
    through: 101,
    next: 100,
    hasMore: true,
    entries,
  };
  assert.equal(parseDelayPage(page, tenant, object, 0, null).next, 100);
  const last = {
    ...page,
    after: 100,
    next: 101,
    hasMore: false,
    entries: [{ ...entries[99], id: id(200), revision: 101 }],
  };
  assert.equal(parseDelayPage(last, tenant, object, 100, 101).entries[0].revision, 101);
  assert.throws(() =>
    parseDelayPage({ ...last, through: 102, hasMore: true }, tenant, object, 100, 101),
  );
});
test("record submits the exact descriptor and rejects acknowledgements for a different intent", async () => {
  const db = {
    rpc: async (name: string, args: any) => {
      assert.equal(name, "learn_work_delay_record");
      assert.deepEqual(args, {
        p_tenant: tenant,
        p_request: approval,
        p_payload: normalizeDelayPayload(input),
      });
      return { data: { contract: "work-delay-record@1", entry }, error: null };
    },
  };
  assert.equal((await recordWorkDelay(db, tenant, actor, approval, input)).id, approval);
  for (const patch of [
    { id: id(90) },
    { recordedBy: id(90) },
    { label: "Changed" },
    { reason: "Changed" },
    { period: { ...period, start: "2026-10-05T09:00:00.000001Z" } },
  ])
    await assert.rejects(
      recordWorkDelay(
        {
          rpc: async () => ({
            data: { contract: "work-delay-record@1", entry: { ...entry, ...patch } },
            error: null,
          }),
        },
        tenant,
        actor,
        approval,
        input,
      ),
    );
  assert.equal(
    (
      await recordWorkDelay(
        {
          rpc: async () => ({
            data: { contract: "work-delay-record@1", entry: reversed },
            error: null,
          }),
        },
        tenant,
        actor,
        id(6),
        reverse,
      )
    ).decision,
    "reverse",
  );
});
test("recovery binds actor and exact payload and never calls a pending cancellation terminal", async () => {
  const result = {
    contract: "work-delay-resolution@1",
    tenantId: tenant,
    actorId: actor,
    requestId: approval,
    payload: input,
    state: "recorded",
    recordedAt: entry.recordedAt,
  };
  assert.equal(
    (
      await resolveWorkDelay(
        { rpc: async () => ({ data: result, error: null }) },
        tenant,
        actor,
        approval,
        input,
        true,
      )
    ).state,
    "recorded",
  );
  for (const patch of [
    { actorId: id(9) },
    { requestId: id(9) },
    { payload: { ...input, reason: "Changed" } },
    { state: "pending", recordedAt: null },
    { recordedAt: null },
    { state: "unknown" },
  ])
    await assert.rejects(
      resolveWorkDelay(
        { rpc: async () => ({ data: { ...result, ...patch }, error: null }) },
        tenant,
        actor,
        approval,
        input,
        true,
      ),
    );
});
test("snapshot union clips overlapping approvals once, preserves precise boundaries and rejects invented windows", () => {
  const second = {
    ...entry,
    id: id(7),
    revision: 2,
    period: { start: "2026-10-05T09:30:00Z", end: "2026-10-05T10:30:00Z" },
    recordedAt: "2026-10-05T11:01:00Z",
  };
  const s = { ...snapshot, through: 2, approvals: [entry, second] };
  assert.equal(parseDelaySnapshot(s, tenant, object, period, s.observedAt).windows.length, 1);
  for (const patch of [
    { windows: [] },
    { windows: [period, period] },
    { approvals: [entry, entry] },
    { approvals: [reversed] },
    { approvals: [{ ...entry, recordedAt: "2026-10-05T13:00:00Z" }] },
    { through: 0 },
    { windows: [{ ...period, start: "2026-10-05T09:00:00.000001Z" }] },
  ])
    assert.throws(() =>
      parseDelaySnapshot({ ...s, ...patch }, tenant, object, period, s.observedAt),
    );
  const none = { ...s, through: 4, approvals: [], windows: [] };
  assert.deepEqual(parseDelaySnapshot(none, tenant, object, period, s.observedAt).windows, []);
});
test("retained proof must match the approval interval and contain every selected source record", async () => {
  const state = {
    status: "waiting",
    version: 1,
    responsible_ref: null,
    accountable_ref: null,
    waiting_on_ref: null,
    attributes: {},
  };
  const capture = {
    contract: "work-capture@1",
    tenantId: tenant,
    objectId: object,
    period,
    observedAt: "2026-10-05T11:00:00Z",
    coverageStart: period.start,
    sourceThrough: "2026-10-05T11:00:00Z",
    count: 1,
    events: [
      {
        id: source,
        tenantId: tenant,
        objectId: object,
        sequence: "9007199254740993",
        kind: "insert",
        occurredAt: period.start,
        before: state,
        after: state,
      },
    ],
  };
  const result = {
    contract: "work-delay-evidence@1",
    tenantId: tenant,
    objectId: object,
    approval: entry,
    capture,
  };
  assert.equal(
    (
      await readDelayEvidence(
        { rpc: async () => ({ data: result, error: null }) },
        tenant,
        object,
        approval,
      )
    ).approval.id,
    approval,
  );
  for (const patch of [
    { tenantId: id(9) },
    { approval: { ...entry, id: id(9) } },
    { capture: { ...capture, period: { ...period, end: "2026-10-05T10:01:00Z" } } },
    { capture: { ...capture, events: [{ ...capture.events[0], id: id(9) }] } },
    { capture: { ...capture, observedAt: "2026-10-05T11:00:00.000124Z" } },
  ])
    await assert.rejects(
      readDelayEvidence(
        { rpc: async () => ({ data: { ...result, ...patch }, error: null }) },
        tenant,
        object,
        approval,
      ),
    );
});
test("denied and uncertain API outcomes never become evidence or confirmed approvals", async () => {
  for (const code of ["42501", "PT409", "network"]) {
    const db = { rpc: async () => ({ data: null, error: { code } }) };
    await assert.rejects(recordWorkDelay(db, tenant, actor, approval, input));
    await assert.rejects(resolveWorkDelay(db, tenant, actor, approval, input, false));
    await assert.rejects(readDelayPage(db, tenant, object));
    await assert.rejects(readDelayEvidence(db, tenant, object, approval));
  }
});

test("sub-millisecond delay proof preserves precise boundaries and refuses a one-microsecond coverage gap", async () => {
  const precisePeriod = {
    start: "2026-10-05T09:00:00.000001Z",
    end: "2026-10-05T09:00:00.000010Z",
  };
  const state = {
    status: "waiting",
    version: 1,
    responsible_ref: null,
    accountable_ref: null,
    waiting_on_ref: null,
    attributes: {},
  };
  const capture = {
    contract: "work-capture@1",
    tenantId: tenant,
    objectId: object,
    period: precisePeriod,
    observedAt: "2026-10-05T11:00:00Z",
    coverageStart: precisePeriod.start,
    sourceThrough: "2026-10-05T11:00:00Z",
    count: 1,
    events: [
      {
        id: source,
        tenantId: tenant,
        objectId: object,
        sequence: "9007199254740993",
        kind: "insert",
        occurredAt: precisePeriod.start,
        before: state,
        after: state,
      },
    ],
  };
  const result = {
    contract: "work-delay-evidence@1",
    tenantId: tenant,
    objectId: object,
    approval: { ...entry, period: precisePeriod },
    capture,
  };
  assert.equal(
    (
      await readDelayEvidence(
        { rpc: async () => ({ data: result, error: null }) },
        tenant,
        object,
        approval,
      )
    ).approval.period.start,
    precisePeriod.start,
  );
  await assert.rejects(
    readDelayEvidence(
      {
        rpc: async () => ({
          data: {
            ...result,
            capture: { ...capture, coverageStart: "2026-10-05T09:00:00.000002Z" },
          },
          error: null,
        }),
      },
      tenant,
      object,
      approval,
    ),
  );
});
