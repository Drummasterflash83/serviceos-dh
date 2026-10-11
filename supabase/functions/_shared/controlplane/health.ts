/** Checked current inventories for operator health; no provider requests or writes. */
import { readOperatorInventory } from "./inventory.ts";
import { providerCapabilities } from "../telephony/capabilities.ts";

export const HEALTH_ENDPOINT_COLUMNS =
  "id,channel,endpoint_kind,normalized_value,display_value,provider,provider_external_ref,is_shared,status,source,updated_at,effective_from,effective_to";
export const HEALTH_OWNERSHIP_COLUMNS =
  "id,endpoint_id,owner_kind,owner_member_id,owner_org_unit_id,owner_role,assignment_role,effective_from,effective_to,confidence,review_state,updated_at";

function effective(row: any, now: number) {
  const from = Date.parse(row.effective_from);
  const to = row.effective_to === null ? Infinity : Date.parse(row.effective_to);
  if (!Number.isFinite(from) || Number.isNaN(to))
    throw Error("Invalid operator health effective dates");
  return from <= now && now < to;
}
export async function loadOperatorHealth(
  db: { from(table: string): any },
  tenantId: string,
  now = Date.now(),
) {
  if (!Number.isFinite(now) || Math.abs(now) > 8.64e15)
    throw Error("Invalid operator health observation time");
  const cutoff = new Date(now).toISOString();
  const read = (table: string, columns: string, current = false) =>
    readOperatorInventory(db, tenantId, table, columns, {
      label: "operator health",
      filter: current
        ? (q) =>
            q.lte("effective_from", cutoff).or(`effective_to.is.null,effective_to.gt.${cutoff}`)
        : undefined,
    });
  const [members, endpoints, identities, ownership, mailboxes, telephony] = await Promise.all([
    read("team_members", "id,effective_from,effective_to"),
    read("communication_endpoints", HEALTH_ENDPOINT_COLUMNS),
    read(
      "member_integration_identities",
      "id,team_member_id,provider,identity_kind,external_ref,display,primary_login,verification_state,effective_from,effective_to",
      true,
    ),
    read("endpoint_ownership_assignments", HEALTH_OWNERSHIP_COLUMNS, true),
    read("google_workspace_mailboxes", "id,email_address,status"),
    read("telephony_inventory", "id,canonical_type,provider,status"),
  ]);
  // Validate dates even for ended records. Filter at a single fixed observation time.
  const activeMembers = members.filter((r) => effective(r, now));
  const activeEndpoints = endpoints.filter((r) => effective(r, now) && r.status === "active");
  if (identities.some((r) => !effective(r, now)) || ownership.some((r) => !effective(r, now)))
    throw Error("Operator health scope changed during collection");
  return {
    members,
    activeMembers,
    endpoints,
    activeEndpoints,
    identities,
    ownership,
    mailboxes,
    telephony,
    observedAt: cutoff,
  };
}
export type OperatorHealthInventory = Awaited<ReturnType<typeof loadOperatorHealth>>;
const accepted = (r: any) => r.review_state === "confirmed";

export function operatorHealthCounts(h: OperatorHealthInventory) {
  const accountable = new Map<string, any[]>();
  const ambiguousIds = new Set(
    h.ownership.filter((o) => o.review_state === "conflicted").map((o) => o.id),
  );
  for (const o of h.ownership.filter((o) => accepted(o) && o.assignment_role === "accountable")) {
    const rows = accountable.get(o.endpoint_id) ?? [];
    rows.push(o);
    accountable.set(o.endpoint_id, rows);
  }
  const mapped = new Set<string>();
  for (const [endpoint, rows] of accountable) {
    if (rows.length === 1) mapped.add(endpoint);
    else for (const row of rows) ambiguousIds.add(row.id);
  }
  return {
    people: h.activeMembers.length,
    endpoints_total: h.activeEndpoints.length,
    endpoints_unmapped: h.activeEndpoints.filter((e) => !mapped.has(e.id)).length,
    identities_unverified: h.identities.filter((i) => i.verification_state !== "verified").length,
    ambiguous_assignments: ambiguousIds.size,
  };
}

export function operatorHealthIssues(h: OperatorHealthInventory) {
  const issues: { kind: string; detail: string; ref: string | null }[] = [];
  const add = (kind: string, detail: string, ref: string | null) =>
    issues.push({ kind, detail, ref });
  const activePeople = new Set(h.activeMembers.map((m) => m.id));
  const activeEndpoints = new Map(h.activeEndpoints.map((e) => [e.id, e]));
  const owners = new Map<string, any[]>();
  const phonePeople = new Set<string>();
  for (const o of h.ownership) {
    if (o.review_state === "rejected") continue;
    if (!activeEndpoints.has(o.endpoint_id)) continue;
    if (!accepted(o)) {
      add(
        "ownership_unconfirmed",
        `Endpoint ownership is ${o.review_state}; operator review required`,
        o.endpoint_id,
      );
      continue;
    }
    const list = owners.get(o.endpoint_id) ?? [];
    list.push(o);
    owners.set(o.endpoint_id, list);
    if (activeEndpoints.get(o.endpoint_id)?.channel === "phone" && o.owner_member_id)
      phonePeople.add(o.owner_member_id);
  }
  // An email login on Slack/Commusoft is not evidence of a confirmed mail account.
  // Match the governed link against an active email endpoint and its provider.
  // cp_review_identity uses channel as provider when an endpoint has no provider.
  const emailPeople = new Set<string>();
  const confirmedEmails = new Set<string>();
  const emailLinks = new Map<string, any[]>();
  const norm = (value: unknown) =>
    String(value ?? "")
      .trim()
      .toLowerCase();
  for (const i of h.identities) {
    if (i.verification_state !== "verified") {
      add("unverified_identity", `${i.provider} ${i.external_ref} unverified`, i.id);
      continue;
    }
    if (i.identity_kind !== "user" || !activePeople.has(i.team_member_id)) continue;
    for (const value of new Set([norm(i.primary_login), norm(i.external_ref)].filter(Boolean))) {
      const key = JSON.stringify([norm(i.provider), value]);
      const list = emailLinks.get(key) ?? [];
      list.push(i);
      emailLinks.set(key, list);
    }
  }
  for (const e of h.activeEndpoints.filter((e) => e.channel === "email")) {
    for (const value of new Set(
      [norm(e.normalized_value), norm(e.provider_external_ref)].filter(Boolean),
    )) {
      const links = emailLinks.get(JSON.stringify([norm(e.provider ?? e.channel), value])) ?? [];
      for (const i of links) {
        confirmedEmails.add(e.id);
        emailPeople.add(i.team_member_id);
      }
    }
  }
  const suspended = new Set(
    h.mailboxes.filter((m) => norm(m.status) === "suspended").map((m) => norm(m.email_address)),
  );
  for (const e of h.activeEndpoints) {
    const assigned = owners.get(e.id) ?? [];
    const accountable = assigned.filter((o) => o.assignment_role === "accountable");
    if (accountable.length > 1)
      add(
        "ambiguous_accountable_ownership",
        `${e.normalized_value} has ${accountable.length} confirmed accountable assignments — review required`,
        e.id,
      );
    if (!accountable.length)
      add(
        "unmapped_endpoint",
        `${e.endpoint_kind} ${e.normalized_value} has no confirmed accountable owner`,
        e.id,
      );
    for (const a of accountable) {
      if (a.owner_member_id && !activePeople.has(a.owner_member_id))
        add(
          "owner_inactive",
          `${e.endpoint_kind} ${e.normalized_value} owned by an inactive member`,
          e.id,
        );
      if (a.confidence != null && a.confidence < 0.5)
        add(
          "low_confidence",
          `${e.endpoint_kind} ${e.normalized_value} owner confidence ${a.confidence}`,
          e.id,
        );
    }
    if (e.channel === "email") {
      if (
        !["shared_mailbox", "group_address"].includes(e.endpoint_kind) &&
        !confirmedEmails.has(e.id)
      )
        add(
          "email_no_confirmed_identity",
          `${e.normalized_value} has no confirmed person identity`,
          e.id,
        );
      if (suspended.has(norm(e.normalized_value)))
        add("suspended_mailbox", `${e.normalized_value} is suspended`, e.id);
    }
    const roles = new Set(assigned.map((o) => o.assignment_role));
    if (!roles.has("cover"))
      add("endpoint_no_cover", `${e.normalized_value} has no confirmed cover`, e.id);
    if (!roles.has("escalation"))
      add("endpoint_no_escalation", `${e.normalized_value} has no confirmed escalation`, e.id);
  }
  for (const m of h.activeMembers) {
    if (!emailPeople.has(m.id))
      add(
        "person_no_email_identity",
        `member ${m.id.slice(0, 8)} has no confirmed email identity`,
        m.id,
      );
    if (!phonePeople.has(m.id))
      add("person_no_phone", `member ${m.id.slice(0, 8)} has no confirmed phone endpoint`, m.id);
  }
  const activeTelephony = h.telephony.filter((r) => r.status === "active");
  const unclassified = activeTelephony.filter((r) => r.canonical_type === "endpoint").length;
  if (unclassified)
    add(
      "unclassified_phone_metadata",
      `${unclassified} provider metadata records not importable as endpoints`,
      null,
    );
  const phoneProviders = new Set([
    ...h.activeEndpoints.filter((e) => e.channel === "phone").map((e) => e.provider),
    ...activeTelephony.map((t) => t.provider),
  ]);
  for (const provider of phoneProviders) {
    const cap = providerCapabilities(provider);
    const gaps = [
      "ddi_discovery",
      "queue_metadata",
      "extension_discovery",
      "device_discovery",
    ] as const;
    const detail = gaps
      .filter((k) => cap.capabilities[k] !== "supported")
      .map((k) => `${k.replaceAll("_", " ")}: ${cap.capabilities[k]}`);
    if (detail.length)
      add("provider_capability_unavailable", `${cap.label}: ${detail.join("; ")}`, null);
  }
  return issues;
}
