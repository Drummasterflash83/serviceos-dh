import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { loadAssessmentHistory, type AssessmentHistoryCursor } from "./learn-assessments.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = id(1),
  subject = { kind: "member" as const, id: id(3) };
function row(n: number, time = "2026-01-03T00:00:00.000000+00:00") {
  return {
    id: id(n),
    tenant_id: tenant,
    publication_id: id(5),
    subject_kind: subject.kind,
    subject_id: subject.id,
    window_start: "2026-01-01T00:00:00Z",
    window_end: "2026-01-02T00:00:00Z",
    recorded_at: time,
    recorded_by: id(2),
    reason: `Review ${n}`,
  };
}
function client(data: any[], count = data.length, error: any = null) {
  const calls: any[] = [];
  const q: any = {
    select: (...a: any[]) => {
      calls.push(["select", ...a]);
      return q;
    },
    eq: (...a: any[]) => {
      calls.push(["eq", ...a]);
      return q;
    },
    or: (...a: any[]) => {
      calls.push(["or", ...a]);
      return q;
    },
    order: (...a: any[]) => {
      calls.push(["order", ...a]);
      return q;
    },
    limit: (n: number) => {
      calls.push(["limit", n]);
      return Promise.resolve({ data, count, error });
    },
  };
  return {
    calls,
    from: (name: string) => {
      assert.equal(name, "learn_assessments");
      return q;
    },
  };
}
const cursor = (
  recordedAt = "2026-01-03T00:00:00.000020+00:00",
  n = 100,
): AssessmentHistoryCursor => ({
  tenantId: tenant,
  subjectKind: subject.kind,
  subjectId: subject.id,
  recordedAt,
  id: id(n),
});
test("microsecond positions survive exact tie boundaries and remain scoped to the same card", async () => {
  const rows = Array.from({ length: 20 }, (_, i) =>
    row(100 + i, `2026-01-03T00:00:00.${String(40 - i).padStart(6, "0")}+00:00`),
  );
  const db = client(rows, 43),
    page = await loadAssessmentHistory(db, tenant, subject);
  assert.equal(page.nextCursor?.recordedAt, "2026-01-03T00:00:00.000021+00:00");
  assert.equal(page.nextCursor?.id, id(119));
  const next = client([row(999, "2026-01-03T00:00:00.000020+00:00")]);
  assert.equal(
    (await loadAssessmentHistory(next, tenant, subject, page.nextCursor)).rows[0].id,
    id(999),
  );
  assert.ok(
    next.calls.some(
      (c) =>
        c[0] === "or" &&
        c[1] ===
          `recorded_at.lt.2026-01-03T00:00:00.000021+00:00,and(recorded_at.eq.2026-01-03T00:00:00.000021+00:00,id.lt.${id(119)})`,
    ),
  );
  for (const [key, value] of [
    ["tenant_id", tenant],
    ["subject_kind", "member"],
    ["subject_id", subject.id],
  ])
    assert.ok(next.calls.some((c) => c[0] === "eq" && c[1] === key && c[2] === value));
  assert.deepEqual(
    next.calls.filter((c) => c[0] === "order"),
    [
      ["order", "recorded_at", { ascending: false }],
      ["order", "id", { ascending: false }],
    ],
  );
});
test("same-time rows use descending UUIDs; equal instants with another timezone compare correctly", async () => {
  const c = cursor("2026-01-03T01:00:00.000020+01:00", 100);
  assert.equal(
    (
      await loadAssessmentHistory(
        client([row(99, "2026-01-03T00:00:00.000020Z")]),
        tenant,
        subject,
        c,
      )
    ).rows.length,
    1,
  );
  for (const r of [
    row(100, "2026-01-03T00:00:00.000020Z"),
    row(101, "2026-01-03T00:00:00.000020Z"),
    row(1, "2026-01-03T00:00:00.000021Z"),
  ])
    await assert.rejects(loadAssessmentHistory(client([r]), tenant, subject, c), /order/);
  await assert.rejects(loadAssessmentHistory(client([row(10), row(11)]), tenant, subject), /order/);
});
test("foreign, malformed and injection-like positions stop before the reader is called", async () => {
  for (const change of [
    { tenantId: id(9) },
    { subjectId: id(9) },
    { subjectKind: "job" },
    { id: "x" },
    { recordedAt: "2026-01-03T00:00:00Z,id.gt.0" },
    { recordedAt: "2026-02-30T00:00:00Z" },
    { recordedAt: "2026-01-03T00:00:00.1234567Z" },
    { recordedAt: "2026-01-03" },
  ]) {
    let calls = 0;
    await assert.rejects(
      loadAssessmentHistory(
        {
          from: () => {
            calls++;
            throw Error("Unexpected read");
          },
        },
        tenant,
        subject,
        { ...cursor(), ...change } as any,
      ),
    );
    assert.equal(calls, 0);
  }
});
test("partial, duplicate, foreign and failed pages are rejected; a final page has no next position", async () => {
  const c = cursor();
  for (const db of [
    client([row(9)], 2),
    client([row(9), row(9)]),
    client([{ ...row(9), tenant_id: id(9) }]),
    client([], 0, { code: "42501" }),
    client([row(9)], null as any),
  ])
    await assert.rejects(loadAssessmentHistory(db, tenant, subject, c));
  const final = await loadAssessmentHistory(client([row(9)]), tenant, subject, c);
  assert.equal(final.nextCursor, null);
  assert.equal(final.total, 1);
  assert.equal((await loadAssessmentHistory(client([]), tenant, subject, c)).nextCursor, null);
});
test("actual Supabase request uses a bounded keyset query, not an offset; new saves do not shift older pages", async () => {
  let rows = Array.from({ length: 43 }, (_, i) => row(143 - i));
  const original = rows.map((r) => r.id),
    urls: URL[] = [];
  const db = createClient("https://synthetic.invalid", "synthetic-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        urls.push(url);
        assert.equal(url.pathname, "/rest/v1/learn_assessments");
        assert.equal(url.searchParams.get("order"), "recorded_at.desc,id.desc");
        assert.equal(url.searchParams.get("tenant_id"), `eq.${tenant}`);
        assert.equal(url.searchParams.get("subject_id"), `eq.${subject.id}`);
        assert.equal(url.searchParams.get("subject_kind"), "eq.member");
        assert.equal(url.searchParams.get("limit"), "20");
        assert.equal(url.searchParams.has("offset"), false);
        assert.match(new Headers(init?.headers).get("prefer") ?? "", /count=exact/);
        const filter = url.searchParams.get("or");
        const found = filter
          ? rows.filter((r) => r.id < (filter.match(/id\.lt\.([a-f\d-]+)/)?.[1] ?? ""))
          : rows;
        return new Response(JSON.stringify(found.slice(0, 20)), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-range": `0-${Math.max(0, Math.min(20, found.length) - 1)}/${found.length}`,
          },
        });
      },
    },
  });
  let next: AssessmentHistoryCursor | null = null;
  const seen: string[] = [];
  do {
    const page = await loadAssessmentHistory(db, tenant, subject, next);
    seen.push(...page.rows.map((r) => r.id));
    next = page.nextCursor;
    if (seen.length === 20) rows = [row(999, "2026-01-04T00:00:00Z"), ...rows];
  } while (next);
  assert.deepEqual(seen, original);
  assert.equal(urls.length, 3);
  const fresh = await loadAssessmentHistory(db, tenant, subject);
  assert.equal(fresh.rows[0].id, id(999));
  assert.equal(fresh.total, 44);
});
