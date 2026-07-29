/**
 * Pure derivation of the /marketing access-gate state. Extracted so the
 * route's behaviour — especially the governed "Marketing disabled → owner/admin
 * re-enable" recovery path — is unit-testable without React.
 *
 * Rules:
 *  - an unreachable server is an ERROR, never a permission verdict;
 *  - "Requires permission" is claimed only once the server has ANSWERED;
 *  - reason='not_enabled' + authenticated owner/admin role → the governed
 *    recovery state (open Marketing settings to re-enable);
 *  - reason='not_enabled' for ops/viewer → disabled, no administration path;
 *  - ordinary missing permission stays "Requires permission".
 */

import type { MarketingAccess } from "./access";

export type MarketingGateState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "disabled_admin" } // owner/admin: governed re-enable path
  | { kind: "disabled" } // ops/viewer: disabled, no admin path
  | { kind: "denied" } // enabled but no marketing.view
  | { kind: "ok" };

export function deriveMarketingGate(
  loading: boolean,
  error: string | null,
  access: MarketingAccess | null,
): MarketingGateState {
  if (loading) return { kind: "loading" };
  if (error) return { kind: "error", message: error };
  if (!access) return { kind: "loading" };
  if (access.can_view) return { kind: "ok" };
  if (access.reason === "not_enabled") {
    return access.role === "owner" || access.role === "admin"
      ? { kind: "disabled_admin" }
      : { kind: "disabled" };
  }
  return { kind: "denied" };
}
