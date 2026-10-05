// ServiceOS — Customer Health: deterministic ownership resolver (Deno, PURE).
//
// Proposes the likely responsibility for a callback from TENANT configuration only.
// There is NO hardcoded Drummonds DDI, extension, queue or staff mapping here — the
// maps are passed in (loaded from operating_profile_entries). In shadow mode this is
// a PROPOSAL, never an assignment. The resolution order is configurable; the default
// mirrors the spec: DDI/extension → queue/team → named recipient → shared → fallback
// role → needs_context.

import {
  type OwnershipHint,
  type OwnershipMaps,
  type OwnershipResolution,
  type OwnershipSourceKind,
} from "./types.ts";

export const DEFAULT_OWNERSHIP_ORDER: OwnershipSourceKind[] = [
  "ddi",
  "extension",
  "queue",
  "named_recipient",
  "shared_responsibility",
  "fallback_role",
];

function explain(source: OwnershipSourceKind, label: string | null, hint: OwnershipHint): string {
  switch (source) {
    case "ddi":
      return `This DDI is owned by ${label ?? "a team"}.`;
    case "extension":
      return `The extension reached is owned by ${label ?? "a team"}.`;
    case "queue":
      return `Call entered the ${label ?? hint.queue ?? "assigned"} queue.`;
    case "named_recipient":
      return hint.requestedName
        ? `Caller requested ${hint.requestedName}.`
        : `Caller requested a named member of staff.`;
    case "shared_responsibility":
      return `Falls under a shared responsibility mapping${label ? ` (${label})` : ""}.`;
    case "fallback_role":
      return `No specific owner resolved — routed to the ${label ?? "fallback"} role.`;
    default:
      return "No specific owner could be resolved.";
  }
}

/**
 * Resolve the proposed responsibility. Pure and deterministic. `maps` and `order`
 * come from tenant config; an empty/absent map at a step simply falls through.
 */
export function resolveOwnership(
  hint: OwnershipHint,
  maps: Partial<OwnershipMaps>,
  order: OwnershipSourceKind[] = DEFAULT_OWNERSHIP_ORDER,
): OwnershipResolution {
  const lookups: Record<string, () => { responsibility: string; label: string | null } | null> = {
    ddi: () => {
      if (!hint.ddi) return null;
      const e = maps.ddi?.[hint.ddi];
      return e ? { responsibility: e.responsibility, label: e.label ?? null } : null;
    },
    extension: () => {
      if (!hint.extension) return null;
      const e = maps.extension?.[hint.extension];
      return e ? { responsibility: e.responsibility, label: e.label ?? null } : null;
    },
    queue: () => {
      if (!hint.queue) return null;
      const e = maps.queue?.[hint.queue];
      return e ? { responsibility: e.responsibility, label: e.label ?? hint.queue } : null;
    },
    named_recipient: () => {
      if (!hint.requestedName) return null;
      const e = maps.named_recipient?.[hint.requestedName.toLowerCase()];
      return e ? { responsibility: e.responsibility, label: e.label ?? hint.requestedName } : null;
    },
    shared_responsibility: () => {
      // Shared responsibility keyed by queue or requested name, whichever is present.
      const key = hint.queue ?? hint.requestedName?.toLowerCase() ?? null;
      if (!key) return null;
      const e = maps.shared_responsibility?.[key];
      return e ? { responsibility: e.responsibility, label: e.label ?? null } : null;
    },
    fallback_role: () => {
      const e = maps.fallback_role;
      return e ? { responsibility: e.responsibility, label: e.label ?? null } : null;
    },
  };

  for (const source of order) {
    const hit = lookups[source]?.();
    if (hit) {
      const confidence =
        source === "fallback_role" ? 0.4 : source === "ddi" || source === "extension" ? 0.9 : 0.75;
      return {
        responsibility: hit.responsibility,
        source,
        label: hit.label,
        explanation: explain(source, hit.label, hint),
        confidence,
      };
    }
  }

  return {
    responsibility: null,
    source: "needs_context",
    label: null,
    explanation: "No specific owner could be resolved.",
    confidence: 0.2,
  };
}
