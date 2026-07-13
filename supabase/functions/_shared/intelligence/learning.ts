// Universal Intelligence Foundation — learning (pure).
//
// A human correction proposes a VERSIONED improvement — a profile delta at a
// specific learning layer. The three layers (universal / industry / tenant) map
// to distinct profile scopes and MUST NEVER be mixed: a tenant's private
// correction can only ever land at the tenant scope. Pure and deterministic.

import type { Correction, Improvement, ProfileEntry } from "./types.ts";

/** Learning layer → profile scope. The one place the mapping is defined. */
const LAYER_SCOPE = {
  universal: "platform",
  industry: "industry",
  tenant: "tenant",
} as const;

/**
 * Produce the versioned improvement a correction implies. If the correction
 * names a `target` profile fact, the improvement is a profile entry at the
 * correction's layer; otherwise it carries no config change (a data-only
 * correction still recorded for audit/training).
 */
export function proposeImprovement(correction: Correction): Improvement {
  if (!correction.target) {
    return { layer: correction.layer, entry: null, rationale: correction.why };
  }
  const entry: ProfileEntry = {
    scope_kind: LAYER_SCOPE[correction.layer],
    scope_ref: correction.target.scope_ref ?? null,
    domain: correction.target.domain ?? null,
    namespace: correction.target.namespace,
    key: correction.target.key,
    value: correction.target.value,
  };
  return { layer: correction.layer, entry, rationale: correction.why };
}

/**
 * Apply an improvement to a set of profile entries (returns a NEW array). Used
 * to re-resolve the effective profile and show the improved future decision.
 */
export function applyImprovement(
  entries: ProfileEntry[],
  improvement: Improvement,
): ProfileEntry[] {
  return improvement.entry ? [...entries, improvement.entry] : entries;
}
