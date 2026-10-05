// ServiceOS — OpenFolk Control Plane: identity resolution (pure, review-only).
//
// STRICT SEPARATION (the core invariant of this module):
//   • An identity LINK says "this email/extension/DDI represents this person/team".
//   • Operational OWNERSHIP says "this person is accountable for activity on this endpoint".
// This module ONLY proposes identity links. It never creates ownership, and it never
// auto-confirms: every suggestion is a review item with confidence + evidence. A weak
// fuzzy name match is NEVER sufficient — matches are exact and de-duplicated for ambiguity.
//
// TWO DISTINCT CLASSIFICATION AXES (do not conflate them):
//   • PROVIDER MAILBOX TYPE — the raw provider fact (Google: user | group | alias | shared |
//     suspended | unknown). Derived only from provider metadata, never from the address text.
//   • OPERATIONAL CLASSIFICATION — how the box actually functions for the business (personal |
//     shared | team | service | inactive | unknown). A Google `user` mailbox may still be
//     operationally shared or role-based, so operational class is set ONLY from reviewed
//     evidence (or an unambiguous provider signal); an unreviewed `user` box defaults to
//     UNKNOWN. We never assert "personal" merely because the provider type is `user`.

/** Raw provider mailbox type, normalised. This is a provider fact, not an operational judgement. */
export type ProviderMailboxType = "user" | "group" | "alias" | "shared" | "suspended" | "unknown";

/** Operational classification — how the mailbox is actually used. Set from reviewed evidence. */
export type OperationalClass = "personal" | "shared" | "team" | "service" | "inactive" | "unknown";

/** The operator's identity-review decisions (also drive operational classification). */
export type ReviewDecision =
  "confirmed_person" | "shared" | "team" | "system" | "rejected" | "unresolved";

export interface MailboxMeta {
  email: string;
  mailbox_type?: string | null; // provider: user | shared | group | alias | ...
  status?: string | null; // provider: active | suspended | ...
  display_name?: string | null; // provider display / full name (a stronger identity signal)
}

/**
 * Provider mailbox type from PROVIDER metadata only. Never inferred from the local part
 * (e.g. "marketing@" with provider type `user` is a user box, not a group). Unknown when the
 * provider gave us no type.
 */
export function providerMailboxType(m: MailboxMeta): ProviderMailboxType {
  const t = (m.mailbox_type ?? "").toLowerCase().trim();
  if (t === "user") return "user";
  if (t === "group" || t === "distribution") return "group";
  if (t === "alias") return "alias";
  if (t === "shared") return "shared";
  if (t === "service" || t === "system") return "shared"; // provider "service" boxes are shared infra
  if (t === "suspended") return "suspended";
  return "unknown";
}

/**
 * Operational classification — SEPARATE from provider type. Reviewed operator evidence is
 * authoritative; absent a review, only an UNAMBIGUOUS provider signal classifies:
 *   • provider status suspended/inactive → inactive
 *   • provider mailbox_type shared       → shared
 *   • provider mailbox_type group        → team
 *   • everything else (user / alias / unknown) → UNKNOWN (never assume "personal")
 * `reviewed` reports whether the class came from an operator decision.
 */
export function classifyOperational(
  m: MailboxMeta,
  review?: ReviewDecision | null,
): { class: OperationalClass; evidence: string; reviewed: boolean } {
  if (review) {
    switch (review) {
      case "confirmed_person":
        return {
          class: "personal",
          evidence: "operator confirmed a specific person",
          reviewed: true,
        };
      case "shared":
        return {
          class: "shared",
          evidence: "operator marked shared responsibility",
          reviewed: true,
        };
      case "team":
        return { class: "team", evidence: "operator marked team/group", reviewed: true };
      case "system":
        return { class: "service", evidence: "operator marked service/system", reviewed: true };
      case "rejected":
      case "unresolved":
        return {
          class: "unknown",
          evidence: "operator left operational role unresolved",
          reviewed: true,
        };
    }
  }
  const status = (m.status ?? "").toLowerCase();
  if (status === "suspended" || status === "inactive")
    return { class: "inactive", evidence: `provider status=${m.status}`, reviewed: false };
  const t = providerMailboxType(m);
  if (t === "shared")
    return { class: "shared", evidence: "provider mailbox_type=shared", reviewed: false };
  if (t === "group")
    return { class: "team", evidence: "provider mailbox_type=group", reviewed: false };
  // user | alias | unknown → UNKNOWN until reviewed. Do NOT default a user box to "personal".
  return {
    class: "unknown",
    evidence: `provider type=${t} — operational role not yet reviewed`,
    reviewed: false,
  };
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
  provider_mailbox_type: ProviderMailboxType;
  operational_class: OperationalClass;
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
 * PURE identity suggestion for one email endpoint. Exact evidence only — HIGH confidence
 * requires an authoritative signal, never a bare first-name match:
 *   • already-confirmed link on this exact address        → high (existing link)
 *   • provider display name == a member's name exactly     → high (verified Workspace name)
 *   • local part == "first.last" / "flast" / "firstlast"   → high (exact full-name form)
 *   • local part == a member's FIRST name, unique member   → medium (first name is not proof)
 *   • provider shared/group mailbox                        → shared, never an individual
 *   • ambiguous (>1 member matches) or no match            → unresolved
 * NEVER returns a "confirmed" result — the operator must review. No fuzzy matching.
 */
export function suggestIdentity(
  mailbox: MailboxMeta,
  members: SuggestMember[],
  confirmed: ConfirmedIdentity[],
): IdentitySuggestion {
  const email = mailbox.email.trim().toLowerCase();
  const provType = providerMailboxType(mailbox);
  const opClass = classifyOperational(mailbox).class;
  const base: IdentitySuggestion = {
    endpoint_email: email,
    provider_mailbox_type: provType,
    operational_class: opClass,
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

  // Suspended provider status → never link before an operator reviews it.
  if ((mailbox.status ?? "").toLowerCase() === "suspended")
    return { ...base, evidence: "suspended mailbox — review before linking" };

  // Provider shared / group mailboxes are never auto-attributed to an individual.
  if (provType === "shared" || provType === "group")
    return {
      ...base,
      suggested_kind: "shared",
      confidence: "unresolved",
      evidence: `provider ${provType} mailbox — configure a team/shared owner, not an individual`,
    };

  // ── STRONG: a verified Workspace display name that exactly matches one member → high. ──
  const dn = (mailbox.display_name ?? "").trim().toLowerCase();
  if (dn) {
    const dnMatches = members.filter((m) => m.display_name.trim().toLowerCase() === dn);
    if (dnMatches.length === 1)
      return {
        ...base,
        suggested_member_id: dnMatches[0].id,
        suggested_kind: "person",
        confidence: "high",
        evidence: `verified Workspace display name "${mailbox.display_name}" exactly matches this member`,
        provenance: "workspace-display-name-exact",
        ambiguity: [],
      };
    if (dnMatches.length > 1)
      return {
        ...base,
        confidence: "unresolved",
        evidence: `Workspace display name matches ${dnMatches.length} members — ambiguous`,
        ambiguity: dnMatches.map((m) => m.id),
      };
  }

  const lp = localPart(email);
  const lpTokens = lp.split(/[._-]+/).filter(Boolean);

  const strong: string[] = []; // first.last style (exact full-name form)
  const weak: string[] = []; // first-name-only
  for (const m of members) {
    const tk = nameTokens(m.display_name);
    if (tk.length === 0) continue;
    const first = tk[0];
    const last = tk[tk.length - 1];
    const firstLastForms = new Set(
      [`${first}.${last}`, `${first}${last}`, `${first[0]}${last}`, `${first}.${last[0]}`].filter(
        (s) => s.length > 2,
      ),
    );
    if (
      tk.length >= 2 &&
      (firstLastForms.has(lp) || (lpTokens[0] === first && lpTokens[1] === last))
    )
      strong.push(m.id);
    else if (lp === first) weak.push(m.id);
  }

  if (strong.length === 1)
    return {
      ...base,
      suggested_member_id: strong[0],
      suggested_kind: "person",
      confidence: "high",
      evidence: `local part matches this member's first+last name exactly`,
      provenance: "directory-name-exact",
      ambiguity: [...strong.slice(1), ...weak].filter((id) => id !== strong[0]),
    };
  if (strong.length > 1)
    return {
      ...base,
      confidence: "unresolved",
      evidence: `local part matches ${strong.length} members' full names — ambiguous`,
      ambiguity: strong,
    };
  if (weak.length === 1)
    return {
      ...base,
      suggested_member_id: weak[0],
      suggested_kind: "person",
      confidence: "medium",
      evidence: `local part matches a member's first name only (review — a first name is not proof of identity)`,
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
