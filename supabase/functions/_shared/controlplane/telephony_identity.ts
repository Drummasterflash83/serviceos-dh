// ServiceOS — OpenFolk Control Plane: telephony identity resolution (pure, review-only).
//
// The telephony analogue of identity_resolution.ts. Same invariant: this module ONLY
// proposes identity LINKS (extension ⇄ person) as review items with confidence + evidence.
// It NEVER creates ownership and NEVER auto-confirms.
//
// WHERE THE EVIDENCE COMES FROM. A hosted PBX (sipcentric) labels each call leg with a
// human caller-ID string that carries the person's name AND their extension, e.g.
// "Mary - Clients <103>". We derive candidate extension endpoints from real observed call
// activity (phone_calls.from_number/to_number, call_directions extensions) — never from any
// value hard-coded in the product. The label is provider data and is treated as a HINT:
//   • labels are edited over time, so one extension can carry several different people's
//     names across its history (real Drummonds data: ext 101 has been "Julie" and "Heidi").
//     That is exactly why every mapping is operator-reviewed, never auto-applied.
//   • a first-name-only hint is never proof; a name that matches >1 member is ambiguous;
//     an IVR/queue/ring-group label is shared infrastructure, never an individual.

import {
  type Confidence,
  type ConfirmedIdentity,
  type SuggestMember,
  nameTokens,
} from "./identity_resolution.ts";

/** Role/function words that appear in caller-ID labels but are NOT people. Lowercased. */
const LABEL_ROLE_WORDS = new Set([
  "clients",
  "client",
  "accounts",
  "account",
  "operations",
  "ops",
  "suppliers",
  "supplier",
  "quotes",
  "quote",
  "sales",
  "office",
  "admin",
  "finance",
  "service",
  "support",
  "reception",
  "mobile",
  "cell",
  "desk",
  "phone",
  "line",
  "main",
  "general",
  "team",
  "group",
  "ivr",
  "queue",
  "hours",
  "business",
  "out",
  "of",
  "hour",
  "menu",
  "auto",
  "attendant",
  "le",
  "grand",
  "fromage",
  "and",
  "the",
  "for",
]);

/** Label fragments that mark an endpoint as shared infrastructure, not an individual. */
const SHARED_LABEL_MARKERS = [
  "ivr",
  "queue",
  "hunt",
  "ring group",
  "ringgroup",
  "auto attendant",
  "attendant",
  "hours",
  "voicemail",
  "reception",
  "main line",
];

export interface TelephonyEndpointMeta {
  /** Digit-only extension, e.g. "103". */
  extension: string;
  /** Distinct provider caller-ID labels observed for this extension (name stripped of <ext>). */
  observed_labels: string[];
  /** Bounded call activity, for operator context (never used to infer identity). */
  call_count?: number;
  last_activity?: string | null;
}

/** One parsed internal call leg: an extension seen with a caller-ID label at a point in time. */
export interface CallLegEvidence {
  extension: string;
  label: string;
  at?: string | null; // ISO timestamp of the call, when known
}

/**
 * PURE, provider-neutral aggregation of parsed internal call legs into per-extension endpoint
 * evidence. Distinct labels are ordered most-recent-first (so the current label leads);
 * call_count and last_activity give the operator bounded context. The caller does the
 * provider-specific parsing (adapter) and passes normalised legs in — this function has no
 * knowledge of any provider format. Sorted by call volume, descending.
 */
export function aggregateExtensionEvidence(legs: CallLegEvidence[]): TelephonyEndpointMeta[] {
  const byExt = new Map<
    string,
    { count: number; last: string | null; labels: Map<string, string | null> }
  >();
  for (const leg of legs) {
    const ext = String(leg.extension ?? "").replace(/\D/g, "");
    const label = (leg.label ?? "").trim();
    if (!ext || !label) continue;
    const at = leg.at ?? null;
    const cur = byExt.get(ext) ?? { count: 0, last: null, labels: new Map() };
    cur.count += 1;
    if (at && (!cur.last || at > cur.last)) cur.last = at;
    // Track the most-recent time each distinct label was seen (for recency ordering).
    const prev = cur.labels.get(label);
    if (!prev || (at && at > prev)) cur.labels.set(label, at);
    byExt.set(ext, cur);
  }
  const out: TelephonyEndpointMeta[] = [];
  for (const [extension, v] of byExt) {
    const observed_labels = [...v.labels.entries()]
      .sort((a, b) => String(b[1] ?? "").localeCompare(String(a[1] ?? "")))
      .map(([label]) => label);
    out.push({ extension, observed_labels, call_count: v.count, last_activity: v.last });
  }
  out.sort((a, b) => (b.call_count ?? 0) - (a.call_count ?? 0));
  return out;
}

export interface TelephonyIdentitySuggestion {
  endpoint_extension: string;
  suggested_member_id: string | null;
  suggested_kind: "person" | "shared" | "none";
  confidence: Confidence;
  evidence: string;
  provenance: string;
  /** Other candidate member ids when the labels name more than one member. */
  ambiguity: string[];
  /** Member ids named across the observed labels. */
  named_members: string[];
  /** Name-like tokens in labels that matched no known member (possible other people). */
  unknown_label_names: string[];
}

/** Strip a trailing "<103>" / "(103)" extension marker and lowercase → the name portion. */
export function labelNamePart(label: string): string {
  return (label ?? "")
    .replace(/[<([]\s*\d+\s*[>)\]]/g, " ")
    .replace(/\bext(ension)?\.?\s*\d+/gi, " ")
    .trim();
}

/** True when a label denotes shared infrastructure (IVR / queue / ring group / voicemail). */
export function isSharedTelephonyLabel(label: string): boolean {
  const l = (label ?? "").toLowerCase();
  return SHARED_LABEL_MARKERS.some((m) => l.includes(m));
}

/** Tokens in a label that look like a person's given name but match no member and no role word. */
function unknownNameTokens(labelTokens: string[], memberFirstNames: Set<string>): string[] {
  const out: string[] = [];
  for (const t of labelTokens) {
    if (t.length < 3) continue;
    if (memberFirstNames.has(t)) continue;
    if (LABEL_ROLE_WORDS.has(t)) continue;
    if (/\d/.test(t)) continue;
    out.push(t);
  }
  return [...new Set(out)];
}

/**
 * PURE identity suggestion for one telephony extension, from its observed provider labels.
 *   • already-confirmed link on this exact extension              → high (existing)
 *   • IVR / queue / ring-group / voicemail label                  → shared, never an individual
 *   • labels name exactly ONE member, no stray person name        → high (provider label names them)
 *   • labels name exactly ONE member + a stray unrecognised name  → medium (label reassigned?)
 *   • labels name >1 member (reassignment over time)              → unresolved + ambiguity[]
 *   • labels name NO known member                                 → unresolved
 * NEVER returns a confirmed result — the operator confirms. No fuzzy matching.
 */
export function suggestTelephonyIdentity(
  endpoint: TelephonyEndpointMeta,
  members: SuggestMember[],
  confirmed: ConfirmedIdentity[],
): TelephonyIdentitySuggestion {
  const ext = String(endpoint.extension ?? "").replace(/\D/g, "");
  const base: TelephonyIdentitySuggestion = {
    endpoint_extension: ext,
    suggested_member_id: null,
    suggested_kind: "none",
    confidence: "unresolved",
    evidence: "",
    provenance: "telephony-extension-label",
    ambiguity: [],
    named_members: [],
    unknown_label_names: [],
  };

  // Already confirmed for this exact extension → surface as high (known), not a new claim.
  const known = confirmed.find(
    (c) => String(c.external_ref ?? c.primary_login ?? "").replace(/\D/g, "") === ext && ext !== "",
  );
  if (known)
    return {
      ...base,
      suggested_member_id: known.team_member_id,
      suggested_kind: "person",
      confidence: "high",
      evidence: "existing confirmed identity link on this exact extension",
      provenance: "member_integration_identities",
    };

  const labels = (endpoint.observed_labels ?? []).map((l) => labelNamePart(l)).filter(Boolean);

  // Shared infrastructure (IVR / queue / ...) is never attributed to a person.
  if ((endpoint.observed_labels ?? []).some(isSharedTelephonyLabel))
    return {
      ...base,
      suggested_kind: "shared",
      confidence: "unresolved",
      evidence:
        "IVR / queue / ring-group label — shared infrastructure, configure a team owner not an individual",
    };

  // Build member first-name lookup (first token of display name).
  const memberFirst = new Map<string, string[]>(); // firstName → memberIds
  const memberFullForms = new Map<string, string>(); // "first last" → memberId
  const firstNames = new Set<string>();
  for (const m of members) {
    const tk = nameTokens(m.display_name);
    if (tk.length === 0) continue;
    const first = tk[0];
    firstNames.add(first);
    memberFirst.set(first, [...(memberFirst.get(first) ?? []), m.id]);
    if (tk.length >= 2) memberFullForms.set(`${first} ${tk[tk.length - 1]}`, m.id);
  }

  const namedSet = new Set<string>();
  const unknownNames = new Set<string>();
  for (const label of labels) {
    const tokens = nameTokens(label);
    // full "first last" form present → strong single-member match
    for (const [form, id] of memberFullForms) {
      const [f, l] = form.split(" ");
      if (tokens.includes(f) && tokens.includes(l)) namedSet.add(id);
    }
    // first-name tokens present
    for (const t of tokens) {
      const ids = memberFirst.get(t);
      if (ids) ids.forEach((id) => namedSet.add(id));
    }
    for (const u of unknownNameTokens(tokens, firstNames)) unknownNames.add(u);
  }

  const named = [...namedSet];
  const unknown = [...unknownNames];
  const withNames = { ...base, named_members: named, unknown_label_names: unknown };

  if (named.length === 0)
    return {
      ...withNames,
      confidence: "unresolved",
      evidence: labels.length
        ? `provider extension labels (${labels.join(", ")}) name no known team member`
        : "no provider label observed for this extension",
    };

  if (named.length > 1)
    return {
      ...withNames,
      confidence: "unresolved",
      ambiguity: named,
      evidence: `extension labels have named ${named.length} different members over time (reassignment likely) — review before linking`,
    };

  // Exactly one member named.
  if (unknown.length > 0)
    return {
      ...withNames,
      suggested_member_id: named[0],
      suggested_kind: "person",
      confidence: "medium",
      evidence: `provider extension label names this member, but another label named an unrecognised party (${unknown.join(", ")}) — confirm the current owner`,
    };

  return {
    ...withNames,
    suggested_member_id: named[0],
    suggested_kind: "person",
    confidence: "high",
    evidence: "provider extension label consistently names this member",
  };
}
