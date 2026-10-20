/** Local-only validation before an authenticated OpenFolk operator registers
 * an exact reviewed manifest. Server RPC remains the authority for every row.
 */
export type StagedBatchUpload = {
  batch_id: string;
  tenant_id: string;
  connection_id: string;
  kind_map: Record<string, "company" | "person">;
  kind_evidence_sha256: string;
  reason: string;
  items: Array<Record<string, unknown>>;
};

const uuid = (x: unknown): x is string => typeof x === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const hash = (x: unknown): x is string => typeof x === "string" &&
  /^[0-9a-f]{64}$/.test(x);
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);

export function reviewStagedBatchUpload(
  manifestValue: unknown, mapValue: unknown, tenantId: string,
): { manifest: StagedBatchUpload; customers: number; sites: number; jobs: number } | null {
  if (!object(manifestValue) || !object(mapValue) ||
    mapValue.status !== "reviewed_for_registration" ||
    !uuid(manifestValue.batch_id) || manifestValue.tenant_id !== tenantId ||
    !uuid(manifestValue.connection_id) ||
    !hash(manifestValue.kind_evidence_sha256) ||
    manifestValue.kind_evidence_sha256 !== mapValue.kind_evidence_sha256 ||
    !object(manifestValue.kind_map) || !object(mapValue.kind_map) ||
    JSON.stringify(manifestValue.kind_map) !== JSON.stringify(mapValue.kind_map) ||
    !Object.keys(manifestValue.kind_map).length ||
    Object.entries(manifestValue.kind_map).some(([key, value]) =>
      !/^[1-9][0-9]{0,8}$/.test(key) || value !== "company") ||
    typeof manifestValue.reason !== "string" ||
    manifestValue.reason.trim().length < 3 ||
    !Array.isArray(manifestValue.items) ||
    manifestValue.items.length < 1 || manifestValue.items.length > 2000) return null;
  const counts = { customer: 0, site: 0, job: 0 };
  let rank = 0;
  for (const item of manifestValue.items) {
    if (!object(item) || !["customer", "site", "job"].includes(String(item.kind)) ||
      !uuid(item.source_version_id)) return null;
    const next = item.kind === "customer" ? 1 : item.kind === "site" ? 2 : 3;
    if (next < rank) return null;
    rank = next;
    counts[item.kind as keyof typeof counts]++;
  }
  if (!counts.customer || !counts.site || !counts.job) return null;
  return { manifest: manifestValue as StagedBatchUpload,
    customers: counts.customer, sites: counts.site, jobs: counts.job };
}
