import { jobTimingGaps } from "./learn-job-timing.ts";
import {
  readCardCommunications,
  type LearnCommunicationClient,
  type CommunicationScope,
} from "./learn-card-communications.ts";
/** Read-only views of existing canonical records. The caller supplies the user's
 * RLS client; never a service-role client. No new card store or intelligence queue. */
export type LearnCardKind = "customer" | "job" | "member" | "team";
export type Row = Record<string, any>;
export interface LearnReadClient {
  from(table: string): any;
}
export interface LearnCardSearchClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
export const CARD_SEARCH_MAX_LENGTH = 120;
export const CARD_PAGE_SIZE = 24;
const DETAIL_LIMIT = 50;
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const date = (v: unknown, now: number): string | null =>
  typeof v === "string" && Number.isFinite(Date.parse(v)) && Date.parse(v) <= now ? v : null;
const ids = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter(uuid))] : []);
const tables = {
  customer: "customer_cards",
  job: "jobs",
  member: "team_members",
  team: "org_units",
} as const;
const columns = {
  team: "id,tenant_id,name,kind,updated_at",
  customer: "id,tenant_id,title,summary,person_id,company_id,owner_id,updated_at",
  job: "id,tenant_id,title,job_number,status,source_system,verified,updated_at,created_date,completed_date,time_evidence:metadata->learn_business_input->timestamps",
  member:
    "id,tenant_id,display_name,formal_role,org_unit_id,profile_id,confirmed_at,effective_to,updated_at",
} as const;
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
  /** Canonical status from the same scoped job read; verification is separate. */
  jobRecord?: { status: string | null; verified: boolean };
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
      text(kind === "member" ? row.display_name : kind === "team" ? row.name : row.title) ??
      (kind === "job" && text(row.job_number) ? `Job ${row.job_number}` : "Identity needs review"),
    subtitle:
      kind === "member"
        ? text(row.formal_role)
        : kind === "team"
          ? text(row.kind)
          : kind === "job"
            ? text(row.job_number)
            : null,
    recordState:
      kind === "team"
        ? "Stored team group"
        : kind === "member"
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
  if (group && (!["member", "team"].includes(kind) || !uuid(group)))
    throw new Error("Invalid group");
  let q = db.from(tables[kind]).select(columns[kind]).eq("tenant_id", tenant);
  if (kind === "member") q = q.is("effective_to", null);
  if (group) q = q.eq(kind === "team" ? "id" : "org_unit_id", group);
  const result = await rows(
    q
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(page * CARD_PAGE_SIZE, (page + 1) * CARD_PAGE_SIZE),
    tenant,
  );
  if (result.length > CARD_PAGE_SIZE + 1 || new Set(result.map((r) => r.id)).size !== result.length)
    throw new Error("Invalid card page");
  return {
    cards: result.slice(0, CARD_PAGE_SIZE).map((r) => card(r, kind, now)),
    hasMore: result.length > CARD_PAGE_SIZE,
    page,
  };
}

/** Search the complete accessible canonical tables, never just the loaded page.
 * SQL treats punctuation/wildcards literally and retains caller RLS permissions. */
export async function searchLearnCards(
  db: LearnCardSearchClient,
  tenant: string,
  kind: LearnCardKind,
  query: string,
  page = 0,
  now = Date.now(),
  group?: string,
): Promise<LearnCardPage> {
  scope(tenant, kind);
  if (typeof query !== "string") throw Error("Invalid card search");
  const term = query.trim();
  if (
    !term ||
    term.length > CARD_SEARCH_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(term) ||
    !Number.isSafeInteger(page) ||
    page < 0 ||
    page > 10000 ||
    !Number.isFinite(now) ||
    (group && (!["member", "team"].includes(kind) || !uuid(group)))
  )
    throw Error("Invalid card search");
  const { data, error } = await db.rpc("learn_card_search", {
    p_tenant: tenant,
    p_kind: kind,
    p_query: term,
    p_page: page,
    p_group: group || null,
  });
  const r = data as Record<string, any> | null;
  if (
    error ||
    !r ||
    r.version !== "learn-card-search/1" ||
    r.tenantId !== tenant ||
    r.kind !== kind ||
    r.query !== term ||
    r.page !== page ||
    r.groupId !== (group || null) ||
    typeof r.hasMore !== "boolean" ||
    !Array.isArray(r.rows) ||
    r.rows.length > CARD_PAGE_SIZE ||
    (r.hasMore && r.rows.length !== CARD_PAGE_SIZE) ||
    r.rows.some(
      (x: Row) =>
        !x ||
        x.tenant_id !== tenant ||
        !uuid(x.id) ||
        (kind === "member" && (x.effective_to !== null || (group && x.org_unit_id !== group))) ||
        (kind === "team" && group && x.id !== group),
    ) ||
    new Set(r.rows.map((x: Row) => x.id)).size !== r.rows.length
  )
    throw Error("Card search unavailable");
  return { cards: r.rows.map((x: Row) => card(x, kind, now)), hasMore: r.hasMore, page };
}

/** Resolve only a unique, typed identity; a profile UUID is not a member UUID. */
function resolvedReferenceName(value: unknown, members: Row[], teams: Row[]): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Row;
  if (!uuid(r.ref)) return null;
  const isTeam = ["team", "org_unit"].includes(r.kind);
  const matches = (isTeam ? teams : members).filter((m) =>
    isTeam || ["member", "team_member"].includes(r.kind)
      ? m.id === r.ref
      : ["user", "profile"].includes(r.kind) && m.profile_id === r.ref,
  );
  return matches.length === 1 ? text(isTeam ? matches[0].name : matches[0].display_name) : null;
}

export function referenceLabel(value: unknown, members: Row[], teams: Row[] = []): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Row;
  if (!text(r.ref)) return null;
  return (
    resolvedReferenceName(value, members, teams) ??
    (["team", "org_unit"].includes(r.kind) ? "Team name unavailable" : "Owner name unavailable")
  );
}

export function projectLearnDetail(input: {
  tenant: string;
  kind: LearnCardKind;
  record: Row;
  interactions: Row[];
  findings: Row[];
  members: Row[];
  teams?: Row[];
  gaps?: string[];
  moreEvidence?: boolean;
  moreFindings?: boolean;
  now: number;
}): LearnCardDetail {
  const { tenant, kind, record, now } = input;
  scope(tenant, kind, record.id);
  if (
    !Number.isFinite(now) ||
    [
      record,
      ...input.interactions,
      ...input.findings,
      ...input.members,
      ...(input.teams ?? []),
    ].some((r) => r.tenant_id !== tenant)
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
  const gaps = [...(input.gaps ?? []), ...(kind === "job" ? jobTimingGaps(record) : [])];
  const teams =
    kind === "team"
      ? [record, ...(input.teams ?? []).filter((r) => r.id !== record.id)]
      : (input.teams ?? []);
  const labelReference = (ref: unknown) => {
    const label = referenceLabel(ref, input.members, teams);
    if (label && !resolvedReferenceName(ref, input.members, teams))
      gaps.push(
        "Some owner or waiting-on names could not be resolved. These assignments need review.",
      );
    return label;
  };
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
      owner: labelReference(r.accountable_ref) ?? labelReference(r.responsible_ref),
      waitingOn: labelReference(r.waiting_on_ref),
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
    ...(kind === "job"
      ? { jobRecord: { status: text(record.status), verified: record.verified === true } }
      : {}),
    findings,
    evidence,
    gaps: [...new Set(gaps)],
    observedAt: new Date(now).toISOString(),
    validUntil: new Date(now + 60000).toISOString(),
    moreEvidence: input.moreEvidence ?? false,
    moreFindings: input.moreFindings ?? false,
  };
}

/** Bounded drill-down. A failure in one evidence source remains visible while the
 * other reads can still be useful. Never substitute a failed read with a success zero. */
export async function readLearnCardDetail(
  db: LearnReadClient & LearnCommunicationClient,
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
  async function communications(label: string, selection: CommunicationScope) {
    try {
      return await readCardCommunications(db, tenant, selection);
    } catch {
      gaps.push(label);
      return [];
    }
  }
  const findingsQuery = () =>
    db.from("intelligence_objects").select(findingColumns).eq("tenant_id", tenant);
  let direct: Row[] = [],
    findings: Row[] = [];
  if (kind === "member" || kind === "team") {
    // Ownership caches use {kind,ref}, not bare UUIDs. Do not join on display names.
    const refs =
      kind === "team"
        ? [
            { kind: "team", ref: id },
            { kind: "org_unit", ref: id },
          ]
        : [
            { kind: "member", ref: id },
            { kind: "team_member", ref: id },
          ];
    if (kind === "member" && uuid(record.profile_id))
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
      kind === "team"
        ? "These findings cover work explicitly assigned to this team and its linked evidence. Member workload is calculated separately in performance evidence; individual scores are not aggregated."
        : "Timeline covers evidence linked to owned work; it does not establish all of this person's communications.",
    );
  } else {
    const selection: CommunicationScope =
      kind === "job"
        ? { job: id }
        : {
            ...(uuid(record.company_id) ? { company: record.company_id } : {}),
            ...(uuid(record.person_id) ? { person: record.person_id } : {}),
          };
    if (Object.keys(selection).length)
      direct = await communications(
        "Linked communications could not be read. Refresh to try again; if this continues, ask OpenFolk to check the connection and your access.",
        selection,
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
    ? await communications(
        "Some supporting evidence could not be read. Refresh to try again; if this continues, ask OpenFolk to check the connection and your access.",
        { ids: missing.slice(0, DETAIL_LIMIT) },
      )
    : [];
  const ownershipRefs = findings.flatMap((r) => [
    r.accountable_ref,
    r.responsible_ref,
    r.waiting_on_ref,
  ]);
  const refsFor = (kinds: string[]) => [
    ...new Set<string>(
      ownershipRefs.filter((r) => r && kinds.includes(r.kind) && uuid(r.ref)).map((r) => r.ref),
    ),
  ];
  const memberIds = refsFor(["member", "team_member"]);
  const profileIds = refsFor(["user", "profile"]);
  const teamIds = refsFor(["team", "org_unit"]);
  const memberFilter = [
    memberIds.length ? `id.in.(${memberIds.join(",")})` : null,
    profileIds.length ? `profile_id.in.(${profileIds.join(",")})` : null,
  ]
    .filter(Boolean)
    .join(",");
  // At most three references per visible finding. Read a sentinel as well so
  // unexpectedly duplicated profile mappings cannot produce arbitrary attribution.
  const ownerLimit = DETAIL_LIMIT * 3;
  let [members, teams] = await Promise.all([
    memberFilter
      ? optional(
          "Some owner names could not be resolved.",
          db
            .from("team_members")
            .select("id,tenant_id,display_name,profile_id")
            .eq("tenant_id", tenant)
            .or(memberFilter)
            .is("effective_to", null)
            .limit(ownerLimit + 1),
        )
      : Promise.resolve([]),
    teamIds.length
      ? optional(
          "Some team names could not be resolved.",
          db
            .from("org_units")
            .select("id,tenant_id,name")
            .eq("tenant_id", tenant)
            .in("id", teamIds)
            .limit(ownerLimit + 1),
        )
      : Promise.resolve([]),
  ]);
  if (members.length > ownerLimit) {
    gaps.push("Owner name lookup exceeded its limit; assignments need review.");
    members = [];
  }
  if (teams.length > ownerLimit) {
    gaps.push("Team name lookup exceeded its limit; assignments need review.");
    teams = [];
  }
  return projectLearnDetail({
    tenant,
    kind,
    record,
    findings,
    members,
    teams,
    interactions: [...direct.slice(0, DETAIL_LIMIT), ...extra],
    gaps,
    now,
    moreEvidence: direct.length > DETAIL_LIMIT || missing.length > DETAIL_LIMIT,
    moreFindings,
  });
}
