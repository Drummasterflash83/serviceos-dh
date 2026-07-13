// Universal Intelligence Foundation — pure layered profile resolver.
//
// Resolves ordered layers (platform → industry → domain → tenant → department →
// team → user) into a single effective profile. Industry is a DATA layer, so
// "no hard-coded industries" is structural. Pure + deterministic → testable.

import type { EffectiveProfile, ProfileEntry, ResolveContext } from "./types.ts";

const LAYER_RANK: Record<ProfileEntry["scope_kind"], number> = {
  platform: 0,
  industry: 1,
  domain: 2,
  tenant: 3,
  department: 4,
  team: 5,
  user: 6,
};

/** Does an entry apply to this resolution context? */
function applies(entry: ProfileEntry, ctx: ResolveContext): boolean {
  // Domain gate: an entry scoped to a domain column must match (null = all).
  if (entry.domain !== null && entry.domain !== ctx.domain) return false;
  switch (entry.scope_kind) {
    case "platform":
      return true;
    case "industry":
      return !!ctx.industry && entry.scope_ref === ctx.industry;
    case "domain":
      return entry.scope_ref === ctx.domain;
    case "tenant":
      return entry.scope_ref === null || entry.scope_ref === ctx.tenantId;
    case "department":
    case "team":
      return !!entry.scope_ref && (ctx.orgUnitPath ?? []).includes(entry.scope_ref);
    case "user":
      return !!ctx.userId && entry.scope_ref === ctx.userId;
    default:
      return false;
  }
}

/**
 * Deep-merge applicable entries by ascending layer rank so higher layers win.
 * Returns `namespace → key → value`.
 */
export function resolveEffectiveProfile(
  entries: ProfileEntry[],
  ctx: ResolveContext,
): EffectiveProfile {
  const applicable = entries
    .filter((e) => applies(e, ctx))
    .sort((a, b) => LAYER_RANK[a.scope_kind] - LAYER_RANK[b.scope_kind]);

  const out: EffectiveProfile = {};
  for (const e of applicable) {
    if (!out[e.namespace]) out[e.namespace] = {};
    out[e.namespace][e.key] = e.value; // later (higher-rank) entry overrides
  }
  return out;
}

/** Read "namespace.key" from an effective profile; undefined if absent. */
export function profileValue(profile: EffectiveProfile, path: string): unknown {
  const dot = path.indexOf(".");
  if (dot < 0) return undefined;
  const ns = path.slice(0, dot);
  const key = path.slice(dot + 1);
  return profile[ns]?.[key];
}
