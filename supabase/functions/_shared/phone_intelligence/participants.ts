// ServiceOS — PHONE INTELLIGENCE V1: participant identity resolution (PURE).
//
// Combines metadata (extension→person from telephony_directory), external-number
// linkage (interactions→graph person/company), and spoken-name evidence into
// explainable internal/external participants. Rules:
//   • metadata leads; speech confirms/challenges — never assigns identity alone;
//   • conflicting evidence is RECORDED, never silently resolved to one side;
//   • a shared device stays "probable", never definitive;
//   • external identity is never fabricated from transcript text alone.
// Pure: the caller performs the tenant-scoped lookups and passes the rows in, so this
// module holds no DB access and cannot leak across tenants.

import type { SpokenNameCandidate } from "./spoken_name.ts";
import type { CallDirection } from "./direction.ts";

export const RESOLVER_VERSION = "v1";

export type ParticipantRole = "internal" | "external" | "ai_receptionist" | "unknown";

export interface EvidenceItem {
  type: string;
  value: string;
  weight: number;
  source: string; // metadata|directory|transcript|linkage
}

export interface Conflict {
  claimed: string;
  from: string;
  note: string;
}

export interface ResolvedParticipant {
  role: ParticipantRole;
  resolvedEntityId: string | null; // canonical graph node id
  displayName: string | null;
  staffRole: string | null;
  confidence: number;
  evidence: EvidenceItem[];
  conflicts: Conflict[];
  sourceFields: Record<string, unknown>;
  resolverVersion: string;
}

/** A telephony_directory lookup result for a call's internal extension (caller-fetched). */
export interface ExtensionMapping {
  extension: string;
  personId: string | null;
  displayName: string | null;
  role: string | null;
  isSharedDevice: boolean;
  confidence: number; // directory-row confidence
  source: string; // configured|seed|inferred
}

export interface InternalResolveInput {
  extensionMapping?: ExtensionMapping | null;
  /** Non-third-party spoken-name candidates from the transcript. */
  spokenNames?: SpokenNameCandidate[];
}

function empty(role: ParticipantRole = "unknown"): ResolvedParticipant {
  return {
    role,
    resolvedEntityId: null,
    displayName: null,
    staffRole: null,
    confidence: 0,
    evidence: [],
    conflicts: [],
    sourceFields: {},
    resolverVersion: RESOLVER_VERSION,
  };
}

/**
 * Resolve the INTERNAL participant. Evidence priority: (1) extension mapping,
 * (2) transfer/pickup [caller-supplied, not inferred here], (3) spoken-name
 * confirmation, (4) contextual, (5) unknown. A spoken name that names a DIFFERENT
 * person than the extension mapping records a CONFLICT and lowers confidence — it
 * never silently overrides the mapping (a likely pickup/transfer).
 */
export function resolveInternalParticipant(input: InternalResolveInput): ResolvedParticipant {
  const map = input.extensionMapping ?? null;
  const spoken = (input.spokenNames ?? []).filter((s) => !s.thirdParty);
  const r = empty("internal");

  if (map && map.personId) {
    r.resolvedEntityId = map.personId;
    r.displayName = map.displayName;
    r.staffRole = map.role;
    r.sourceFields.extension = map.extension;
    r.sourceFields.mappingSource = map.source;
    // A shared device caps confidence — many people, one handset.
    const base = map.isSharedDevice ? Math.min(map.confidence, 0.75) : map.confidence;
    r.confidence = base;
    r.evidence.push({
      type: "extension_mapping",
      value: `${map.extension}→${map.displayName ?? map.personId}`,
      weight: base,
      source: "directory",
    });
    if (map.isSharedDevice)
      r.evidence.push({
        type: "shared_device",
        value: map.extension,
        weight: 0,
        source: "directory",
      });

    // Spoken-name corroboration or conflict against the mapped person.
    const mappedFirst = (map.displayName ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
    for (const s of spoken) {
      const spokenFirst = s.name.split(/\s+/)[0]?.toLowerCase() ?? "";
      if (!spokenFirst) continue;
      if (spokenFirst === mappedFirst) {
        r.confidence = Math.min(1, r.confidence + 0.1 * s.confidence + 0.05);
        r.evidence.push({
          type: "spoken_name_confirms",
          value: s.name,
          weight: s.confidence,
          source: "transcript",
        });
      } else if (s.matchedPersonId && s.matchedPersonId !== map.personId) {
        // A DIFFERENT known person self-identified → genuine conflict (pickup/transfer).
        r.conflicts.push({
          claimed: s.name,
          from: "spoken_name",
          note: `extension ${map.extension} maps to ${map.displayName ?? "?"} but "${s.name}" self-identified — possible pickup/transfer`,
        });
        r.confidence = Math.max(0, r.confidence - 0.3);
        r.evidence.push({
          type: "spoken_name_conflict",
          value: s.name,
          weight: s.confidence,
          source: "transcript",
        });
      }
    }
    r.confidence = Math.min(1, Math.max(0, r.confidence));
    return r;
  }

  // No extension mapping. A spoken name is NOT enough to assign an internal identity
  // (the core rule: never assign a speaker from transcript text alone). We return an
  // honest UNKNOWN and record the spoken name only as a SUGGESTION — evidence that
  // feeds endpoint-mapping discovery/review, never a resolved identity.
  const u = empty("unknown");
  const suggestion = spoken.find((s) => s.matchedPersonId && s.confidence >= 0.7);
  if (suggestion) {
    u.evidence.push({
      type: "spoken_name_suggestion",
      value: suggestion.name,
      weight: suggestion.confidence,
      source: "transcript",
    });
    u.sourceFields.spokenNameSuggestion = {
      personId: suggestion.matchedPersonId,
      name: suggestion.matchedPersonName,
      confidence: suggestion.confidence,
    };
    u.sourceFields.note =
      "spoken name suggests an internal person, but no extension mapping is configured — identity remains unknown";
  }
  return u;
}

/** An external-number → canonical entity match (caller-fetched via interactions/graph). */
export interface NumberMatch {
  entityId: string;
  displayName: string;
  kind: "person" | "company";
  confidence: number;
  source: string; // interaction_linkage|graph
}

export interface ExternalResolveInput {
  externalNumber?: string | null;
  numberMatch?: NumberMatch | null;
  spokenNames?: SpokenNameCandidate[];
}

/**
 * Resolve the EXTERNAL participant. Priority: (1) telephone-number match to a
 * canonical entity, (2) spoken-name corroboration, (3) unknown. Identity is NEVER
 * fabricated from transcript text alone — a spoken name with no number/entity match
 * yields at most an unresolved candidate.
 */
export function resolveExternalParticipant(input: ExternalResolveInput): ResolvedParticipant {
  const r = empty("external");
  const num = input.externalNumber ?? null;
  if (num) r.sourceFields.externalNumber = num;

  if (input.numberMatch) {
    const nm = input.numberMatch;
    r.resolvedEntityId = nm.entityId;
    r.displayName = nm.displayName;
    r.confidence = nm.confidence;
    r.evidence.push({
      type: "number_match",
      value: `${num ?? "?"}→${nm.displayName}`,
      weight: nm.confidence,
      source: nm.source,
    });
    // Corroborating spoken name raises confidence but is not required.
    for (const s of input.spokenNames ?? []) {
      const first = (nm.displayName ?? "").split(/\s+/)[0]?.toLowerCase();
      if (s.name.split(/\s+/)[0]?.toLowerCase() === first) {
        r.confidence = Math.min(1, r.confidence + 0.05);
        r.evidence.push({
          type: "spoken_name_confirms",
          value: s.name,
          weight: s.confidence,
          source: "transcript",
        });
      }
    }
    r.confidence = Math.min(1, Math.max(0, r.confidence));
    return r;
  }

  // No entity match. A number with no match is an unresolved external (keep the number,
  // no fabricated identity).
  if (num) {
    r.sourceFields.unresolvedReason = "no canonical match for external number";
    r.evidence.push({ type: "external_number_only", value: num, weight: 0.3, source: "metadata" });
    return r;
  }
  return empty("unknown");
}

// ── Orchestration (STEP 8) ──────────────────────────────────────────────────
export interface CallIdentity {
  direction: CallDirection;
  directionConfidence: number;
  internal: ResolvedParticipant;
  external: ResolvedParticipant;
  identityConfidence: number; // min of the two resolved sides that carry identity
  hasConflict: boolean;
  unresolved: string[];
  resolverVersion: string;
}

export function resolveCallIdentity(args: {
  direction: CallDirection;
  directionConfidence: number;
  internal: ResolvedParticipant;
  external: ResolvedParticipant;
}): CallIdentity {
  const { internal, external } = args;
  const sides = [internal, external].filter((p) => p.resolvedEntityId);
  const identityConfidence = sides.length ? Math.min(...sides.map((p) => p.confidence)) : 0;
  const unresolved: string[] = [];
  if (!internal.resolvedEntityId) unresolved.push("internal_participant");
  if (!external.resolvedEntityId) unresolved.push("external_participant");
  return {
    direction: args.direction,
    directionConfidence: args.directionConfidence,
    internal,
    external,
    identityConfidence,
    hasConflict: internal.conflicts.length > 0 || external.conflicts.length > 0,
    unresolved,
    resolverVersion: RESOLVER_VERSION,
  };
}
