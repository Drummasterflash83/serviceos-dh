import test from "node:test";
import assert from "node:assert/strict";
import {
  loadCommusoftJobDetails,
  parseCommusoftJobDetails,
  JOB_DETAIL_FIELDS,
  JOB_DETAIL_DATES,
} from "./learn-commusoft-job-details.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function detail(): any {
  return {
    version: "commusoft-job-detail/2",
    tenant_id: id(1),
    connection_id: id(2),
    version_id: id(3),
    external_id: "955",
    observed_at: "2026-10-10T12:00:00Z",
    current: true,
    property_reference: "3",
    fields: Object.fromEntries(
      Object.keys(JOB_DETAIL_FIELDS).map((k) => [k, { value: null, shortened: false }]),
    ),
    dates: Object.fromEntries(
      Object.keys(JOB_DETAIL_DATES).map((k) => [
        k,
        { state: "absent", source: null, instant: null },
      ]),
    ),
  };
}
const parse = (d: any) => parseCommusoftJobDetails(d, id(1), id(2), id(3), "955");
test("read requests one exact retained version and preserves source text without inferring a timezone", async () => {
  const d = detail();
  d.dates.completed = { state: "timezone_required", source: "2026-10-01 14:30:00", instant: null };
  d.fields.description.value = "<script>text only</script>";
  let calls = 0;
  const actual = await loadCommusoftJobDetails(
    {
      rpc: async (name, args) => {
        calls++;
        assert.equal(name, "learn_commusoft_job_details");
        assert.deepEqual(args, { p_tenant: id(1), p_connection: id(2), p_version: id(3) });
        return { data: d, error: null };
      },
    },
    id(1),
    id(2),
    id(3),
    "955",
  );
  assert.equal(calls, 1);
  assert.equal(actual.dates.completed.instant, null);
  assert.equal(actual.fields.description.value, d.fields.description.value);
});
test("zoned dates must retain the exact instant, including microseconds", () => {
  const d = detail();
  d.dates.completed = {
    state: "zoned",
    source: "2026-10-01T15:00:00.000001+01:00",
    instant: "2026-10-01T14:00:00.000001Z",
  };
  assert.equal(parse(d).dates.completed.instant, d.dates.completed.instant);
  d.dates.completed.instant = "2026-10-01T14:00:00.000002Z";
  assert.throws(() => parse(d));
  d.dates.completed = { state: "timezone_required", source: "2026-02-30 01:00:00", instant: null };
  assert.throws(() => parse(d));
  d.dates.completed = {
    state: "zoned",
    source: "2026-02-30T00:00:00Z",
    instant: "2026-03-02T00:00:00Z",
  };
  assert.throws(() => parse(d));
});
test("wrong scope, private fields, incomplete envelopes and false date claims fail closed", () => {
  const mutate = [
    (d: any) => (d.tenant_id = id(8)),
    (d: any) => (d.connection_id = id(8)),
    (d: any) => (d.version_id = id(8)),
    (d: any) => (d.external_id = "999"),
    (d: any) => (d.payload = { secret: "private" }),
    (d: any) => delete d.dates.closed,
    (d: any) => (d.fields.password = { value: "private", shortened: false }),
    (d: any) => (d.property_reference = 3),
    (d: any) => (d.current = "true"),
    (d: any) => (d.dates.created.instant = "2026-10-01T00:00:00Z"),
    (d: any) =>
      (d.dates.completed = {
        state: "timezone_required",
        source: "2026-10-01 14:30:00",
        instant: "2026-10-01T14:30:00Z",
      }),
  ];
  for (const change of mutate) {
    const d = detail();
    change(d);
    assert.throws(() => parse(d));
  }
});
test("Unicode excerpts retain explicit shortening and stale versions remain marked", () => {
  const d = detail();
  d.current = false;
  d.fields.description = { value: "🔧".repeat(4000), shortened: true };
  assert.equal(parse(d).current, false);
  d.fields.description.value += "🔧";
  assert.throws(() => parse(d));
  d.fields.description = { value: "short", shortened: true };
  assert.throws(() => parse(d));
});
test("source financial and people labels stay text, scoped to the exact observed version", () => {
  const d = detail();
  d.external_id = "955";
  d.fields.quotedAmount.value = "£1,234.50";
  d.fields.customerContactName.value = "Customer Example";
  d.fields.siteContactName.value = "Site Example";
  d.fields.completedBySourceUser.value = "Engineer Example";
  assert.equal(parse(d).fields.quotedAmount.value, "£1,234.50");
  assert.equal(parse(d).fields.completedBySourceUser.value, "Engineer Example");
  d.external_id = "956";
  assert.throws(() => parse(d));
});
test("denied and failed reads expose no provider error or raw response; invalid scope makes no request", async () => {
  for (const db of [
    { rpc: async () => ({ data: detail(), error: { code: "42501", message: "private" } }) },
    {
      rpc: async () => {
        throw Error("private");
      },
    },
    { rpc: async () => ({ data: { payload: "private" }, error: null }) },
  ])
    await assert.rejects(
      loadCommusoftJobDetails(db, id(1), id(2), id(3), "955"),
      (e) =>
        e instanceof Error &&
        e.message.includes("could not be verified") &&
        !e.message.includes("private"),
    );
  let calls = 0;
  await assert.rejects(
    loadCommusoftJobDetails(
      {
        rpc: async () => {
          calls++;
          return { data: null, error: null };
        },
      },
      id(1),
      id(2),
      "bad",
      "955",
    ),
  );
  assert.equal(calls, 0);
});
