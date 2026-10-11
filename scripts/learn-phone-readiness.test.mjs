import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { computeSourceReadiness } from "../supabase/functions/_shared/controlplane/readiness.ts";
const tenant = "10000000-0000-4000-8000-000000000001";
const id = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-11T00:00:00Z");
const row = (n, fields = {}) => ({
  id: id(n),
  tenant_id: tenant,
  effective_from: "2026-01-01T00:00:00Z",
  effective_to: null,
  ...fields,
});
function database(records = {}, transform = (r) => r, cap = 137) {
  const calls = [];
  return {
    calls,
    from(table) {
      let rows = [...(records[table] ?? [])],
        columns = [],
        head = false,
        limit = Infinity;
      const c = { table, head: false };
      const q = {};
      q.select = (text, opts) => {
        columns = text.split(",").map((s) => s.trim());
        head = opts?.head === true;
        c.head = head;
        return q;
      };
      q.eq = (k, v) => {
        rows = rows.filter((r) => r[k] === v);
        return q;
      };
      q.lte = (k, v) => {
        rows = rows.filter((r) => Date.parse(r[k]) <= Date.parse(v));
        return q;
      };
      q.or = (text) => {
        const cutoff = text.slice("effective_to.is.null,effective_to.gt.".length);
        rows = rows.filter(
          (r) => r.effective_to === null || Date.parse(r.effective_to) > Date.parse(cutoff),
        );
        return q;
      };
      q.gt = (k, v) => {
        rows = rows.filter((r) => r[k] > v);
        c.cursor = v;
        return q;
      };
      q.order = (k) => {
        rows.sort((a, b) => String(a[k]).localeCompare(String(b[k])));
        return q;
      };
      q.limit = (v) => {
        limit = v;
        return q;
      };
      q.maybeSingle = async () => transform({ data: rows[0] ?? null, error: null }, c, calls);
      q.then = (resolve, reject) => {
        calls.push(c);
        const data = rows
          .slice(0, Math.min(limit, cap))
          .map((r) => Object.fromEntries(columns.map((k) => [k, r[k]])));
        return Promise.resolve(
          transform({ data: head ? null : data, count: rows.length, error: null }, c, calls),
        ).then(resolve, reject);
      };
      return q;
    },
  };
}

function fixture() {
  return {
    communication_endpoints: [row(1, { channel: "phone", status: "active", endpoint_kind: "ddi" })],
    endpoint_ownership_assignments: ["accountable", "primary_handler"].map((role, i) =>
      row(10 + i, {
        endpoint_id: id(1),
        assignment_role: role,
        review_state: "confirmed",
        confidence: 0.9,
        owner_kind: "person",
        owner_member_id: id(20),
      }),
    ),
    team_members: [row(20)],
    org_units: [row(30)],
    config_versions: [
      row(40, {
        artifact_kind: "policy",
        artifact_key: "customer_health",
        version: 1,
        status: "published",
      }),
    ],
    operating_profile_entries: [
      row(50, {
        scope_kind: "tenant",
        namespace: "customer_health",
        key: "source.allowlist",
        value: { enabled: true, sources: ["phone_call"] },
      }),
    ],
  };
}
const run = (f) => computeSourceReadiness(database(f), tenant, now);
const check = (r, k) => r.checks.find((c) => c.key === k).ok;
test("complete confirmed configuration reaches shadow configuration only, never staff acceptance", async () => {
  const r = await run(fixture());
  assert.equal(r.level, "ready_for_chris_shadow");
  assert.match(r.summary, /does not verify live capture/);
  assert.match(r.summary, /Staff pilot approval needs separate/);
});
test("unpublished latest policy, disabled or wrong-channel allowlist each prevents shadow", async () => {
  for (const status of ["draft", "retired", "none"]) {
    const f = fixture();
    if (status === "none") f.config_versions = [];
    else
      f.config_versions.push(row(41, { ...f.config_versions[0], id: id(41), version: 2, status }));
    const r = await run(f);
    assert.equal(r.level, "ready_for_evaluation");
    assert.equal(check(r, "health_policy_state"), false);
  }
  for (const value of [
    null,
    {},
    { enabled: false, sources: ["phone_call"] },
    { enabled: true, sources: ["email_message"] },
    { enabled: true, sources: ["phone"] },
  ]) {
    const f = fixture();
    f.operating_profile_entries[0].value = value;
    const r = await run(f);
    assert.equal(r.level, "ready_for_evaluation");
    assert.equal(check(r, "source_allowlist_state"), false);
  }
});
test("proposed, conflicted, expired and future ownership never establishes readiness", async () => {
  for (const fields of [
    { review_state: "proposed" },
    { review_state: "conflicted" },
    { effective_from: "2027-01-01" },
    { effective_to: "2026-10-10" },
  ]) {
    const f = fixture();
    Object.assign(f.endpoint_ownership_assignments[0], fields);
    assert.equal((await run(f)).level, "not_ready");
  }
});
test("duplicate confirmed roles and invalid owners fail closed", async () => {
  for (const index of [0, 1]) {
    const f = fixture();
    f.endpoint_ownership_assignments.push({
      ...f.endpoint_ownership_assignments[index],
      id: id(99),
    });
    const r = await run(f);
    assert.equal(r.level, "not_ready");
    assert.equal(check(r, "no_conflicts"), false);
  }
  for (const fields of [
    { owner_member_id: id(999) },
    { owner_kind: "shared" },
    { owner_kind: "role", owner_role: " " },
    { owner_kind: "team", owner_org_unit_id: id(999) },
  ]) {
    const f = fixture();
    Object.assign(f.endpoint_ownership_assignments[0], fields);
    assert.equal((await run(f)).level, "not_ready");
  }
  const f = fixture();
  f.team_members[0].effective_to = "2026-10-10";
  assert.equal((await run(f)).level, "not_ready");
});
test("other endpoints cannot supply a missing DDI handler; valid company team or role can", async () => {
  const f = fixture();
  f.communication_endpoints.push(
    row(2, { channel: "email", status: "active", endpoint_kind: "email" }),
  );
  f.endpoint_ownership_assignments[1].endpoint_id = id(2);
  const r = await run(f);
  assert.equal(r.level, "ready_for_evaluation");
  assert.equal(check(r, "primary_handling"), false);
  for (const fields of [
    { owner_kind: "team", owner_org_unit_id: id(30) },
    { owner_kind: "role", owner_role: "Service manager" },
  ]) {
    const f = fixture();
    Object.assign(f.endpoint_ownership_assignments[0], fields);
    assert.equal((await run(f)).level, "ready_for_chris_shadow");
  }
});
test("missing or invalid confidence blocks shadow; finite scheduled end remains effective", async () => {
  for (const confidence of [null, undefined, NaN, Infinity, -1, 0.49, 1.1, "0.9"]) {
    const f = fixture();
    f.endpoint_ownership_assignments[1].confidence = confidence;
    const r = await run(f);
    assert.equal(r.level, "ready_for_evaluation");
    assert.equal(check(r, "confidence_sufficient"), false);
  }
  const f = fixture();
  f.endpoint_ownership_assignments[0].effective_to = "2026-11-01";
  assert.equal((await run(f)).level, "ready_for_chris_shadow");
});
test("company scope ignores non-tenant settings and unrelated endpoint conflicts", async () => {
  const f = fixture();
  f.operating_profile_entries.push(
    row(51, {
      ...f.operating_profile_entries[0],
      id: id(51),
      scope_kind: "team",
      value: { enabled: false },
    }),
  );
  f.endpoint_ownership_assignments.push(
    row(12, {
      ...f.endpoint_ownership_assignments[0],
      id: id(12),
      endpoint_id: id(999),
      review_state: "conflicted",
    }),
  );
  f.communication_endpoints.push(
    row(2, {
      channel: "phone",
      status: "active",
      endpoint_kind: "ddi",
      effective_from: "2027-01-01",
    }),
  );
  assert.equal((await run(f)).level, "ready_for_chris_shadow");
});
test("duplicate policy versions or tenant settings are unavailable instead of arbitrarily selected", async () => {
  for (const table of ["config_versions", "operating_profile_entries"]) {
    const f = fixture();
    f[table].push({ ...f[table][0], id: id(999) });
    await assert.rejects(run(f), /Ambiguous/);
  }
});
test("all 2503 DDIs and 5006 assignments are read despite a 137-row server cap", async () => {
  const f = fixture();
  f.communication_endpoints = [];
  f.endpoint_ownership_assignments = [];
  for (let n = 1; n <= 2503; n++) {
    f.communication_endpoints.push(
      row(n, { channel: "phone", status: "active", endpoint_kind: "ddi" }),
    );
    for (const [i, role] of ["accountable", "primary_handler"].entries())
      f.endpoint_ownership_assignments.push(
        row(10000 + n * 2 + i, {
          endpoint_id: id(n),
          assignment_role: role,
          review_state: "confirmed",
          confidence: 0.9,
          owner_kind: "person",
          owner_member_id: id(20),
        }),
      );
  }
  const db = database(f);
  const r = await computeSourceReadiness(db, tenant, now);
  assert.equal(r.level, "ready_for_chris_shadow");
  assert.match(r.checks.find((c) => c.key === "ddis_mapped").detail, /2503\/2503/);
  assert.equal(db.calls.filter((c) => c.head).length, 12);
  f.endpoint_ownership_assignments.at(-1).review_state = "proposed";
  assert.equal((await run(f)).level, "ready_for_evaluation");
});
test("failed, truncated, changed or foreign inventories cannot yield a readiness badge", async () => {
  for (const table of Object.keys(fixture())) {
    await assert.rejects(
      computeSourceReadiness(
        database(fixture(), (r, c) =>
          c.table === table ? { ...r, error: { message: "offline" } } : r,
        ),
        tenant,
        now,
      ),
      /could not be read/,
    );
  }
  for (const transform of [
    (r, c) => (!c.head && c.table === "communication_endpoints" ? { ...r, data: [] } : r),
    (r, c) =>
      !c.head && c.table === "communication_endpoints"
        ? { ...r, data: r.data.map((x) => ({ ...x, tenant_id: id(999) })) }
        : r,
    (r, c, calls) =>
      c.head &&
      c.table === "communication_endpoints" &&
      calls.filter((x) => x.head && x.table === c.table).length > 1
        ? { ...r, count: r.count + 1 }
        : r,
  ])
    await assert.rejects(computeSourceReadiness(database(fixture(), transform), tenant, now));
  await assert.rejects(computeSourceReadiness(database(fixture()), "bad", now));
  await assert.rejects(computeSourceReadiness(database(fixture()), tenant, NaN));
});

test("actual operator refresh clears failed readiness and ignores superseded responses", async () => {
  const source = readFileSync(
    new URL("../src/routes/openfolk.$tenantId.tsx", import.meta.url),
    "utf8",
  );
  const body = source
    .split("const fetchAll = useCallback(async () => {")[1]
    .split("}, [tenantId]);")[0];
  const pending = [];
  const values = [];
  const fetchGeneration = { current: 0 };
  const refresh = new Function(
    "getWorkspace",
    "getReadiness",
    "getAudit",
    "fetchGeneration",
    "setReadiness",
    "setWorkspace",
    "setError",
    "setAudit",
    "setLastRefresh",
    "tenantId",
    "return async () => {" + body + "}",
  )(
    async () => ({ ok: true, data: {} }),
    () => new Promise((resolve) => pending.push(resolve)),
    async () => ({ ok: true, data: { entries: [] } }),
    fetchGeneration,
    (v) => values.push(v),
    () => {},
    () => {},
    () => {},
    () => {},
    tenant,
  );
  const first = refresh();
  assert.equal(values.at(-1), null);
  const second = refresh();
  pending[1]({ ok: false, error: { message: "offline" } });
  await second;
  pending[0]({ ok: true, data: { level: "ready_for_chris_shadow" } });
  await first;
  assert.ok(values.every((v) => v === null));
  const third = refresh();
  pending[2]({ ok: true, data: { level: "ready_for_evaluation" } });
  await third;
  assert.equal(values.at(-1).level, "ready_for_evaluation");
  const fourth = refresh();
  pending[3]({ ok: false });
  await fourth;
  assert.equal(values.at(-1), null);
});
