// Marketing Phase 9 — the provider CONNECTION seam contract + TRUTHFUL
// catalogue.
//
// Pure module (no network, no database). This is the seam a future reviewed
// provider adapter plugs into; in this build ZERO connection adapters exist,
// and every declaration below says so plainly. The Phase-8 module
// (marketing_ads_adapters.ts) remains the single truth for INGESTION modes
// and is deliberately untouched — this module describes CONNECTIONS
// (credentialed provider accounts + sync), which no provider implements yet.
//
// The Edge function consults connectionAdapterImplemented() before letting a
// connect attempt proceed past the recorded-facts path, and the SQL layer
// bakes the same v1 truth (marketing_provider_account_connect_start lands in
// error/'no_adapter'). Two layers, one truth: nothing can fabricate a
// connected account.

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
  /** what a REAL integration requires before connect can ever succeed */
  requirements: string[];
}

export const PROVIDER_CONNECTION_CATALOGUE: readonly ProviderConnectionDescriptor[] = [
  {
    provider: "meta",
    displayName: "Meta / Facebook / Instagram",
    connectImplemented: false,
    syncImplemented: false,
    requirements: [
      "A reviewed Meta Graph API connection adapter (credential verification + insights sync)",
      "A Meta app + system-user token stored in the tenant Vault broker",
    ],
  },
  {
    provider: "google_ads",
    displayName: "Google Ads",
    connectImplemented: false,
    syncImplemented: false,
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
