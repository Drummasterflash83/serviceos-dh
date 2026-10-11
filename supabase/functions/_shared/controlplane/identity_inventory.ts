/** Checked current identity evidence. Suggestions stay review-only; no writes. */
import { readOperatorInventory } from "./inventory.ts";
import {
  classifyOperational,
  providerMailboxType,
  suggestIdentity,
  type ReviewDecision,
} from "./identity_resolution.ts";
import { suggestTelephonyIdentity } from "./telephony_identity.ts";
const norm = (v: unknown) =>
  String(v ?? "")
    .trim()
    .toLowerCase();
export async function loadIdentityInventory(
  db: { from(table: string): any },
  tenantId: string,
  now = Date.now(),
) {
  if (!Number.isFinite(now) || Math.abs(now) > 8.64e15)
    throw Error("Invalid identity observation time");
  const cutoff = new Date(now).toISOString();
  const current = (q: any) =>
    q.lte("effective_from", cutoff).or(`effective_to.is.null,effective_to.gt.${cutoff}`);
  const read = (table: string, columns: string, filter?: (q: any) => any) =>
    readOperatorInventory(db, tenantId, table, columns, { label: "identity evidence", filter });
  const [members, endpoints, identities, mailboxes, reviews] = await Promise.all([
    read("team_members", "id,display_name,effective_from,effective_to", current),
    read(
      "communication_endpoints",
      "id,channel,endpoint_kind,normalized_value,display_value,provider,provider_external_ref,metadata,effective_from,effective_to",
      (q) => current(q).eq("status", "active"),
    ),
    read(
      "member_integration_identities",
      "id,team_member_id,provider,identity_kind,primary_login,external_ref,verification_state,effective_from,effective_to",
      (q) => current(q).eq("verification_state", "verified").eq("identity_kind", "user"),
    ),
    read("google_workspace_mailboxes", "id,email_address,mailbox_type,status,display_name"),
    read("endpoint_identity_reviews", "id,endpoint_id,decision,team_member_id,created_at", (q) =>
      q.lte("created_at", cutoff),
    ),
  ]);
  const effective = (r: any) =>
    Date.parse(r.effective_from) <= now &&
    (r.effective_to === null || Date.parse(r.effective_to) > now);
  if (
    [...members, ...endpoints, ...identities].some((r) => !effective(r)) ||
    reviews.some(
      (r) => !Number.isFinite(Date.parse(r.created_at)) || Date.parse(r.created_at) > now,
    )
  )
    throw Error("Identity evidence changed scope during collection");
  reviews.sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id),
  );
  return { members, endpoints, identities, mailboxes, reviews, observedAt: cutoff };
}
export type IdentityInventory = Awaited<ReturnType<typeof loadIdentityInventory>>;
function indexEvidence(h: IdentityInventory) {
  const active = new Set(h.members.map((m) => m.id));
  const links = new Map<string, any[]>();
  for (const i of h.identities) {
    if (!active.has(i.team_member_id)) continue;
    for (const value of new Set([norm(i.primary_login), norm(i.external_ref)].filter(Boolean))) {
      const key = JSON.stringify([norm(i.provider), value]);
      const list = links.get(key) ?? [];
      list.push(i);
      links.set(key, list);
    }
  }
  const reviews = new Map<string, any>();
  for (const r of h.reviews) if (!reviews.has(r.endpoint_id)) reviews.set(r.endpoint_id, r);
  return {
    reviews,
    confirmedFor: (endpoint: any) => {
      const matches = new Map<string, any>();
      for (const value of new Set(
        [norm(endpoint.normalized_value), norm(endpoint.provider_external_ref)].filter(Boolean),
      ))
        for (const i of links.get(
          JSON.stringify([norm(endpoint.provider ?? endpoint.channel), value]),
        ) ?? [])
          matches.set(i.id, i);
      return [...matches.values()];
    },
  };
}
function applyReview<
  T extends {
    suggested_member_id: string | null;
    suggested_kind: string;
    confidence: string;
    evidence: string;
    provenance: string;
    ambiguity: string[];
  },
>(suggestion: T, review: any): T {
  if (!review) return suggestion;
  if (
    review.decision === "confirmed_person" &&
    suggestion.provenance === "member_integration_identities" &&
    suggestion.suggested_member_id === review.team_member_id &&
    !suggestion.ambiguity.length
  )
    return suggestion;
  return {
    ...suggestion,
    suggested_member_id: null,
    suggested_kind: ["shared", "team"].includes(review.decision) ? "shared" : "none",
    confidence: "unresolved",
    evidence:
      review.decision === "confirmed_person"
        ? "Reviewed person does not have a unique current matching identity link — review required"
        : `Latest operator decision: ${review.decision}; review before linking`,
    provenance: "endpoint_identity_reviews",
  };
}
export function buildEmailIdentityResolution(h: IdentityInventory) {
  const indexed = indexEvidence(h);
  const mailboxById = new Map(h.mailboxes.map((m) => [m.id, m]));
  const mailboxesByEmail = new Map<string, any[]>();
  for (const m of h.mailboxes) {
    const address = norm(m.email_address),
      list = mailboxesByEmail.get(address) ?? [];
    list.push(m);
    mailboxesByEmail.set(address, list);
  }

  const members = h.members.map((m) => ({ id: m.id, display_name: m.display_name }));
  const classifications = [];
  const suggestions = [];
  for (const e of h.endpoints.filter((e) => e.channel === "email")) {
    const email = norm(e.normalized_value);
    // Google metadata must not classify a Microsoft/manual endpoint with the same address.
    const matches =
      norm(e.provider) === "google_workspace"
        ? e.provider_external_ref
          ? [mailboxById.get(e.provider_external_ref)].filter(Boolean)
          : (mailboxesByEmail.get(email) ?? [])
        : [];
    const mismatchedMailbox = matches.length === 1 && norm(matches[0].email_address) !== email;
    const mb = matches.length === 1 && !mismatchedMailbox ? matches[0] : null;
    const meta = {
      email,
      mailbox_type:
        mb?.mailbox_type ??
        (e.endpoint_kind === "shared_mailbox"
          ? "shared"
          : e.endpoint_kind === "group_address"
            ? "group"
            : "user"),
      status: mb?.status ?? null,
      display_name: mb?.display_name ?? null,
    };
    const review = indexed.reviews.get(e.id),
      op = classifyOperational(meta, review?.decision as ReviewDecision | undefined);
    classifications.push({
      endpoint_id: e.id,
      email,
      provider_mailbox_type: providerMailboxType(meta),
      operational_class: op.class,
      operational_reviewed: op.reviewed,
      provider_display_name: meta.display_name,
      evidence: op.evidence,
      status: meta.status,
    });
    const confirmed = indexed.confirmedFor(e).map((i) => ({
      ...i,
      // Provider object IDs can identify the governed mailbox when the login differs.
      primary_login:
        e.provider_external_ref && i.external_ref === e.provider_external_ref
          ? email
          : i.primary_login,
    }));
    let suggestion = suggestIdentity(meta, members, confirmed);
    if (matches.length > 1 || mismatchedMailbox)
      suggestion = {
        ...suggestion,
        suggested_member_id: null,
        suggested_kind: "none",
        confidence: "unresolved",
        evidence: mismatchedMailbox
          ? "Provider mailbox reference has a different address — operator review required"
          : "Multiple provider mailbox records match this address — operator review required",
        provenance: "google_workspace_mailboxes",
      };
    suggestions.push({
      ...applyReview(suggestion, review),
      operational_class: op.class,
      endpoint_id: e.id,
    });
  }
  return {
    classifications,
    suggestions,
    reviews: h.reviews.map((r) => ({
      endpoint_id: r.endpoint_id,
      decision: r.decision,
      team_member_id: r.team_member_id ?? null,
      created_at: r.created_at,
    })),
  };
}
export function buildPhoneIdentityResolution(h: IdentityInventory) {
  const indexed = indexEvidence(h);
  const members = h.members.map((m) => ({ id: m.id, display_name: m.display_name }));
  return {
    candidates: h.endpoints
      .filter((e) => e.channel === "phone" && e.endpoint_kind === "extension")
      .map((e) => {
        const metadata = e.metadata ?? {};
        const observed_labels = Array.isArray(metadata.observed_labels)
          ? metadata.observed_labels.filter((v: unknown) => typeof v === "string")
          : [];
        const call_count =
          Number.isSafeInteger(metadata.call_count) && metadata.call_count >= 0
            ? metadata.call_count
            : 0;
        const last_activity =
          typeof metadata.last_activity === "string" &&
          Number.isFinite(Date.parse(metadata.last_activity))
            ? metadata.last_activity
            : null;
        const suggestion = suggestTelephonyIdentity(
          { extension: String(e.normalized_value), observed_labels, call_count, last_activity },
          members,
          indexed.confirmedFor(e),
        );
        return {
          ...applyReview(suggestion, indexed.reviews.get(e.id)),
          endpoint_id: e.id,
          display_value: e.display_value ?? null,
          observed_labels,
          call_count,
          last_activity,
        };
      }),
  };
}
