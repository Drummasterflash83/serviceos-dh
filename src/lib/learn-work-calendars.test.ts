import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWorkCalendar,
  validateWorkCalendar,
  parseWorkCalendarRead,
  parseWorkCalendarPreview,
  readWorkCalendar,
  saveWorkCalendar,
  publishWorkCalendar,
  previewWorkCalendar,
  type WorkCalendarDefinition,
} from "./learn-work-calendars.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = id(1),
  actor = id(2),
  versionId = id(3),
  publicationId = id(4);
const definition: WorkCalendarDefinition = {
  name: "Office",
  timezone: "Europe/London",
  weekly: [{ day: 1, startMinute: 540, endMinute: 1020 }],
  exceptions: [{ date: "2026-10-12", windows: [] }],
};
const version = {
  id: versionId,
  tenantId: tenant,
  revision: 1,
  definition,
  recordedAt: "2026-10-01T10:00:00Z",
  recordedBy: actor,
  reason: "Agreed hours",
};
const period = { start: "2026-10-05T00:00:00Z", end: "2026-10-06T00:00:00Z" };
const preview = {
  contract: "work-calendar-preview@1",
  tenantId: tenant,
  version,
  simulation: true,
  period,
  windows: [{ start: "2026-10-05T08:00:00Z", end: "2026-10-05T16:00:00Z" }],
  minutes: 480,
};
test("calendar validation preserves explicit closed dates, split shifts and company timezone", () => {
  const d = {
    ...definition,
    name: " Office ",
    weekly: [
      { day: 2, startMinute: 780, endMinute: 1020 },
      { day: 1, startMinute: 540, endMinute: 720 },
      { day: 2, startMinute: 540, endMinute: 720 },
    ],
  };
  assert.deepEqual(validateWorkCalendar(d), []);
  const normalized = normalizeWorkCalendar(d);
  assert.equal(normalized.name, "Office");
  assert.equal(normalized.timezone, "Europe/London");
  assert.deepEqual(
    normalized.weekly.map((w) => [w.day, w.startMinute]),
    [
      [1, 540],
      [2, 540],
      [2, 780],
    ],
  );
  assert.deepEqual(normalized.exceptions, [{ date: "2026-10-12", windows: [] }]);
  assert.deepEqual(validateWorkCalendar({ ...definition, weekly: [], exceptions: [] }), []);
});
test("unknown timezone, overlapping or overnight windows, invalid dates and unsupported fields reject", () => {
  for (const patch of [
    { timezone: "BST" },
    { timezone: "Europe/Invented" },
    { weekly: [null] },
    { weekly: [{ day: 0, startMinute: 540, endMinute: 600 }] },
    { weekly: [{ day: 1, startMinute: 540.5, endMinute: 600 }] },
    { weekly: [{ day: 1, startMinute: 1200, endMinute: 300 }] },
    {
      weekly: [
        { day: 1, startMinute: 540, endMinute: 600 },
        { day: 1, startMinute: 599, endMinute: 660 },
      ],
    },
    { exceptions: [{ date: "2026-02-30", windows: [] }] },
    {
      exceptions: [
        { date: "2026-10-12", windows: [] },
        { date: "2026-10-12", windows: [] },
      ],
    },
    {
      exceptions: [
        {
          date: "2026-10-12",
          windows: [
            { startMinute: 30, endMinute: 60 },
            { startMinute: 59, endMinute: 90 },
          ],
        },
      ],
    },
    { surprise: "field" },
  ])
    assert.ok(validateWorkCalendar({ ...definition, ...patch } as any).length);
  assert.ok(validateWorkCalendar(null as any).length);
});
test("reads distinguish no calendar, saved draft and separately published version; foreign or inconsistent results reject", async () => {
  const none = {
    contract: "work-calendar-read@1",
    tenantId: tenant,
    draft: null,
    publication: null,
  };
  const db = {
    rpc: async (name: string, args: any) => {
      assert.equal(name, "learn_work_calendar_read");
      assert.deepEqual(args, { p_tenant: tenant });
      return { data: none, error: null };
    },
  };
  assert.deepEqual(await readWorkCalendar(db, tenant), none);
  const publication = {
    id: publicationId,
    effectiveFrom: "2026-10-01T11:00:00Z",
    recordedBy: actor,
    reason: "Approved",
    version,
  };
  const read = { ...none, draft: { ...version, id: id(5), revision: 2 }, publication };
  assert.equal(parseWorkCalendarRead(read, tenant).publication?.version.revision, 1);
  for (const bad of [
    { ...read, tenantId: id(99) },
    { ...read, draft: null },
    { ...read, publication: { ...publication, effectiveFrom: "2026-09-01T00:00:00Z" } },
    { ...read, publication: { ...publication, version: { ...version, tenantId: id(99) } } },
    { ...read, draft: { ...version, id: id(5) } },
  ])
    assert.throws(() => parseWorkCalendarRead(bad, tenant));
});
test("preview verifies exact scope, separate simulation label, complete ordered windows and matching total", async () => {
  assert.equal(parseWorkCalendarPreview(preview, tenant, versionId, period).minutes, 480);
  for (const patch of [
    { simulation: false },
    { tenantId: id(99) },
    { version: { ...version, id: id(99) } },
    { minutes: 481 },
    { period: { ...period, end: "2026-10-07T00:00:00Z" } },
    { windows: [...preview.windows, ...preview.windows], minutes: 960 },
    { windows: [{ start: "2026-10-04T08:00:00Z", end: "2026-10-05T16:00:00Z" }], minutes: 1920 },
  ])
    assert.throws(() =>
      parseWorkCalendarPreview({ ...preview, ...patch }, tenant, versionId, period),
    );
  const empty = { ...preview, windows: [], minutes: 0 };
  assert.equal(parseWorkCalendarPreview(empty, tenant, versionId, period).minutes, 0);
  let calls = 0;
  const db = {
    rpc: async (name: string, args: any) => {
      calls++;
      assert.equal(name, "learn_work_calendar_preview");
      assert.equal(args.p_version, versionId);
      return { data: preview, error: null };
    },
  };
  await previewWorkCalendar(db, tenant, versionId, period);
  await assert.rejects(
    previewWorkCalendar(db, tenant, versionId, {
      start: "2026-01-01T00:00:00Z",
      end: "2028-01-01T00:00:00Z",
    }),
  );
  assert.equal(calls, 1);
});
test("saving submits only normalized definition and intent, preserving identity on retries", async () => {
  const request = {
    tenantId: tenant,
    actorId: actor,
    requestId: versionId,
    expectedRevision: 0,
    definition: { ...definition, name: " Office " },
    reason: " Agreed hours ",
  };
  const calls: any[] = [];
  const db = {
    rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      return { data: { contract: "work-calendar@1", version }, error: null };
    },
  };
  await saveWorkCalendar(db, request);
  await saveWorkCalendar(db, request);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].name, "learn_work_calendar_save");
  assert.equal(calls[0].args.p_definition.name, "Office");
  assert.equal(calls[0].args.p_reason, "Agreed hours");
  assert.ok(!("effectiveFrom" in calls[0].args));
  for (const patch of [
    { id: id(9) },
    { recordedBy: id(9) },
    { revision: 2 },
    { definition: { ...definition, timezone: "UTC" } },
    { reason: "Changed" },
  ])
    await assert.rejects(
      saveWorkCalendar(
        {
          rpc: async () => ({
            data: { contract: "work-calendar@1", version: { ...version, ...patch } },
            error: null,
          }),
        },
        request,
      ),
    );
});
test("publication binds latest version and prior publication but never supplies an effective timestamp", async () => {
  const input = {
    tenantId: tenant,
    actorId: actor,
    versionId,
    expectedPublication: null,
    requestId: publicationId,
    reason: "Publish agreed hours",
  };
  const response = {
    contract: "work-calendar-publication@1",
    id: publicationId,
    tenantId: tenant,
    versionId,
    effectiveFrom: "2026-10-01T11:00:00Z",
    recordedBy: actor,
    reason: input.reason,
  };
  const db = {
    rpc: async (name: string, args: any) => {
      assert.equal(name, "learn_work_calendar_publish");
      assert.deepEqual(args, {
        p_tenant: tenant,
        p_version: versionId,
        p_expected_publication: null,
        p_request: publicationId,
        p_reason: input.reason,
      });
      return { data: response, error: null };
    },
  };
  assert.equal((await publishWorkCalendar(db, input)).id, publicationId);
  for (const patch of [
    { tenantId: id(99) },
    { id: id(99) },
    { versionId: id(99) },
    { recordedBy: id(99) },
  ])
    await assert.rejects(
      publishWorkCalendar(
        { rpc: async () => ({ data: { ...response, ...patch }, error: null }) },
        input,
      ),
    );
});
test("conflicts, denied access and lost replies do not turn into saved or published success", async () => {
  for (const [code, pattern] of [
    ["PT409", /changed/],
    ["42501", /owner or admin/],
    ["network", /could not be confirmed/],
  ] as const) {
    const db = { rpc: async () => ({ data: null, error: { code } }) };
    await assert.rejects(
      saveWorkCalendar(db, {
        tenantId: tenant,
        actorId: actor,
        requestId: versionId,
        expectedRevision: 0,
        definition,
        reason: "Agreed hours",
      }),
      pattern,
    );
    await assert.rejects(
      publishWorkCalendar(db, {
        tenantId: tenant,
        actorId: actor,
        versionId,
        expectedPublication: null,
        requestId: publicationId,
        reason: "Publish",
      }),
      pattern,
    );
  }
});
