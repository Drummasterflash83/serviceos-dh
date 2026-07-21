// ServiceOS — Telephony endpoint discovery → mapping suggestion (PURE).
//
// Turns aggregated call + spoken-name evidence for ONE endpoint into a REVIEWABLE
// staff-mapping suggestion. A suggestion is NEVER a confirmed mapping — an admin must
// confirm it. Conflicting introductions produce a conflict/shared verdict, never a
// silent pick. Provider-neutral and tenant-agnostic: the caller supplies this tenant's
// aggregated evidence.

export const DISCOVERY_VERSION = "v1";

export interface NameTally {
  name: string;
  personId: string | null;
  count: number;
}

export interface EndpointEvidence {
  endpointRef: string;
  inboundCount: number;
  outboundCount: number;
  lastSeen: string | null;
  /** Spoken-name self-introductions tallied across this endpoint's transcripts. */
  nameTally: NameTally[];
}

export type SuggestionStatus = "suggested" | "conflicted" | "shared" | "unknown";

export interface EndpointSuggestion {
  endpointRef: string;
  inboundCount: number;
  outboundCount: number;
  lastSeen: string | null;
  suggestedPersonId: string | null;
  suggestedName: string | null;
  confidence: number; // 0..1
  sharedLikelihood: number; // 0..1
  conflicts: string[]; // other significant names
  status: SuggestionStatus;
  evidence: string[];
  version: string;
}

/**
 * Produce a reviewable mapping suggestion for one endpoint. Deterministic. Strong,
 * unconflicted spoken-name evidence for a known person → "suggested" with a confidence
 * that grows with dominance and volume. Multiple significant names → "conflicted" (two)
 * or "shared" (three+). No matched names → "unknown".
 */
export function suggestEndpointMapping(ev: EndpointEvidence): EndpointSuggestion {
  const base = {
    endpointRef: ev.endpointRef,
    inboundCount: ev.inboundCount,
    outboundCount: ev.outboundCount,
    lastSeen: ev.lastSeen,
    version: DISCOVERY_VERSION,
  };

  const matched = ev.nameTally.filter((n) => n.personId && n.count > 0);
  const total = matched.reduce((s, n) => s + n.count, 0);
  if (!total) {
    return {
      ...base,
      suggestedPersonId: null,
      suggestedName: null,
      confidence: 0,
      sharedLikelihood: 0,
      conflicts: [],
      status: "unknown",
      evidence: [
        `${ev.inboundCount} inbound / ${ev.outboundCount} outbound calls`,
        "no matched spoken introductions",
      ],
    };
  }

  const sorted = [...matched].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const top = sorted[0];
  const topShare = top.count / total;
  const significant = sorted.filter((n) => n.count / total >= 0.25);

  const dirEvidence =
    ev.outboundCount > ev.inboundCount * 2
      ? "mostly outbound calls"
      : ev.inboundCount > ev.outboundCount * 2
        ? "mostly inbound calls"
        : "mixed inbound/outbound";

  // Conflict / shared: two+ significant distinct names.
  if (significant.length >= 2) {
    const conflicts = significant.slice(1).map((n) => n.name);
    // Two distinct significant names = a conflict (which person?); three or more =
    // a shared handset used by several people.
    const shared = significant.length >= 3;
    return {
      ...base,
      suggestedPersonId: null,
      suggestedName: null,
      confidence: 0,
      sharedLikelihood: shared ? 0.8 : 0.5,
      conflicts,
      status: shared ? "shared" : "conflicted",
      evidence: [
        dirEvidence,
        `multiple introductions: ${significant.map((n) => `${n.name} (${n.count})`).join(", ")}`,
        shared ? "likely shared handset or call pickup" : "possible pickup/transfer",
      ],
    };
  }

  // Single dominant matched name → suggestion.
  const confidence = Math.min(0.98, 0.5 + topShare * 0.35 + Math.min(top.count, 12) / 60);
  return {
    ...base,
    suggestedPersonId: top.personId,
    suggestedName: top.name,
    confidence,
    sharedLikelihood: 0,
    conflicts: [],
    status: "suggested",
    evidence: [
      dirEvidence,
      `${top.count} transcript(s) introduce "${top.name}"`,
      "no conflicting introduction",
    ],
  };
}
