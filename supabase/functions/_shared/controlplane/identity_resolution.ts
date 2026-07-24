// ServiceOS — OpenFolk Control Plane: identity resolution (pure, review-only).
//
// STRICT SEPARATION (the core invariant of this module):
//   • An identity LINK says "this email/extension/DDI represents this person/team".
//   • Operational OWNERSHIP says "this person is accountable for activity on this endpoint".
// This module ONLY proposes identity links. It never creates ownership, and it never
// auto-confirms: every suggestion is a review item with confidence + evidence. A weak
// fuzzy name match is NEVER sufficient — matches are exact and de-duplicated for ambiguity.

export type MailboxClass =
  | "personal"
  | "shared"
  | "group"
  | "service"
  | "suspended"
  | "unknown";

export interface MailboxMeta {
  email: string;
  mailbox_type?: string | null; // provider: user | shared | group | ...
  status?: string | null; // provider: active | suspended | ...
}

/**
 * Classify a mailbox from PROVIDER metadata + address shape — never from the local part
 * alone (e.g. "mark@" is a person, not a "marketing" service). Suspended wins (a suspended
 * shared box is still operationally suspended).
 */
export function classifyMailbox(m: MailboxMeta): { class: MailboxClass; evidence: string } {
  const status = (m.status ?? "").toLowerCase();
  if (status === "suspended" || status === "inactive")
    return { class: "suspended", evidence: `provider status=${m.status}` };
  const t = (m.mailbox_type ?? "").toLowerCase();
  if (t === "shared") return { class: "shared", evidence: "provider mailbox_type=shared" };
  if (t === "group" || t === "distribution")
    return { class: "group", evidence: `provider mailbox_type=${m.mailbox_type}` };
  if (t === "service" || t === "system")
    return { class: "service", evidence: `provider mailbox_type=${m.mailbox_type}` };
  if (t === "user") return { class: "personal", evidence: "provider mailbox_type=user" };
  return { class: "unknown", evidence: "no provider classification" };
}

export type Confidence = "high" | "medium" | "low" | "unresolved";

export interface SuggestMember {
  id: string;
  display_name: string;
}
export interface ConfirmedIdentity {
  team_member_id: string;
  primary_login?: string | null;
  external_ref?: string | null;
}

export interface IdentitySuggestion {
  endpoint_email: string;
  mailbox_class: MailboxClass;
  suggested_member_id: string | null;
  suggested_kind: "person" | "shared" | "none";
  confidence: Confidence;
  evidence: string;
  provenance: string;
  ambiguity: string[]; // other candidate member ids, when the match is not unique
}

/** local part of an email, lowercased. */
export function localPart(email: string): string {
  const at = email.indexOf("@");
  return (at === -1 ? email : email.slice(0, at)).trim().toLowerCase();
}

/** Normalise a display name to comparable tokens (["julie"], ["mary","smith"]). */
export function nameTokens(display: string): string[] {
  return display
    .toLowerCase()
    .replace(/[^a-z\s.'-]/g, " ")
    .split(/[\s.'-]+/)
    .filter(Boolean);
}

/**
 * PURE identity suggestion for one email endpoint. Exact evidence only:
 *   • already-confirmed link on this exact address  → high (already known)
 *   • local part == "first.last" / "flast" / "firstlast", unique member → high
 *   • local part == a member's FIRST name, unique member              → medium
 *   • non-personal mailbox (shared/group/service/suspended)           → shared/unresolved
 *   • ambiguous (>1 member matches) or no match                       → unresolved
 * NEVER returns a "confirmed" result — the operator must review.
 */
export function suggestIdentity(
  mailbox: MailboxMeta,
  members: SuggestMember[],
  confirmed: ConfirmedIdentity[],
): IdentitySuggestion {
  const email = mailbox.email.trim().toLowerCase();
  const cls = classifyMailbox(mailbox).class;
  const base: IdentitySuggestion = {
    endpoint_email: email,
    mailbox_class: cls,
    suggested_member_id: null,
    suggested_kind: "none",
    confidence: "unresolved",
    evidence: "",
    provenance: "identity-resolver",
    ambiguity: [],
  };

  // Already confirmed for this address → surface as high (known), not a new claim.
  const known = confirmed.find(
    (c) => (c.primary_login ?? c.external_ref ?? "").toLowerCase() === email,
  );
  if (known)
    return {
      ...base,
      suggested_member_id: known.team_member_id,
      suggested_kind: "person",
      confidence: "high",
      evidence: "existing confirmed identity link on this exact address",
      provenance: "member_integration_identities",
    };

  // Non-personal mailboxes are never auto-attributed to an individual.
  if (cls === "shared" || cls === "group" || cls === "service")
    return {
      ...base,
      suggested_kind: "shared",
      confidence: "unresolved",
      evidence: `${cls} mailbox — configure a team/shared owner, not an individual`,
    };
  if (cls === "suspended")
    return { ...base, evidence: "suspended mailbox — review before linking" };

  const lp = localPart(email);
  const lpTokens = lp.split(/[._-]+/).filter(Boolean);

  const strong: string[] = []; // first.last style
  const weak: string[] = []; // first-name-only
  for (const m of members) {
    const tk = nameTokens(m.display_name);
    if (tk.length === 0) continue;
    const first = tk[0];
    const last = tk[tk.length - 1];
    const firstLastForms = new Set(
      [
        `${first}.${last}`,
        `${first}${last}`,
        `${first[0]}${last}`,
        `${first}.${last[0]}`,
      ].filter((s) => s.length > 2),
    );
    if (tk.length >= 2 && (firstLastForms.has(lp) || (lpTokens[0] === first && lpTokens[1] === last)))
      strong.push(m.id);
    else if (lp === first) weak.push(m.id);
  }

  if (strong.length === 1)
    return {
      ...base,
      suggested_member_id: strong[0],
      suggested_kind: "person",
      confidence: "high",
      evidence: `local part matches first+last name exactly`,
      provenance: "directory-name-exact",
      ambiguity: [...strong.slice(1), ...weak].filter((id) => id !== strong[0]),
    };
  if (strong.length > 1)
    return {
      ...base,
      confidence: "unresolved",
      evidence: `local part matches ${strong.length} members' names — ambiguous`,
      ambiguity: strong,
    };
  if (weak.length === 1)
    return {
      ...base,
      suggested_member_id: weak[0],
      suggested_kind: "person",
      confidence: "medium",
      evidence: `local part matches a member's first name (review — first name alone is not proof)`,
      provenance: "directory-firstname-exact",
    };
  if (weak.length > 1)
    return {
      ...base,
      confidence: "unresolved",
      evidence: `first name matches ${weak.length} members — ambiguous`,
      ambiguity: weak,
    };
  return { ...base, confidence: "unresolved", evidence: "no exact directory-name match" };
}
