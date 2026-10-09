/** Read-only views of existing canonical records. The caller supplies the user's
 * RLS client; never a service-role client. No new card store or intelligence queue. */
export type LearnCardKind = "customer" | "job" | "member";
export type Row = Record<string, any>;
export interface LearnReadClient {
  from(table: string): any;
}
export const CARD_PAGE_SIZE = 24;
const DETAIL_LIMIT = 50;
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const date = (v: unknown, now: number): string | null =>
  typeof v === "string" && Number.isFinite(Date.parse(v)) && Date.parse(v) <= now ? v : null;
const ids = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter(uuid))] : []);
const tables = { customer: "customer_cards", job: "jobs", member: "team_members" } as const;
const columns = {
  customer: "id,tenant_id,title,summary,person_id,company_id,owner_id,updated_at",
  job: "id,tenant_id,title,job_number,status,source_system,verified,updated_at",
  member:
    "id,tenant_id,display_name,formal_role,org_unit_id,profile_id,confirmed_at,effective_to,updated_at",
} as const;
const interactionColumns =
  "id,tenant_id,source_connector_id,source_type,source_table,source_id,occurred_at,subject,summary,body_preview,status,related_person_id,related_company_id,related_job_id";
const findingColumns =
  "id,tenant_id,object_type,subject,status,deadline,responsible_ref,accountable_ref,waiting_on_ref,confidence,source_interactions,source_entities,attributes,created_at,updated_at";

export interface LearnCard {
  id: string;
  kind: LearnCardKind;
  title: string;
  subtitle: string | null;
  recordState: string;
  updatedAt: string | null;
}
export interface LearnCardPage {
  cards: LearnCard[];
  hasMore: boolean;
  page: number;
}
export interface LearnTeamGroup {
  id: string;
  name: string;
}
export async function readLearnTeamGroups(
  db: LearnReadClient,
  tenant: string,
): Promise<LearnTeamGroup[]> {
  scope(tenant, "member");
  const result = await rows(
    db
      .from("org_units")
      .select("id,tenant_id,name")
      .eq("tenant_id", tenant)
      .order("name", { ascending: true })
      .limit(201),
    tenant,
  );
  if (result.length > 200) throw new Error("Team group list exceeds the current window");
  return result.map((r) => ({ id: r.id, name: text(r.name) ?? "Unnamed group" }));
}
export interface LearnEvidence {
  id: string;
  source: string;
  sourceTable: string | null;
  sourceId: string | null;
  occurredAt: string | null;
  title: string;
  summary: string | null;
  excerpt: string | null;
}
export interface LearnFinding {
  id: string;
  title: string;
  type: string;
  status: string;
  owner: string | null;
  waitingOn: string | null;
  deadline: string | null;
  overdue: boolean;
  confidence: number | null;
  evidenceIds: string[];
  missingEvidence: number;
}
export interface LearnCardDetail {
  card: LearnCard;
  findings: LearnFinding[];
  evidence: LearnEvidence[];
  gaps: string[];
  observedAt: string;
  validUntil: string;
  /** Bounds describe this read, not complete provider coverage. */
  moreEvidence: boolean;
  moreFindings: boolean;
}

function scope(tenant: string, kind: LearnCardKind, id?: string) {
  if (!uuid(tenant) || !Object.hasOwn(tables, kind) || (id !== undefined && !uuid(id)))
    throw new Error("Invalid card scope");
}
async function rows(query: PromiseLike<any>, tenant: string): Promise<Row[]> {
  const result = await query;
  if (result.error || !Array.isArray(result.data)) throw new Error("Card data unavailable");
  if (result.data.some((r: Row) => !r || r.tenant_id !== tenant || !uuid(r.id)))
    throw new Error("Invalid card response");
  return result.data;
}
function card(row: Row, kind: LearnCardKind, now: number): LearnCard {
  return {
    id: row.id,
    kind,
    title:
      text(kind === "member" ? row.display_name : row.title) ??
      (kind === "job" && text(row.job_number) ? `Job ${row.job_number}` : "Identity needs review"),
    subtitle:
      kind === "member" ? text(row.formal_role) : kind === "job" ? text(row.job_number) : null,
    recordState:
      kind === "member"
        ? row.confirmed_at
          ? "Confirmed team record"
          : "Team identity needs review"
        : kind === "job"
          ? row.verified
            ? "Verified job record"
            : "Job record needs review"
          : "Stored customer record",
    updatedAt: date(row.updated_at, now),
  };
}
export async function readLearnCards(
  db: LearnReadClient,
  tenant: string,
  kind: LearnCardKind,
  page = 0,
  now = Date.now(),
  group?: string,
): Promise<LearnCardPage> {
  scope(tenant, kind);
  if (!Number.isSafeInteger(page) || page < 0 || page > 10000) throw new Error("Invalid page");
  if (group && (kind !== "member" || !uuid(group))) throw new Error("Invalid group");
  let q = db.from(tables[kind]).select(columns[kind]).eq("tenant_id", tenant);
  if (kind === "member") q = q.is("effective_to", null);
  if (group) q = q.eq("org_unit_id", group);
  const result = await rows(
    q
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(page * CARD_PAGE_SIZE, (page + 1) * CARD_PAGE_SIZE),
    tenant,
  );
  return {
    cards: result.slice(0, CARD_PAGE_SIZE).map((r) => card(r, kind, now)),
    hasMore: result.length > CARD_PAGE_SIZE,
    page,
  };
}

/** References are typed: a profile UUID is not a team-member UUID. */
export function referenceLabel(value: unknown, members: Row[]): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Row;
  if (!text(r.ref)) return null;
  const match = members.find((m) =>
    r.kind === "member" || r.kind === "team_member"
      ? m.id === r.ref
      : r.kind === "user" || r.kind === "profile"
        ? m.profile_id === r.ref
        : false,
  );
  return text(match?.display_name) ?? `${text(r.kind) ?? "Reference"}: ${r.ref}`;
}

export function projectLearnDetail(input: {
  tenant: string;
  kind: LearnCardKind;
  record: Row;
  interactions: Row[];
  findings: Row[];
  members: Row[];
  gaps?: string[];
  moreEvidence?: boolean;
  moreFindings?: boolean;
  now: number;
}): LearnCardDetail {
  const { tenant, kind, record, now } = input;
  scope(tenant, kind, record.id);
  if (
    !Number.isFinite(now) ||
    [record, ...input.interactions, ...input.findings, ...input.members].some(
      (r) => r.tenant_id !== tenant,
    )
  )
    throw new Error("Invalid card scope");
  const evidence = [
    ...new Map(
      input.interactions
        .filter((r) => !["deleted", "removed"].includes(r.status))
        .map((r) => [r.id, r]),
    ).values(),
  ]
    .map((r) => ({
      id: r.id,
      source: text(r.source_connector_id) ?? text(r.source_type) ?? "Unknown source",
      sourceTable: text(r.source_table),
      sourceId: text(r.source_id),
      occurredAt: date(r.occurred_at, now),
      title: text(r.subject) ?? "Communication",
      summary: text(r.summary),
      excerpt: text(r.body_preview),
    }))
    .sort((a, b) => (Date.parse(b.occurredAt ?? "") || 0) - (Date.parse(a.occurredAt ?? "") || 0));
  const visible = new Set(evidence.map((e) => e.id));
  const terminal = new Set(["complete", "completed", "cancelled", "resolved", "closed", "done"]);
  const findings = [
    ...new Map(
      input.findings.filter((r) => r.attributes?.verification !== true).map((r) => [r.id, r]),
    ).values(),
  ].map((r) => {
    const refs = ids(r.source_interactions);
    const deadline =
      typeof r.deadline === "string" && Number.isFinite(Date.parse(r.deadline)) ? r.deadline : null;
    return {
      id: r.id,
      title: text(r.subject) ?? "Finding needs review",
      type: text(r.object_type) ?? "Finding",
      status: text(r.status) ?? "unknown",
      owner:
        referenceLabel(r.accountable_ref, input.members) ??
        referenceLabel(r.responsible_ref, input.members),
      waitingOn: referenceLabel(r.waiting_on_ref, input.members),
      deadline,
      overdue: !!deadline && Date.parse(deadline) < now && !terminal.has(r.status),
      confidence:
        typeof r.confidence === "number" && r.confidence >= 0 && r.confidence <= 1
          ? r.confidence
          : null,
      evidenceIds: refs.filter((id) => visible.has(id)),
      missingEvidence: refs.filter((id) => !visible.has(id)).length,
    };
  });
  return {
    card: card(record, kind, now),
    findings,
    evidence,
    gaps: [...new Set(input.gaps ?? [])],
    observedAt: new Date(now).toISOString(),
    validUntil: new Date(now + 60000).toISOString(),
    moreEvidence: input.moreEvidence ?? false,
    moreFindings: input.moreFindings ?? false,
  };
}

/** Bounded drill-down. A failure in one evidence source remains visible while the
 * other reads can still be useful. Never substitute a failed read with a success zero. */
export async function readLearnCardDetail(
  db: LearnReadClient,
  tenant: string,
  kind: LearnCardKind,
  id: string,
  now = Date.now(),
): Promise<LearnCardDetail> {
  scope(tenant, kind, id);
  const records = await rows(
    db.from(tables[kind]).select(columns[kind]).eq("tenant_id", tenant).eq("id", id).limit(1),
    tenant,
  );
  if (records.length !== 1) throw new Error("Card not available");
  const record = records[0],
    gaps: string[] = [];
  async function optional(label: string, query: PromiseLike<any>) {
    try {
      return await rows(query, tenant);
    } catch {
      gaps.push(label);
      return [];
    }
  }
  const interactionsQuery = () =>
    db.from("interactions").select(interactionColumns).eq("tenant_id", tenant);
  const findingsQuery = () =>
    db.from("intelligence_objects").select(findingColumns).eq("tenant_id", tenant);
  let direct: Row[] = [],
    findings: Row[] = [];
  if (kind === "member") {
    // Ownership caches use {kind,ref}, not bare UUIDs. Do not join on display names.
    const refs = [
      { kind: "member", ref: id },
      { kind: "team_member", ref: id },
    ];
    if (uuid(record.profile_id))
      refs.push(
        { kind: "user", ref: record.profile_id },
        { kind: "profile", ref: record.profile_id },
      );
    const batches = await Promise.all(
      refs.flatMap((ref) =>
        ["accountable_ref", "responsible_ref"].map((field) =>
          optional(
            "Some owned work could not be read.",
            findingsQuery()
              .contains(field, ref)
              .order("updated_at", { ascending: false })
              .limit(DETAIL_LIMIT + 1),
          ),
        ),
      ),
    );
    findings = batches.flat();
    gaps.push(
      "Timeline covers evidence linked to owned work; it does not establish all of this person's communications.",
    );
  } else {
    const filters: string[] = [];
    if (kind === "job") filters.push(`related_job_id.eq.${id}`);
    if (kind === "customer" && uuid(record.company_id))
      filters.push(`related_company_id.eq.${record.company_id}`);
    if (kind === "customer" && uuid(record.person_id))
      filters.push(`related_person_id.eq.${record.person_id}`);
    if (filters.length)
      direct = await optional(
        "Linked communications could not be read.",
        interactionsQuery()
          .or(filters.join(","))
          .order("occurred_at", { ascending: false })
          .order("id", { ascending: true })
          .limit(DETAIL_LIMIT + 1),
      );
    else gaps.push("This customer has no canonical person or company link yet.");
    const graphFilters = [`and(source_table.eq.${tables[kind]},source_id.eq.${id})`];
    if (kind === "customer" && uuid(record.company_id))
      graphFilters.push(`and(source_table.eq.companies,source_id.eq.${record.company_id})`);
    if (kind === "customer" && uuid(record.person_id))
      graphFilters.push(`and(source_table.eq.people,source_id.eq.${record.person_id})`);
    const nodes = await optional(
      "Business-graph links could not be read.",
      db
        .from("graph_nodes")
        .select("id,tenant_id")
        .eq("tenant_id", tenant)
        .or(graphFilters.join(","))
        .limit(DETAIL_LIMIT + 1),
    );
    if (nodes.length > DETAIL_LIMIT) gaps.push("Additional graph links are outside this read.");
    const batches = await Promise.all([
      direct.length
        ? optional(
            "Findings linked to communications could not be read.",
            findingsQuery()
              .overlaps(
                "source_interactions",
                direct.slice(0, DETAIL_LIMIT).map((r) => r.id),
              )
              .order("updated_at", { ascending: false })
              .limit(DETAIL_LIMIT + 1),
          )
        : Promise.resolve([]),
      nodes.length
        ? optional(
            "Findings linked to this record could not be read.",
            findingsQuery()
              .overlaps(
                "source_entities",
                nodes.slice(0, DETAIL_LIMIT).map((r) => r.id),
              )
              .order("updated_at", { ascending: false })
              .limit(DETAIL_LIMIT + 1),
          )
        : Promise.resolve([]),
    ]);
    findings = batches.flat();
  }
  findings = [...new Map(findings.map((r) => [r.id, r])).values()].sort(
    (a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0),
  );
  const moreFindings = findings.length > DETAIL_LIMIT;
  findings = findings.slice(0, DETAIL_LIMIT);
  const linkedIds = [...new Set(findings.flatMap((r) => ids(r.source_interactions)))];
  const directIds = new Set(direct.slice(0, DETAIL_LIMIT).map((r) => r.id));
  const missing = linkedIds.filter((id) => !directIds.has(id));
  const extra = missing.length
    ? await optional(
        "Some supporting evidence could not be read.",
        interactionsQuery().in("id", missing.slice(0, DETAIL_LIMIT)).limit(DETAIL_LIMIT),
      )
    : [];
  const memberRefs = [
    ...new Set(
      findings
        .flatMap((r) => [r.accountable_ref?.ref, r.responsible_ref?.ref, r.waiting_on_ref?.ref])
        .filter(uuid),
    ),
  ];
  const members = memberRefs.length
    ? await optional(
        "Some owner names could not be resolved.",
        db
          .from("team_members")
          .select("id,tenant_id,display_name,profile_id")
          .eq("tenant_id", tenant)
          .or(`id.in.(${memberRefs.join(",")}),profile_id.in.(${memberRefs.join(",")})`)
          .is("effective_to", null)
          .limit(DETAIL_LIMIT + 1),
      )
    : [];
  return projectLearnDetail({
    tenant,
    kind,
    record,
    findings,
    members,
    interactions: [...direct.slice(0, DETAIL_LIMIT), ...extra],
    gaps,
    now,
    moreEvidence: direct.length > DETAIL_LIMIT || missing.length > DETAIL_LIMIT,
    moreFindings,
  });
}
