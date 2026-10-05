// Universal Decision Engine — authority normalisation (pure resolver).
//
// Runs BEFORE the pure engine. Maps a domain-neutral, normalised authority block
// (object.attributes.authority) + profile config into an AuthorityContext the
// engine can compare. The engine never reads authority from arbitrary attributes;
// it only ever sees this resolved context. Domain packs populate the normalised
// block; this resolver contains no domain branching.

import { profileValue } from "./profile.ts";
import type { AuthorityContext, EffectiveProfile, IntelligenceObject, Money } from "./types.ts";

const AUTHORITY_TYPES: ReadonlySet<string> = new Set<AuthorityContext["authorityType"]>([
  "none",
  "financial",
  "commercial",
  "contractual",
  "legal",
  "compliance",
  "safety",
  "operational",
  "policy_exception",
]);
const HOLDERS: ReadonlySet<string> = new Set<AuthorityContext["requiredAuthorityHolder"]>([
  "ai",
  "automation",
  "openfolk",
  "tenant_role",
  "tenant_user",
  "customer",
  "external_party",
]);

function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

/**
 * Resolve authority facts for an object. A `none` context is returned when the
 * object carries no normalised authority block. Currency-tagged values are only
 * produced when BOTH amount and currency are present (a limit with no configured
 * currency stays null so the engine fails safe rather than guessing a currency).
 */
export function resolveAuthorityContext(
  object: IntelligenceObject,
  profile: EffectiveProfile,
): AuthorityContext {
  const raw = object.attributes?.["authority"];
  if (!raw || typeof raw !== "object") {
    return {
      authorityType: "none",
      requestedValue: null,
      delegatedLimit: null,
      requiredAuthorityHolder: "ai",
      resolvedHolderId: null,
      delegated: true,
      explicitCustomerApprovalRequired: false,
      sourcePolicyIds: [],
    };
  }
  const r = raw as Record<string, unknown>;
  const authorityType = AUTHORITY_TYPES.has(r["type"] as string)
    ? (r["type"] as AuthorityContext["authorityType"])
    : "operational";

  const reqAmount = num(r["amount"]);
  const reqCurrency = typeof r["currency"] === "string" ? (r["currency"] as string) : null;
  const requestedValue: Money | null =
    reqAmount !== null && reqCurrency !== null
      ? { amount: reqAmount, currency: reqCurrency }
      : null;

  // Delegated limit from profile — REQUIRES both amount and currency, else null
  // (a partially-configured limit is treated as missing, never guessed).
  const limitAmount = num(profileValue(profile, "authority.delegated_limit"));
  const limitCurrency = profileValue(profile, "authority.currency");
  const delegatedLimit: Money | null =
    limitAmount !== null && typeof limitCurrency === "string"
      ? { amount: limitAmount, currency: limitCurrency }
      : null;

  const holderCfg = profileValue(profile, "authority.holder");
  const requiredAuthorityHolder = HOLDERS.has(holderCfg as string)
    ? (holderCfg as AuthorityContext["requiredAuthorityHolder"])
    : "customer"; // conservative default holder — cannot itself authorise action

  return {
    authorityType,
    requestedValue,
    delegatedLimit,
    requiredAuthorityHolder,
    resolvedHolderId: typeof r["holder_id"] === "string" ? (r["holder_id"] as string) : null,
    delegated: r["delegated"] === true,
    explicitCustomerApprovalRequired: r["explicit_customer_approval"] === true,
    sourcePolicyIds: Array.isArray(r["source_policy_ids"])
      ? (r["source_policy_ids"] as string[])
      : [],
  };
}
