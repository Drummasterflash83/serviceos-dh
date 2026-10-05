// ServiceOS — OpenFolk Control Plane: Slack identity resolution (pure, review-only).
//
// The Slack analogue of identity_resolution.ts / telephony_identity.ts. Same invariant: this
// ONLY proposes identity LINKS (Slack user ⇄ person) as review items with confidence + evidence.
// It NEVER creates ownership and NEVER auto-confirms.
//
//   Slack workspace → Slack user → source-identity CANDIDATE → canonical team member → operator
//   review → confirmed link.
//
// A Slack user id is NEVER a canonical person id. Bots/apps/system users are never suggested as
// people. A verified-email match is high confidence but still reviewable; a name match is weaker;
// duplicate names are ambiguous; a deactivated account is flagged, not hidden.

import { type Confidence, type SuggestMember, nameTokens } from "./identity_resolution.ts";
import type { NormalizedSlackUser } from "../slack/slack_users.ts";

export interface SlackSuggestOptions {
  /** Existing confirmed Slack links (member_integration_identities, provider='slack'). */
  confirmedSlack?: { team_member_id: string; slack_user_id: string }[];
  /** Member emails from CONFIRMED email identities — the only email source for cross-match. */
  memberEmails?: { team_member_id: string; email: string }[];
}

export type SlackMatchBasis =
  "existing_link" | "verified_email" | "full_name" | "first_name" | "none";

export interface SlackIdentitySuggestion {
  slack_user_id: string;
  suggested_member_id: string | null;
  suggested_kind: "person" | "system" | "none";
  confidence: Confidence;
  evidence: string;
  provenance: string;
  matched_by: SlackMatchBasis;
  ambiguity: string[];
  deactivated: boolean;
  classification: NormalizedSlackUser["classification"];
}

function base(user: NormalizedSlackUser): SlackIdentitySuggestion {
  return {
    slack_user_id: user.slack_user_id,
    suggested_member_id: null,
    suggested_kind: "none",
    confidence: "unresolved",
    evidence: "",
    provenance: "slack-identity-resolver",
    matched_by: "none",
    ambiguity: [],
    deactivated: user.deactivated,
    classification: user.classification,
  };
}

/**
 * PURE identity suggestion for one Slack user. Order of evidence strength:
 *   • bot / app / system                                   → never a person (excluded)
 *   • existing confirmed Slack link on this user id        → high (known)
 *   • verified email == a member's confirmed email, unique → high (still reviewable)
 *   • real/display name == one member's full name, unique  → high (reviewable)
 *   • first name only matches one member                   → medium
 *   • matches >1 member (email or name)                    → unresolved + ambiguity[]
 *   • no email + no name match                             → unresolved
 * A deactivated account keeps its match but is flagged. NEVER returns "confirmed".
 */
export function suggestSlackIdentity(
  user: NormalizedSlackUser,
  members: SuggestMember[],
  opts: SlackSuggestOptions = {},
): SlackIdentitySuggestion {
  // Non-people are classified and refused as person suggestions.
  if (user.classification !== "person")
    return {
      ...base(user),
      suggested_kind: "system",
      evidence: `Slack ${user.classification} user — not a person; excluded from identity suggestions`,
    };

  // Already confirmed for this exact Slack user id.
  const known = (opts.confirmedSlack ?? []).find((c) => c.slack_user_id === user.slack_user_id);
  if (known)
    return {
      ...base(user),
      suggested_member_id: known.team_member_id,
      suggested_kind: "person",
      confidence: "high",
      evidence: "existing confirmed Slack identity link on this user",
      provenance: "member_integration_identities",
      matched_by: "existing_link",
    };

  const flag = (s: SlackIdentitySuggestion): SlackIdentitySuggestion =>
    user.deactivated
      ? { ...s, evidence: `${s.evidence} (account is deactivated in Slack — confirm before use)` }
      : s;

  // Verified-email cross-match against members' CONFIRMED emails.
  if (user.email) {
    const emailMatches = (opts.memberEmails ?? []).filter(
      (m) => m.email.trim().toLowerCase() === user.email,
    );
    const ids = [...new Set(emailMatches.map((m) => m.team_member_id))];
    if (ids.length === 1)
      return flag({
        ...base(user),
        suggested_member_id: ids[0],
        suggested_kind: "person",
        confidence: "high",
        evidence: `Slack email matches this member's confirmed mailbox exactly`,
        provenance: "slack-verified-email",
        matched_by: "verified_email",
      });
    if (ids.length > 1)
      return flag({
        ...base(user),
        confidence: "unresolved",
        evidence: `Slack email matches ${ids.length} members' confirmed mailboxes — ambiguous`,
        ambiguity: ids,
        matched_by: "verified_email",
      });
  }

  // Name match on real name / display name.
  const nameSource = user.real_name || user.display_name || "";
  const tokens = nameTokens(nameSource);
  if (tokens.length === 0)
    return { ...base(user), evidence: "no email match and no usable Slack name to match" };

  const full: string[] = [];
  const first: string[] = [];
  for (const m of members) {
    const tk = nameTokens(m.display_name);
    if (tk.length === 0) continue;
    const mFirst = tk[0];
    const mLast = tk[tk.length - 1];
    if (tk.length >= 2 && tokens.includes(mFirst) && tokens.includes(mLast)) full.push(m.id);
    else if (tokens[0] === mFirst) first.push(m.id);
  }

  if (full.length === 1)
    return flag({
      ...base(user),
      suggested_member_id: full[0],
      suggested_kind: "person",
      confidence: "high",
      evidence: `Slack name "${nameSource}" matches this member's full name`,
      provenance: "slack-name-exact",
      matched_by: "full_name",
      ambiguity: [...full.slice(1), ...first].filter((id) => id !== full[0]),
    });
  if (full.length > 1)
    return flag({
      ...base(user),
      confidence: "unresolved",
      evidence: `Slack name matches ${full.length} members' full names — ambiguous`,
      ambiguity: full,
      matched_by: "full_name",
    });
  if (first.length === 1)
    return flag({
      ...base(user),
      suggested_member_id: first[0],
      suggested_kind: "person",
      confidence: "medium",
      evidence: `Slack name matches a member's first name only (review — a first name is not proof)`,
      provenance: "slack-firstname",
      matched_by: "first_name",
    });
  if (first.length > 1)
    return flag({
      ...base(user),
      confidence: "unresolved",
      evidence: `Slack first name matches ${first.length} members — ambiguous`,
      ambiguity: first,
      matched_by: "first_name",
    });

  return flag({ ...base(user), evidence: "no confirmed-email or directory-name match" });
}

/** Tenant-scoped Slack connection state (from provider_connections). */
export interface SlackConnectionState {
  status: string | null;
  revoked_at: string | null;
}

/**
 * PURE precheck: may discovery run against this connection? Discovery fails CLOSED — a missing,
 * revoked or non-connected connection yields no candidates rather than an error surface. Secrets
 * are never inspected here (only non-secret status).
 */
export function canDiscoverSlack(conn: SlackConnectionState | null | undefined): {
  ok: boolean;
  reason?: string;
} {
  if (!conn) return { ok: false, reason: "no Slack connection configured" };
  if (conn.revoked_at) return { ok: false, reason: "Slack connection revoked" };
  if (conn.status !== "configured" && conn.status !== "connected")
    return {
      ok: false,
      reason: `Slack connection not ready (status: ${conn.status ?? "unknown"})`,
    };
  return { ok: true };
}

export interface SlackCandidate extends SlackIdentitySuggestion {
  display_name: string | null;
  real_name: string | null;
  email: string | null;
  title: string | null;
  tz: string | null;
  is_guest: boolean;
}

/**
 * Build review candidates for a normalised Slack directory. People get identity suggestions;
 * bots/apps/system are returned classified (kind='system') but never as person suggestions —
 * the operator can see they were seen and excluded. Unresolved/ambiguous are preserved.
 */
export function buildSlackCandidates(
  users: NormalizedSlackUser[],
  members: SuggestMember[],
  opts: SlackSuggestOptions = {},
): SlackCandidate[] {
  return (users ?? []).map((u) => ({
    ...suggestSlackIdentity(u, members, opts),
    display_name: u.display_name,
    real_name: u.real_name,
    email: u.email,
    title: u.title,
    tz: u.tz,
    is_guest: u.is_guest,
  }));
}
