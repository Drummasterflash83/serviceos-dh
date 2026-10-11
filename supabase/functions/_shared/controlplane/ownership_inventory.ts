/** Resolve retained ownership evidence without capped reads or cross-company handoffs. */
import { readOperatorInventory } from "./inventory.ts";
import {
  resolveEndpointOwnership,
  type EndpointEvidence,
  type EndpointRow,
  type AssignmentRow,
  type HandoffRow,
} from "./resolver.ts";
const uuid = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(s);
export async function resolveCheckedOwnership(
  db: { from(table: string): any },
  tenantId: string,
  evidence: EndpointEvidence,
  nowMs: number,
  opts: { subjectRef?: string | null; subjectType?: string | null } = {},
) {
  if (
    !uuid(tenantId) ||
    !Number.isFinite(nowMs) ||
    Math.abs(nowMs) > 8.64e15 ||
    typeof evidence?.channel !== "string" ||
    !evidence.channel.trim()
  )
    throw Error("Valid ownership scope and observation time required");
  for (const value of [opts.subjectRef, opts.subjectType])
    if (value != null && (typeof value !== "string" || !value.trim() || value.length > 1000))
      throw Error("Invalid ownership subject");
  const cutoff = new Date(nowMs).toISOString();
  const read = (table: string, columns: string, filter?: (q: any) => any) =>
    readOperatorInventory(db, tenantId, table, columns, { label: "ownership evidence", filter });
  const endpoints = await read(
    "communication_endpoints",
    "id,channel,endpoint_kind,normalized_value,display_value,provider,provider_external_ref,is_shared,status,effective_from,effective_to",
    (q) => q.eq("channel", evidence.channel.trim().toLowerCase()),
  );
  const preliminary = resolveEndpointOwnership({
    evidence,
    endpoints: endpoints as EndpointRow[],
    assignments: [],
    nowMs,
  });
  if (!preliminary.matched) return preliminary;
  const endpointId = preliminary.sourceEndpoint!.id;
  const [assignments, handoffs] = await Promise.all([
    read(
      "endpoint_ownership_assignments",
      "id,endpoint_id,owner_kind,owner_member_id,owner_org_unit_id,owner_role,assignment_role,effective_from,effective_to,confidence,review_state",
      (q) =>
        q
          .eq("endpoint_id", endpointId)
          .lte("effective_from", cutoff)
          .or(`effective_to.is.null,effective_to.gt.${cutoff}`),
    ),
    opts.subjectRef
      ? read(
          "responsibility_handoffs",
          "id,subject_type,subject_ref,to_party,occurred_at,observed_state",
          (q) => {
            let scoped = q.eq("subject_ref", opts.subjectRef).lte("occurred_at", cutoff);
            if (opts.subjectType) scoped = scoped.eq("subject_type", opts.subjectType);
            return scoped;
          },
        )
      : Promise.resolve([]),
  ]);
  if (
    assignments.some((a) => a.endpoint_id !== endpointId) ||
    handoffs.some(
      (h) =>
        h.subject_ref !== opts.subjectRef ||
        (opts.subjectType && h.subject_type !== opts.subjectType),
    )
  )
    throw Error("Ownership evidence changed scope during collection");
  const result = resolveEndpointOwnership({
    evidence,
    endpoints: endpoints as EndpointRow[],
    assignments: assignments as AssignmentRow[],
    handoffs: handoffs as HandoffRow[],
    nowMs,
  });
  // Handoff parties are JSON, without the assignment table's tenant-safe FK.
  // Only the selected dynamic target needs a bounded membership lookup.
  const target = result.likelyCurrentHandler;
  if (
    result.warnings.includes("handler_from_observed_handoff") &&
    target &&
    ["person", "team"].includes(target.kind)
  ) {
    let valid = false;
    if (uuid(target.ref)) {
      let query = db
        .from(target.kind === "person" ? "team_members" : "org_units")
        .select(
          target.kind === "person" ? "id,tenant_id,effective_from,effective_to" : "id,tenant_id",
        )
        .eq("tenant_id", tenantId)
        .eq("id", target.ref);
      if (target.kind === "person")
        query = query
          .lte("effective_from", cutoff)
          .or(`effective_to.is.null,effective_to.gt.${cutoff}`);
      const { data, error } = await query.maybeSingle();
      if (error) throw Error("Handoff target could not be verified");
      valid =
        data?.id === target.ref &&
        data?.tenant_id === tenantId &&
        (target.kind !== "person" ||
          (Date.parse(data.effective_from) <= nowMs &&
            (data.effective_to === null || nowMs < Date.parse(data.effective_to))));
    }
    if (!valid) {
      result.likelyCurrentHandler = null;
      result.warnings = result.warnings.filter((w) => w !== "handler_from_observed_handoff");
      result.warnings.push("unverified_handoff_target");
    }
  }
  return result;
}
