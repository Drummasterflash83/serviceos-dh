// Marketing Phase 10A — THE provider adapter contract.
//
// Pure module (no network, no database). One stable interface every provider
// adapter — real or the deterministic test simulator — must implement, and
// ONE canonical-fact boundary: provider-specific payloads terminate at the
// adapter; only validated canonical Marketing facts cross into the domain
// layer. validateCanonicalFacts() is the compile-adjacent proof that an
// adapter cannot silently return malformed canonical data.
//
// Error taxonomy — adapters must normalise every provider failure into
// exactly one of these kinds. `retryable` is the worker's retry contract:
// retryable failures leave the run leased (lease expiry + the attempts
// ceiling govern retries); non-retryable failures complete the run honestly.
//
// REGISTRY GATE: the four real providers (meta / google_ads / linkedin /
// sheet) resolve NO adapter in this build — reviewed adapters do not exist,
// and nothing here pretends otherwise. The deterministic test provider
// ('serviceos_test_provider') resolves ONLY when the runtime environment
// explicitly enables it (MARKETING_TEST_PROVIDER=enabled — local serve and
// automated tests, never production), and it is deliberately ABSENT from the
// production connection catalogue so no UI can present it as a provider.

import { getConnectionDescriptor } from "./marketing_provider_connections.ts";
import { serviceosTestProviderAdapter } from "./marketing_test_provider.ts";

export const SERVICEOS_TEST_PROVIDER = "serviceos_test_provider";

export type ProviderErrorKind =
  | "auth" // authentication failure (invalid/expired credential)
  | "scope" // authorisation / missing provider scope
  | "rate_limit" // provider rate limit
  | "temporary" // provider temporary failure (5xx, timeout)
  | "permanent" // provider permanent rejection
  | "schema" // provider payload failed schema/validation
  | "internal"; // ServiceOS-side failure

export interface ProviderError {
  kind: ProviderErrorKind;
  /** safe, bounded — never a secret, token or raw provider payload */
  message: string;
  retryable: boolean;
}

export interface ExternalAccount {
  ref: string;
  name: string;
}

export type AdapterValidation =
  | {
      ok: true;
      adapterVersion: string;
      /** non-empty verification evidence — the seam refuses without it */
      evidence: Record<string, unknown>;
      accounts: ExternalAccount[];
    }
  | { ok: false; error: ProviderError };

export type FactKind = "campaign" | "ad_group" | "ad" | "metric" | "conversion";

export interface CanonicalFact {
  fact_kind: FactKind;
  external_ref: string;
  parent_ref?: string;
  name?: string;
  window_start?: string; // ISO date
  window_end?: string; // ISO date
  currency?: string; // ISO 4217
  spend?: number;
  impressions?: number;
  clicks?: number;
  leads?: number;
  conversions?: number;
  payload?: Record<string, unknown>;
}

export type AdapterSyncResult =
  | {
      ok: true;
      facts: CanonicalFact[];
      /** partial success: the named feed failed while the rest is genuine */
      partial?: { metrics?: ProviderError };
    }
  | { ok: false; error: ProviderError };

export interface ProviderAdapter {
  provider: string;
  version: string;
  validateConnection(credential: string): Promise<AdapterValidation>;
  fetchFacts(args: {
    credential: string;
    externalAccountRef: string | null;
  }): Promise<AdapterSyncResult>;
}

/* ── canonical-fact boundary validation ───────────────────────────────────── */

const FACT_KINDS = new Set(["campaign", "ad_group", "ad", "metric", "conversion"]);
const FACT_KEYS = new Set([
  "fact_kind",
  "external_ref",
  "parent_ref",
  "name",
  "window_start",
  "window_end",
  "currency",
  "spend",
  "impressions",
  "clicks",
  "leads",
  "conversions",
  "payload",
]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

function nonNegative(v: unknown): boolean {
  return v === undefined || (typeof v === "number" && Number.isFinite(v) && v >= 0);
}

export function validateCanonicalFacts(
  facts: unknown,
): { ok: true; facts: CanonicalFact[] } | { ok: false; reason: string } {
  if (!Array.isArray(facts)) return { ok: false, reason: "facts must be an array" };
  if (facts.length > 500) return { ok: false, reason: "at most 500 facts per batch" };
  for (const f of facts) {
    if (typeof f !== "object" || f === null || Array.isArray(f)) {
      return { ok: false, reason: "each fact must be an object" };
    }
    const fact = f as Record<string, unknown>;
    for (const k of Object.keys(fact)) {
      if (!FACT_KEYS.has(k)) return { ok: false, reason: `unknown fact key '${k}'` };
    }
    if (typeof fact.fact_kind !== "string" || !FACT_KINDS.has(fact.fact_kind)) {
      return { ok: false, reason: "fact_kind must be campaign/ad_group/ad/metric/conversion" };
    }
    if (
      typeof fact.external_ref !== "string" ||
      fact.external_ref.length < 1 ||
      fact.external_ref.length > 200
    ) {
      return { ok: false, reason: "external_ref must be 1..200 characters" };
    }
    for (const dk of ["window_start", "window_end"]) {
      if (
        fact[dk] !== undefined &&
        (typeof fact[dk] !== "string" || !ISO_DATE.test(fact[dk] as string))
      ) {
        return { ok: false, reason: `${dk} must be an ISO date` };
      }
    }
    if (fact.fact_kind === "metric" || fact.fact_kind === "conversion") {
      if (fact.window_start === undefined || fact.window_end === undefined) {
        return { ok: false, reason: `a ${fact.fact_kind} fact requires a window` };
      }
    }
    if (
      fact.currency !== undefined &&
      (typeof fact.currency !== "string" || !CURRENCY.test(fact.currency))
    ) {
      return { ok: false, reason: "currency must be ISO 4217" };
    }
    if (fact.spend !== undefined && fact.currency === undefined) {
      return { ok: false, reason: "spend without a currency is meaningless" };
    }
    for (const nk of ["spend", "impressions", "clicks", "leads", "conversions"]) {
      if (!nonNegative(fact[nk]))
        return { ok: false, reason: `${nk} must be a non-negative number` };
    }
    if (
      fact.payload !== undefined &&
      (typeof fact.payload !== "object" || fact.payload === null || Array.isArray(fact.payload))
    ) {
      return { ok: false, reason: "payload must be an object" };
    }
  }
  return { ok: true, facts: facts as CanonicalFact[] };
}

/* ── error-class mapping: adapter taxonomy → bounded run error classes ────── */

export function errorClassFor(error: ProviderError): string {
  switch (error.kind) {
    case "auth":
      return "invalid_credential";
    case "scope":
      return "missing_scope";
    case "rate_limit":
      return "rate_limited";
    case "temporary":
      return "provider_unavailable";
    case "permanent":
      return "provider_rejected";
    case "schema":
      return "schema_invalid";
    default:
      return "internal";
  }
}

/* ── the registry gate ────────────────────────────────────────────────────── */

export interface AdapterEnv {
  testProviderEnabled: boolean;
}

export function getProviderAdapter(provider: string, env: AdapterEnv): ProviderAdapter | null {
  if (provider === SERVICEOS_TEST_PROVIDER) {
    return env.testProviderEnabled ? serviceosTestProviderAdapter : null;
  }
  // real providers: a reviewed adapter does not exist in this build. The
  // catalogue says so; this registry says so; nothing can pretend otherwise.
  void getConnectionDescriptor(provider);
  return null;
}
