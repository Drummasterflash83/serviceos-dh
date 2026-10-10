import { test } from "node:test";
import assert from "node:assert/strict";
import {
  projectLearnDetail,
  readLearnCardDetail,
  readLearnCards,
  readLearnTeamGroups,
  referenceLabel,
} from "./learn-cards.ts";

const T = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-09T12:00:00Z");
const row = (n: number, extra: Record<string, any> = {}) => ({
  id: id(n),
  tenant_id: T,
  updated_at: "2026-10-09T10:00:00Z",
  ...extra,
});

// In-memory query evaluator tests actual linking behavior and scoping, rather than
// returning the expected answer independently of the filters sent by the reader.
function database(data: Record<string, any[]>, failures: string[] = []) {
  const calls: { table: string; tenant?: string }[] = [];
  return {
    calls,
    async rpc(name: string, args: Record<string, any>) {
      assert.equal(name, "learn_card_communications_read");
      calls.push({ table: name, tenant: args.p_tenant });
      const selected = (data.interactions ?? [])
        .filter(
          (r) =>
            r.tenant_id === args.p_tenant &&
            !["deleted", "removed"].includes(r.status) &&
            (args.p_ids?.includes(r.id) ||
              (args.p_person && r.related_person_id === args.p_person) ||
              (args.p_company && r.related_company_id === args.p_company) ||
              (args.p_job && r.related_job_id === args.p_job)),
        )
        .slice(0, 51)
        .map(({ updated_at, ...r }) => r);
      return failures.includes("interactions")
        ? { data: null, error: { message: "private provider error" } }
        : {
            data: {
              version: "learn-card-communications/1",
              tenant_id: args.p_tenant,
              rows: selected,
            },
            error: null,
          };
    },
    from(table: string) {
      const call = { table, tenant: undefined as string | undefined };
      calls.push(call);
      let list = [...(data[table] ?? [])];
      function simple(expr: string, r: any): boolean {
        const match = /^(\w+)\.(eq|in)\.(.*)$/.exec(expr);
        if (!match) throw new Error(`Unhandled test filter: ${expr}`);
        return match[2] === "eq"
          ? r[match[1]] === match[3]
          : match[3].slice(1, -1).split(",").includes(r[match[1]]);
      }
      function split(expr: string) {
        let depth = 0,
          start = 0;
        const parts: string[] = [];
        for (let i = 0; i < expr.length; i++) {
          if (expr[i] === "(") depth++;
          if (expr[i] === ")") depth--;
          if (expr[i] === "," && depth === 0) {
            parts.push(expr.slice(start, i));
            start = i + 1;
          }
        }
        parts.push(expr.slice(start));
        return parts;
      }
      const q = {
        select() {
          return q;
        },
        eq(k: string, v: unknown) {
          if (k === "tenant_id") call.tenant = String(v);
          list = list.filter((r) => r[k] === v);
          return q;
        },
        is(k: string, v: unknown) {
          list = list.filter((r) => (r[k] ?? null) === v);
          return q;
        },
        or(expr: string) {
          list = list.filter((r) =>
            split(expr).some((p) =>
              p.startsWith("and(")
                ? split(p.slice(4, -1)).every((e) => simple(e, r))
                : simple(p, r),
            ),
          );
          return q;
        },
        overlaps(k: string, values: string[]) {
          list = list.filter((r) => r[k]?.some((v: string) => values.includes(v)));
          return q;
        },
        contains(k: string, value: Record<string, unknown>) {
          list = list.filter((r) =>
            Object.entries(value).every(([field, v]) => r[k]?.[field] === v),
          );
          return q;
        },
        in(k: string, values: string[]) {
          list = list.filter((r) => values.includes(r[k]));
          return q;
        },
        order() {
          return q;
        },
        limit(n: number) {
          list = list.slice(0, n);
          return q;
        },
        range(from: number, to: number) {
          list = list.slice(from, to + 1);
          return q;
        },
        then(resolve: (r: any) => any) {
          return Promise.resolve({
            data: failures.includes(table) ? null : list,
            error: failures.includes(table) ? { message: "private provider error" } : null,
          }).then(resolve);
        },
      };
      return q;
    },
  };
}

test("customer card joins email, phone and Slack evidence and finds the canonical commitment only once", async () => {
  const customer = row(1, { title: "Fixture customer", company_id: id(2) });
  const email = row(3, {
    related_company_id: id(2),
    source_connector_id: "gmail",
    occurred_at: "2026-10-09T09:00:00Z",
    body_preview: "Please call back",
  });
  const call = row(4, {
    related_company_id: id(2),
    source_connector_id: "simwood",
    occurred_at: "2026-10-09T10:00:00Z",
  });
  const slack = row(5, { source_connector_id: "slack", occurred_at: "2026-10-09T11:00:00Z" });
  const member = row(6, { display_name: "Fixture owner" });
  const finding = row(7, {
    subject: "Promised callback",
    status: "waiting",
    deadline: "2026-10-08T12:00:00Z",
    source_interactions: [email.id, call.id, slack.id],
    source_entities: [id(8)],
    accountable_ref: { kind: "member", ref: member.id },
    confidence: 0.8,
  });
  const db = database({
    customer_cards: [customer],
    interactions: [email, call, slack, row(99, { tenant_id: OTHER, related_company_id: id(2) })],
    intelligence_objects: [finding],
    graph_nodes: [row(8, { source_table: "companies", source_id: id(2) })],
    team_members: [member],
  });
  const result = await readLearnCardDetail(db, T, "customer", customer.id, now);
  assert.deepEqual(
    result.evidence.map((e) => e.source),
    ["slack", "simwood", "gmail"],
  );
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].owner, "Fixture owner");
  assert.equal(result.findings[0].overdue, true);
  assert.equal(result.findings[0].evidenceIds.length, 3);
  assert.ok(db.calls.every((c) => c.tenant === T));
});

test("job card uses its canonical job identity rather than another customer's communications", async () => {
  const db = database({
    jobs: [row(1, { title: "Job", verified: true })],
    interactions: [row(2, { related_job_id: id(1) }), row(3, { related_job_id: id(99) })],
  });
  const detail = await readLearnCardDetail(db, T, "job", id(1), now);
  assert.deepEqual(
    detail.evidence.map((e) => e.id),
    [id(2)],
  );
  assert.equal(detail.card.recordState, "Verified job record");
});

test("member card joins typed ownership without conflating people, and includes evidence on their owned work", async () => {
  const db = database({
    team_members: [row(1, { display_name: "Engineer", profile_id: id(2) })],
    intelligence_objects: [
      row(3, { responsible_ref: { kind: "member", ref: id(1) }, source_interactions: [id(4)] }),
      row(5, { responsible_ref: { kind: "company", ref: id(1) }, source_interactions: [id(6)] }),
    ],
    interactions: [row(4), row(6)],
  });
  const detail = await readLearnCardDetail(db, T, "member", id(1), now);
  assert.deepEqual(
    detail.findings.map((f) => f.id),
    [id(3)],
  );
  assert.deepEqual(
    detail.evidence.map((e) => e.id),
    [id(4)],
  );
  assert.match(detail.gaps.join(" "), /does not establish all/);
  assert.equal(
    referenceLabel({ kind: "company", ref: id(1) }, [row(1, { display_name: "Wrong name" })]),
    `company: ${id(1)}`,
  );
});

test("failed evidence reads preserve findings with visible gaps; failures never manufacture empty success", async () => {
  const db = database(
    {
      jobs: [row(1)],
      graph_nodes: [row(2, { source_table: "jobs", source_id: id(1) })],
      intelligence_objects: [row(3, { source_entities: [id(2)], source_interactions: [id(4)] })],
    },
    ["interactions"],
  );
  const detail = await readLearnCardDetail(db, T, "job", id(1), now);
  assert.equal(detail.findings[0].missingEvidence, 1);
  assert.ok(detail.gaps.length > 0);
  assert.ok(!JSON.stringify(detail).includes("private provider error"));
  await assert.rejects(readLearnCards(database({}, ["customer_cards"]), T, "customer"));
});

test("foreign and malformed scopes cannot query, and a foreign response cannot project", async () => {
  const db = database({ customer_cards: [row(1, { tenant_id: OTHER })] });
  await assert.rejects(readLearnCardDetail(db, T, "customer", id(1)));
  const before = db.calls.length;
  await assert.rejects(readLearnCardDetail(db, T, "customer", "1),tenant_id.neq.x"));
  await assert.rejects(readLearnCards(db, T, "constructor" as any));
  assert.equal(db.calls.length, before);
  assert.throws(() =>
    projectLearnDetail({
      tenant: T,
      kind: "customer",
      record: row(1),
      interactions: [row(2, { tenant_id: OTHER })],
      findings: [],
      members: [],
      now,
    }),
  );
});

test("replays deduplicate, deleted evidence stays unavailable, completed work is not overdue, unknown is not zero", () => {
  const interaction = row(2, { occurred_at: "2030-01-01T00:00:00Z", status: "deleted" });
  const finding = row(3, {
    status: "complete",
    deadline: "2026-10-01T00:00:00Z",
    source_interactions: [id(2), id(2)],
    confidence: null,
  });
  const detail = projectLearnDetail({
    tenant: T,
    kind: "job",
    record: row(1),
    interactions: [interaction, interaction],
    findings: [finding, finding],
    members: [],
    now,
  });
  assert.equal(detail.evidence.length, 0);
  assert.equal(detail.findings.length, 1);
  assert.equal(detail.findings[0].overdue, false);
  assert.equal(detail.findings[0].missingEvidence, 1);
  assert.equal(detail.findings[0].confidence, null);
  assert.equal(detail.findings[0].owner, null);
});

test("pagination keeps sentinel rows out of the displayed page and excludes inactive team records", async () => {
  const data = Array.from({ length: 30 }, (_, i) =>
    row(i + 1, { display_name: `Member ${i}`, effective_to: i === 0 ? "2026-10-01" : null }),
  );
  const db = database({ team_members: data });
  const first = await readLearnCards(db, T, "member");
  assert.equal(first.cards.length, 24);
  assert.equal(first.hasMore, true);
  assert.equal(first.cards[0].id, id(2));
  const second = await readLearnCards(db, T, "member", 1);
  assert.equal(second.cards.length, 5);
  assert.equal(second.hasMore, false);
});

test("team groups come from tenant configuration and filter current members only", async () => {
  const db = database({
    org_units: [
      row(1, { name: "Office" }),
      row(2, { name: "Engineers" }),
      row(3, { tenant_id: OTHER, name: "Other company" }),
    ],
    team_members: [
      row(4, { org_unit_id: id(1) }),
      row(5, { org_unit_id: id(2) }),
      row(6, { org_unit_id: id(2), effective_to: "2026-10-01" }),
    ],
  });
  assert.deepEqual(await readLearnTeamGroups(db, T), [
    { id: id(1), name: "Office" },
    { id: id(2), name: "Engineers" },
  ]);
  assert.deepEqual(
    (await readLearnCards(db, T, "member", 0, now, id(2))).cards.map((c) => c.id),
    [id(5)],
  );
  await assert.rejects(readLearnCards(db, T, "member", 0, now, "bad-filter"));
  await assert.rejects(readLearnTeamGroups(database({}, ["org_units"]), T));
  assert.ok(db.calls.every((c) => c.tenant === T));
});

test("team cards read tenant org units, filter one team and keep bounded pagination", async () => {
  const db = database({
    org_units: [
      ...Array.from({ length: 26 }, (_, i) => row(i + 1, { name: `Team ${i}`, kind: "crew" })),
      row(99, { tenant_id: OTHER, name: "Foreign" }),
    ],
  });
  const first = await readLearnCards(db, T, "team", 0, now);
  assert.equal(first.cards.length, 24);
  assert.equal(first.hasMore, true);
  assert.equal(first.cards[0].title, "Team 0");
  assert.equal(first.cards[0].subtitle, "crew");
  assert.equal(first.cards[0].recordState, "Stored team group");
  assert.equal((await readLearnCards(db, T, "team", 1, now)).cards.length, 2);
  assert.deepEqual(
    (await readLearnCards(db, T, "team", 0, now, id(2))).cards.map((c) => c.id),
    [id(2)],
  );
  assert.equal((await readLearnCards(db, T, "team", 0, now, id(99))).cards.length, 0);
  await assert.rejects(readLearnCards(db, T, "team", 0, now, "bad"));
  await assert.rejects(readLearnCards(db, T, "job", 0, now, id(2)));
  await assert.rejects(readLearnCards(database({}, ["org_units"]), T, "team", 0, now));
  assert.ok(db.calls.every((c) => c.tenant === T));
});

test("team detail joins explicit typed team ownership, never current member work or other tenants", async () => {
  const data = {
    org_units: [row(1, { name: "Office", kind: "department" })],
    team_members: [row(2, { display_name: "Person", org_unit_id: id(1) })],
    intelligence_objects: [
      row(3, {
        responsible_ref: { kind: "team", ref: id(1) },
        accountable_ref: { kind: "org_unit", ref: id(1) },
        source_interactions: [id(9)],
      }),
      row(4, { responsible_ref: { kind: "org_unit", ref: id(1) }, source_interactions: [id(10)] }),
      row(5, { responsible_ref: { kind: "member", ref: id(2) }, source_interactions: [id(11)] }),
      row(6, { responsible_ref: { kind: "member", ref: id(1) }, source_interactions: [id(11)] }),
      row(7, { responsible_ref: { kind: "team", ref: id(2) }, source_interactions: [id(11)] }),
      row(8, {
        tenant_id: OTHER,
        responsible_ref: { kind: "team", ref: id(1) },
        source_interactions: [id(11)],
      }),
    ],
    interactions: [row(9), row(10), row(11)],
  };
  const db = database(data);
  const detail = await readLearnCardDetail(db, T, "team", id(1), now);
  assert.deepEqual(
    detail.findings.map((f) => f.id),
    [id(3), id(4)],
  );
  assert.deepEqual(
    detail.evidence.map((e) => e.id),
    [id(9), id(10)],
  );
  assert.ok(detail.findings.every((f) => f.owner === "Office"));
  assert.match(detail.gaps.join(" "), /not aggregated/);
  assert.ok(db.calls.every((c) => c.tenant === T));
  await assert.rejects(readLearnCardDetail(db, T, "team", id(99), now));
  const denied = await readLearnCardDetail(
    database(data, ["intelligence_objects"]),
    T,
    "team",
    id(1),
    now,
  );
  assert.equal(denied.findings.length, 0);
  assert.match(denied.gaps.join(" "), /could not be read/);
});
