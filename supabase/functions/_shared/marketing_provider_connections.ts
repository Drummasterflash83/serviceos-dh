// Marketing Phase 9/10 — the provider CONNECTION seam contract + TRUTHFUL
// catalogue.
//
// Pure module (no network, no database). This is the seam reviewed provider
// adapters plug into. As of Phase 10B exactly ONE real adapter exists — Meta
// (fixture tested, NOT live verified, no tenant connected); Google Ads /
// LinkedIn / Sheet remain unimplemented and say so plainly. The Phase-8
// module (marketing_ads_adapters.ts) remains the single truth for INGESTION
// modes and is deliberately untouched — this module describes CONNECTIONS
// (credentialed provider accounts + sync).
//
// The Edge function consults connectionAdapterImplemented() before letting a
// connect attempt proceed past the recorded-facts path; providers without an
// adapter land in the recorded error/'no_adapter'. A provider WITH an
// adapter still only reaches 'connected' through the worker-validated seam
// with genuine verification evidence. Nothing can fabricate a connected
// account.

export type ProviderConnectionKey = "meta" | "google_ads" | "linkedin" | "sheet";

/** Rotation overlap for connection credentials — identical to the Phase-8
 *  webhook-secret contract: after a rotation the PREVIOUS credential may be
 *  honoured for at most this long, then it is retired. The clock is the
 *  account's credential_rotated_at, committed by the mark RPC BEFORE any
 *  Vault write. */
export const MKT_CONNECTION_ROTATION_OVERLAP_SECONDS = 86400;

/** The Vault-broker provider key for a connection's credentials. The secret
 *  itself NEVER travels through or rests in the database rows. */
export function connectionVaultProvider(accountId: string): string {
  return `mkt-conn-${accountId}`;
}

export interface ProviderConnectionDescriptor {
  provider: ProviderConnectionKey;
  displayName: string;
  /** a reviewed connection adapter exists and can genuinely verify
   *  credentials against the provider — false means NOT IMPLEMENTED, full
   *  stop; a connect attempt is recorded and lands in error/'no_adapter' */
  connectImplemented: boolean;
  /** a reviewed sync adapter exists and can genuinely pull provider facts */
  syncImplemented: boolean;
  /** HOW FAR the adapter's truth has been verified:
   *  'none' — no adapter; 'fixture_tested' — implemented and proven against
   *  deterministic official-contract fixtures, NO live provider request has
   *  ever been made; 'live_verified' — a genuine authorised provider
   *  request succeeded (nothing in this build is live_verified). This is
   *  adapter status, NEVER a tenant connection state. */
  verification: "none" | "fixture_tested" | "live_verified";
  /** what a REAL integration requires before connect can ever succeed */
  requirements: string[];
}

export const PROVIDER_CONNECTION_CATALOGUE: readonly ProviderConnectionDescriptor[] = [
  {
    provider: "meta",
    displayName: "Meta / Facebook / Instagram",
    // Phase 10B: the reviewed adapter EXISTS (Graph API v26.0, read-only
    // slice) and is fixture tested — NOT live verified, and no tenant is
    // connected. Requirements below are the remaining EXTERNAL gates.
    connectImplemented: true,
    syncImplemented: true,
    verification: "fixture_tested",
    requirements: [
      "A Business Manager system-user access token with ads_read (operator-supplied)",
      "Meta app with Marketing API access — App Review / advanced access is an external process",
      "First genuine authorised request (live verification) — never performed in this build",
    ],
  },
  {
    provider: "google_ads",
    displayName: "Google Ads",
    connectImplemented: false,
    syncImplemented: false,
    verification: "none",
    requirements: [
      "A reviewed Google Ads API connection adapter (OAuth verification + reporting sync)",
      "OAuth credentials + developer token stored in the tenant Vault broker",
    ],
  },
  {
    provider: "linkedin",
    displayName: "LinkedIn",
    connectImplemented: false,
    syncImplemented: false,
    verification: "none",
    requirements: [
      "A reviewed LinkedIn Marketing API connection adapter (OAuth verification + reporting sync)",
      "OAuth credentials stored in the tenant Vault broker",
    ],
  },
  {
    provider: "sheet",
    displayName: "Authenticated Google Sheet",
    connectImplemented: false,
    syncImplemented: false,
    verification: "none",
    requirements: [
      "An AUTHENTICATED Sheets connection through the existing Google Workspace seam",
      "Never a publicly shared sheet — tenant-authorised access only",
    ],
  },
] as const;

export function getConnectionDescriptor(provider: string): ProviderConnectionDescriptor | null {
  return PROVIDER_CONNECTION_CATALOGUE.find((c) => c.provider === provider) ?? null;
}

/** True ONLY when a reviewed connection adapter genuinely exists. */
export function connectionAdapterImplemented(provider: string): boolean {
  return getConnectionDescriptor(provider)?.connectImplemented === true;
}

/** True ONLY when a reviewed sync adapter genuinely exists. */
export function syncAdapterImplemented(provider: string): boolean {
  return getConnectionDescriptor(provider)?.syncImplemented === true;
}
