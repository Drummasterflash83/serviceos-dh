export const quickBooksEntities = [
  "Customer",
  "Invoice",
  "Payment",
  "CreditMemo",
  "SalesReceipt",
  "Estimate",
  "Vendor",
  "Bill",
  "BillPayment",
  "Purchase",
  "VendorCredit",
  "Account",
  "Item",
] as const;
export type QuickBooksEntity = (typeof quickBooksEntities)[number];
export interface QuickBooksImportDefinition {
  entities: QuickBooksEntity[];
  pageSize: number;
  minorVersion: number;
  maxRequests: number;
  expiresAt: string;
  reason: string;
  resumeFrom: string | null;
}
export interface QuickBooksImportOverview {
  tenantId: string;
  checkedAt: string;
  enabled: boolean | null;
  learnEnabled: boolean | null;
  runs: {
    id: string;
    connectionId: string;
    definition: QuickBooksImportDefinition;
    state: string;
    entity: string | null;
    entityIndex: number;
    startPosition: number;
    requestsUsed: number;
    maxRequests: number;
    pagesSaved: number;
    recordsObserved: number;
    lastError: string | null;
    expiresAt: string;
    updatedAt: string;
    coverage: "non_atomic_query_traversal";
  }[];
  counts: {
    environment: "sandbox" | "production";
    realmId: string;
    entity: QuickBooksEntity;
    records: number;
    conflictedRecords: number;
    lastObservedAt: string;
  }[];
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown) =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const entity = (v: unknown) => quickBooksEntities.includes(v as QuickBooksEntity);
const flag = (v: unknown) => v === null || typeof v === "boolean";
export function readQuickBooksImports(v: unknown, tenantId: string): QuickBooksImportOverview {
  const invalid = () => {
    throw Error("QuickBooks import status unavailable");
  };
  if (
    !object(v) ||
    v.tenantId !== tenantId ||
    !uuid(tenantId) ||
    !date(v.checkedAt) ||
    !flag(v.enabled) ||
    !flag(v.learnEnabled) ||
    !Array.isArray(v.runs) ||
    !Array.isArray(v.counts)
  )
    return invalid();
  for (const r of v.runs) {
    if (
      !object(r) ||
      !uuid(r.id) ||
      !uuid(r.connectionId) ||
      !["queued", "running", "traversed", "paused", "failed", "limit_reached"].includes(
        String(r.state),
      ) ||
      !(r.entity === null || entity(r.entity)) ||
      r.coverage !== "non_atomic_query_traversal" ||
      ![
        r.entityIndex,
        r.startPosition,
        r.requestsUsed,
        r.maxRequests,
        r.pagesSaved,
        r.recordsObserved,
      ].every(count) ||
      Number(r.requestsUsed) > Number(r.maxRequests) ||
      ![r.expiresAt, r.updatedAt].every(date) ||
      !(r.lastError === null || typeof r.lastError === "string") ||
      !object(r.definition)
    )
      return invalid();
    const d = r.definition;
    if (
      !Array.isArray(d.entities) ||
      !d.entities.length ||
      d.entities.length > 13 ||
      !d.entities.every(entity) ||
      new Set(d.entities).size !== d.entities.length ||
      ![d.pageSize, d.minorVersion, d.maxRequests].every(count) ||
      Number(d.pageSize) < 1 ||
      Number(d.pageSize) > 1000 ||
      Number(d.minorVersion) < 1 ||
      Number(d.minorVersion) > 1000 ||
      Number(d.maxRequests) < 1 ||
      Number(d.maxRequests) > 10000 ||
      typeof d.reason !== "string" ||
      !date(d.expiresAt) ||
      !(d.resumeFrom === null || uuid(d.resumeFrom))
    )
      return invalid();
  }
  for (const c of v.counts)
    if (
      !object(c) ||
      !["sandbox", "production"].includes(String(c.environment)) ||
      typeof c.realmId !== "string" ||
      !/^[1-9][0-9]{0,29}$/.test(c.realmId) ||
      !entity(c.entity) ||
      !count(c.records) ||
      !count(c.conflictedRecords) ||
      Number(c.conflictedRecords) > Number(c.records) ||
      !date(c.lastObservedAt)
    )
      return invalid();
  return v as unknown as QuickBooksImportOverview;
}
export const quickBooksImportState: Record<string, string> = {
  queued: "Waiting for next capture",
  running: "Capturing a page",
  traversed: "Requested pages captured",
  paused: "Paused",
  failed: "Needs attention",
  limit_reached: "Request limit reached",
};
