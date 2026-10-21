export type OpenIdentityRow = {
  externalId: string;
  status: "on_hold" | "pending" | "open";
  sourceVersionId: string;
  sourceObservedAt: string;
  propertyExternalId: string | null;
  customerExternalId: string | null;
  candidateState: "ready" | "review";
  holdReason: string | null;
  suggestedSiteId: string | null;
  suggestedCustomerId: string | null;
};

export type OpenIdentityPage = {
  rows: OpenIdentityRow[];
  totalUnlinked: number;
  nextCursor: string | null;
  observedAt: string;
  snapshotAt: string;
  auditId: string;
};

export type AttentionIdentityGroup = {
  key: string;
  customerExternalId: string | null;
  jobs: OpenIdentityRow[];
};
export type AttentionIdentityGroups = {
  groups: AttentionIdentityGroup[];
  jobs: number;
  snapshotAt: string;
  totalUnlinked: number;
};

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const sourceId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value);
const instant = (value: unknown): value is string =>
  typeof value === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const reasonCode = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z_]{0,79}$/.test(value);
const unavailable = () => Error("Open-job identity review could not be verified.");
const ranks = { on_hold: 0, pending: 1, open: 2 } as const;

/** The server chooses the current source version and candidate; the browser only displays it. */
export function readOpenIdentityPage(raw: unknown, scope: {
  tenant: string; connection: string; actor: string;
}, now = Date.now()): OpenIdentityPage {
  if (!object(raw) || raw.version !== "new-dawn-open-identity-review/1" ||
    raw.tenant_id !== scope.tenant || raw.connection_id !== scope.connection ||
    raw.actor_id !== scope.actor || !uuid(raw.audit_id) ||
    !instant(raw.observed_at) || !instant(raw.snapshot_at) ||
    Math.abs(now - Date.parse(raw.observed_at)) > 120_000 ||
    !Number.isInteger(raw.total_unlinked) || (raw.total_unlinked as number) < 0 ||
    !Array.isArray(raw.rows) || raw.rows.length > 40 ||
    !(raw.next_cursor === null || (typeof raw.next_cursor === "string" &&
      raw.next_cursor.length <= 512 && /^[A-Za-z\d+/]+=*$/.test(raw.next_cursor)))) throw unavailable();

  const rows: OpenIdentityRow[] = [];
  let previousRank = -1;
  let previousId = "";
  for (const value of raw.rows) {
    if (!object(value) || !sourceId(value.external_id) ||
      !["on_hold", "pending", "open"].includes(String(value.status)) ||
      !uuid(value.source_version_id) || !instant(value.source_observed_at) ||
      !(value.property_external_id === null || sourceId(value.property_external_id)) ||
      !(value.customer_external_id === null || sourceId(value.customer_external_id)) ||
      !["ready", "review"].includes(String(value.candidate_state)) ||
      !(value.hold_reason === null || reasonCode(value.hold_reason)) ||
      !(value.suggested_site_id === null || uuid(value.suggested_site_id)) ||
      !(value.suggested_customer_id === null || uuid(value.suggested_customer_id)) ||
      (value.candidate_state === "ready" && (value.hold_reason !== null ||
        !uuid(value.suggested_site_id) || !uuid(value.suggested_customer_id))) ||
      (value.candidate_state === "review" && (value.hold_reason === null ||
        value.suggested_site_id !== null || value.suggested_customer_id !== null))) throw unavailable();
    const rank = ranks[value.status as keyof typeof ranks];
    if (rank < previousRank || (rank === previousRank &&
      String(value.external_id) <= previousId)) throw unavailable();
    previousRank = rank;
    previousId = String(value.external_id);
    rows.push({
      externalId: value.external_id as string,
      status: value.status as OpenIdentityRow["status"],
      sourceVersionId: value.source_version_id as string,
      sourceObservedAt: value.source_observed_at as string,
      propertyExternalId: value.property_external_id as string | null,
      customerExternalId: value.customer_external_id as string | null,
      candidateState: value.candidate_state as OpenIdentityRow["candidateState"],
      holdReason: value.hold_reason as string | null,
      suggestedSiteId: value.suggested_site_id as string | null,
      suggestedCustomerId: value.suggested_customer_id as string | null,
    });
  }
  if (rows.length > (raw.total_unlinked as number) ||
    (raw.next_cursor !== null && rows.length === 0)) throw unavailable();
  return { rows, totalUnlinked: raw.total_unlinked as number,
    nextCursor: raw.next_cursor as string | null,
    observedAt: raw.observed_at as string, snapshotAt: raw.snapshot_at as string,
    auditId: raw.audit_id as string };
}

/** Complete the saved attention prefix before grouping; never show a partial
 * group list as the full workload. The cursor pins one server snapshot. */
export async function loadAttentionIdentityGroups(
  load: (cursor: string | null) => Promise<OpenIdentityPage>,
): Promise<AttentionIdentityGroups> {
  const groups = new Map<string, AttentionIdentityGroup>();
  const seenJobs = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let snapshotAt: string | null = null;
  let totalUnlinked: number | null = null;
  let jobs = 0;
  let previousRank = -1;
  let previousExternal = "";
  const complete = (): AttentionIdentityGroups => ({
    groups: [...groups.values()].sort((a, b) => {
      const heldA = a.jobs.filter(job => job.status === "on_hold").length;
      const heldB = b.jobs.filter(job => job.status === "on_hold").length;
      return heldB - heldA || b.jobs.length - a.jobs.length || a.key.localeCompare(b.key);
    }),
    jobs, snapshotAt: snapshotAt!, totalUnlinked: totalUnlinked!,
  });
  for (let pageIndex = 0; pageIndex < 6; pageIndex++) {
    const page = await load(cursor);
    if (snapshotAt !== null && (snapshotAt !== page.snapshotAt ||
      totalUnlinked !== page.totalUnlinked)) throw unavailable();
    snapshotAt ??= page.snapshotAt;
    totalUnlinked ??= page.totalUnlinked;
    for (const row of page.rows) {
      const rank = ranks[row.status];
      if (rank < previousRank || (rank === previousRank &&
        row.externalId <= previousExternal)) throw unavailable();
      previousRank = rank;
      previousExternal = row.externalId;
      if (row.status === "open") return complete();
      const jobKey = `${row.externalId}:${row.sourceVersionId}`;
      if (seenJobs.has(jobKey)) throw unavailable();
      seenJobs.add(jobKey);
      const key = row.customerExternalId
        ? `customer:${row.customerExternalId}` : `job:${jobKey}`;
      const group = groups.get(key) ?? { key, customerExternalId: row.customerExternalId, jobs: [] };
      group.jobs.push(row);
      groups.set(key, group);
      jobs++;
      if (jobs > totalUnlinked) throw unavailable();
    }
    if (page.nextCursor === null) return complete();
    if (!page.rows.length || seenCursors.has(page.nextCursor)) throw unavailable();
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw unavailable();
}

export async function loadOpenIdentityPage(
  db: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> },
  scope: { tenant: string; connection: string; actor: string; reason: string; cursor: string | null },
): Promise<OpenIdentityPage> {
  if (![scope.tenant, scope.connection, scope.actor].every(uuid) ||
    scope.reason.trim().length < 3 || scope.reason.trim().length > 500 ||
    !(scope.cursor === null || (scope.cursor.length <= 512 &&
      /^[A-Za-z\d+/]+=*$/.test(scope.cursor)))) throw unavailable();
  const { data, error } = await db.rpc("new_dawn_open_identity_review_page", {
    p_tenant: scope.tenant, p_connection: scope.connection, p_reason: scope.reason.trim(),
    p_cursor: scope.cursor, p_limit: 25,
  });
  if (error) throw unavailable();
  return readOpenIdentityPage(data, scope);
}
