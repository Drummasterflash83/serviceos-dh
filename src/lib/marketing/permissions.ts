/**
 * Marketing permission vocabulary + role defaults (client mirror).
 *
 * NON-AUTHORITATIVE UI MIRROR. The single authority for Marketing permissions is
 * the DATABASE: `marketing_role_defaults` (role defaults as data) resolved by
 * `marketing_effective_permissions` — shared by RLS policies and the
 * `marketing-access` Edge Function. This module mirrors the permission NAMES and
 * ROLE DEFAULTS only so the client can render affordances before the server
 * answers; it is never trusted for authorization (RLS + the Edge Function
 * enforce, fail-closed).
 *
 * Keep in sync with:
 *   - migration 20260828120000_marketing_foundation.sql
 *     (marketing_permissions + marketing_role_defaults seeds)
 */

export type UserRole = "owner" | "admin" | "ops" | "viewer";

export const MARKETING_PERMISSIONS = [
  "marketing.view",
  "marketing.contacts.manage",
  "marketing.contacts.import",
  "marketing.tags.manage",
  "marketing.campaigns.draft",
  "marketing.campaigns.test",
  "marketing.campaigns.launch",
  "marketing.senders.manage",
  "marketing.ads.manage",
  "marketing.reporting.view",
  "marketing.access.manage",
] as const;

export type MarketingPermission = (typeof MARKETING_PERMISSIONS)[number];

/** Safe role defaults (brief's recommended grants). Mirror of the Edge Function. */
export const ROLE_DEFAULTS: Record<UserRole, MarketingPermission[]> = {
  owner: [...MARKETING_PERMISSIONS],
  admin: [...MARKETING_PERMISSIONS],
  ops: [
    "marketing.view",
    "marketing.contacts.manage",
    "marketing.contacts.import",
    "marketing.tags.manage",
    "marketing.campaigns.draft",
    "marketing.campaigns.test",
    "marketing.reporting.view",
  ],
  viewer: [],
};

export interface MarketingGrantOverride {
  permission: string;
  /** false = explicit deny override (removes a role default). */
  granted: boolean;
}

/**
 * Resolve effective permissions: role defaults, then per-user grant overrides.
 * Pure + deterministic. Unknown permission names in overrides are ignored.
 */
export function resolveMarketingPermissions(
  role: UserRole,
  overrides: MarketingGrantOverride[] = [],
): MarketingPermission[] {
  const valid = new Set<string>(MARKETING_PERMISSIONS);
  const set = new Set<string>(ROLE_DEFAULTS[role] ?? []);
  for (const o of overrides) {
    if (!valid.has(o.permission)) continue;
    if (o.granted === false) set.delete(o.permission);
    else set.add(o.permission);
  }
  return [...set].sort() as MarketingPermission[];
}

/** Does the resolved permission set include a permission? */
export function hasMarketingPermission(
  permissions: readonly string[],
  permission: MarketingPermission,
): boolean {
  return permissions.includes(permission);
}
