// Synthetic records only. Used by the local UI review; never imported by src.
const tenant_id = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(n),
  tenant_id,
  updated_at: new Date(Date.now() - 120000).toISOString(),
  ...extra,
});
const drafts: any[] = [];
export async function saveDraftFixture(args: any) {
  const scope = `${args.p_definition.subjectKind}:${args.p_definition.groupId ?? "all"}`;
  const previous = drafts.find((d) => d.scope_ref === scope);
  if (args.p_expected_version !== (previous?.value.version ?? 0))
    return { data: null, error: { code: "40001" } };
  const value = {
    ...args.p_definition,
    tenantId: tenant_id,
    id: previous?.value.id ?? crypto.randomUUID(),
    version: args.p_expected_version + 1,
    status: "draft",
  };
  drafts.unshift({
    tenant_id,
    scope_kind: "tenant",
    scope_ref: scope,
    namespace: "learn_scorecards",
    value,
  });
  return { data: value, error: null };
}
function records(): Record<string, any[]> {
  const time = new Date(Date.now() - 3600000).toISOString();
  return {
    provider_connections: new URLSearchParams(location.search).get('slack')==='empty'?[]:[row(25,{provider:'slack',status:'configured',revoked_at:null,team_id:'TFIXTURE',team_name:'Synthetic Slack workspace'})],
    operating_profile_entries: drafts,
    customer_cards: [row(1, { title: "Example customer · synthetic", company_id: id(2) })],
    jobs: [
      row(3, {
        title: "Example boiler service · synthetic",
        job_number: "REVIEW-001",
        verified: true,
      }),
    ],
    org_units: [row(4, { name: "Office" }), row(5, { name: "Engineers" })],
    team_members: [
      row(6, {
        display_name: "Example coordinator",
        formal_role: "Office coordinator",
        org_unit_id: id(4),
        effective_to: null,
      }),
      row(7, {
        display_name: "Example engineer",
        formal_role: "Service engineer",
        org_unit_id: id(5),
        effective_to: null,
      }),
    ],
    interactions: [
      row(8, {
        related_company_id: id(2),
        related_job_id: id(3),
        source_connector_id: "gmail",
        source_table: "emails",
        source_id: id(18),
        subject: "Service appointment request",
        body_preview: "Synthetic example: Please confirm a morning visit.",
        occurred_at: time,
      }),
      row(9, {
        related_company_id: id(2),
        related_job_id: id(3),
        source_connector_id: "simwood",
        source_table: "phone_calls",
        source_id: id(19),
        subject: "Customer callback",
        summary: "Synthetic example: the office promised to confirm the appointment.",
        occurred_at: time,
      }),
      row(10, {
        source_connector_id: "slack",
        source_table: "slack_messages",
        source_id: id(20),
        subject: "Engineer availability",
        body_preview: "Synthetic example: waiting for the parts delivery before confirming.",
        occurred_at: time,
      }),
    ],
    intelligence_objects: [
      row(11, {
        object_type: "commitment",
        subject: "Confirm the service appointment",
        status: "waiting",
        accountable_ref: { kind: "member", ref: id(6) },
        waiting_on_ref: { kind: "member", ref: id(7) },
        deadline: new Date(Date.now() - 86400000).toISOString(),
        confidence: 0.82,
        source_interactions: [id(8), id(9), id(10)],
        source_entities: [],
      }),
    ],
    graph_nodes: [],
  };
}
export function cardFixture(table: string) {
  if (!Object.hasOwn(records(), table)) return null;
  let data = records()[table];
  const scenario = new URLSearchParams(location.search).get("cards");
  if (scenario === "empty") data = [];
  const simple = (s: string, r: any) => {
    const m = /^(\w+)\.(eq|in)\.(.*)$/.exec(s);
    if (!m) throw Error("Unsupported fixture filter");
    return m[2] === "eq" ? r[m[1]] === m[3] : m[3].slice(1, -1).split(",").includes(r[m[1]]);
  };
  function split(s: string) {
    let depth = 0,
      start = 0;
    const out: string[] = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "(") depth++;
      if (s[i] === ")") depth--;
      if (s[i] === "," && !depth) {
        out.push(s.slice(start, i));
        start = i + 1;
      }
    }
    return [...out, s.slice(start)];
  }
  const q: any = {
    select: () => q,
    eq: (key: string, value: unknown) => {
      data = data.filter((r) => r[key] === value);
      return q;
    },
    is: (key: string, value: unknown) => {
      data = data.filter((r) => (r[key] ?? null) === value);
      return q;
    },
    or: (s: string) => {
      data = data.filter((r) =>
        split(s).some((p) =>
          p.startsWith("and(") ? split(p.slice(4, -1)).every((c) => simple(c, r)) : simple(p, r),
        ),
      );
      return q;
    },
    in: (key: string, values: unknown[]) => {
      data = data.filter((r) => values.includes(r[key]));
      return q;
    },
    overlaps: (key: string, values: unknown[]) => {
      data = data.filter((r) => r[key]?.some((v: unknown) => values.includes(v)));
      return q;
    },
    contains: (key: string, value: Record<string, unknown>) => {
      data = data.filter((r) => Object.entries(value).every(([k, v]) => r[key]?.[k] === v));
      return q;
    },
    order: () => q,
    limit: (n: number) => {
      data = data.slice(0, n);
      return q;
    },
    range: (a: number, b: number) => {
      data = data.slice(a, b + 1);
      return q;
    },
    then: (resolve: any) =>
      Promise.resolve(
        scenario === "error"
          ? { data: null, error: { message: "Synthetic denied read" } }
          : { data, error: null },
      ).then(resolve),
  };
  return q;
}
