// Marketing Ads — the provider-neutral adapter contract + TRUTHFUL catalogue.
//
// Pure module (no network, no database). An adapter DECLARES only what it
// genuinely implements; the catalogue below is the single source of provider
// truth for the API and UI. In this build exactly ONE mode is operational:
// the provider-neutral SIGNED WEBHOOK. Meta / Google Ads / LinkedIn / the
// authenticated-Sheet fallback have NO adapter, NO credentials and NO
// verification — they are honestly Not connected, offer no manual sync, and
// no fixture ever fakes their metrics in the production path.

export type AdsProviderKey = "meta" | "google_ads" | "linkedin" | "webhook" | "sheet";
export type AdsSourceMode = "api" | "webhook" | "sheet";

/** Factual capability flags — false means NOT IMPLEMENTED, full stop. */
export interface AdsAdapterDescriptor {
  provider: AdsProviderKey;
  version: string;
  displayName: string;
  mode: AdsSourceMode;
  /** an adapter exists and its ingestion path is locally executable */
  implemented: boolean;
  /** truthful connection label when no tenant configuration exists */
  defaultConnectionState: "ready_after_credential" | "not_connected";
  capabilities: {
    webhookIngestion: boolean;
    webhookChallenge: boolean;
    leadDetailFetch: boolean;
    metricSync: boolean;
    manualSync: boolean;
    cursorCheckpoint: boolean;
  };
  /** what a REAL integration would require before this leaves Not connected */
  requirements: string[];
}

export const ADS_ADAPTER_CATALOGUE: readonly AdsAdapterDescriptor[] = [
  {
    provider: "webhook",
    version: "1",
    displayName: "Signed webhook (provider-neutral)",
    mode: "webhook",
    implemented: true,
    defaultConnectionState: "ready_after_credential",
    capabilities: {
      webhookIngestion: true,
      webhookChallenge: false,
      leadDetailFetch: false,
      metricSync: false,
      manualSync: false,
      cursorCheckpoint: false,
    },
    requirements: [
      "Generate the per-source signing secret (stored in the tenant Vault broker; shown once)",
      "Configure the sending system to sign: HMAC-SHA256(secret, timestamp + '.' + raw_body)",
    ],
  },
  {
    provider: "meta",
    version: "0",
    displayName: "Meta / Facebook / Instagram Lead Ads",
    mode: "api",
    implemented: false,
    defaultConnectionState: "not_connected",
    capabilities: {
      webhookIngestion: false,
      webhookChallenge: false,
      leadDetailFetch: false,
      metricSync: false,
      manualSync: false,
      cursorCheckpoint: false,
    },
    requirements: [
      "A reviewed Meta Graph API adapter (leadgen webhooks + lead detail fetch + insights)",
      "A Meta app + system-user token stored in the tenant Vault broker",
      "Provider-specific signature (X-Hub-Signature-256) and challenge verification",
    ],
  },
  {
    provider: "google_ads",
    version: "0",
    displayName: "Google Ads",
    mode: "api",
    implemented: false,
    defaultConnectionState: "not_connected",
    capabilities: {
      webhookIngestion: false,
      webhookChallenge: false,
      leadDetailFetch: false,
      metricSync: false,
      manualSync: false,
      cursorCheckpoint: false,
    },
    requirements: [
      "A reviewed Google Ads API adapter (lead form webhooks + reporting)",
      "OAuth credentials + developer token stored in the tenant Vault broker",
      "Provider-specific webhook key verification",
    ],
  },
  {
    provider: "linkedin",
    version: "0",
    displayName: "LinkedIn Lead Gen Forms",
    mode: "api",
    implemented: false,
    defaultConnectionState: "not_connected",
    capabilities: {
      webhookIngestion: false,
      webhookChallenge: false,
      leadDetailFetch: false,
      metricSync: false,
      manualSync: false,
      cursorCheckpoint: false,
    },
    requirements: [
      "A reviewed LinkedIn Marketing API adapter (Lead Sync + reporting)",
      "OAuth credentials stored in the tenant Vault broker",
    ],
  },
  {
    provider: "sheet",
    version: "0",
    displayName: "Authenticated Google Sheet (fallback)",
    mode: "sheet",
    implemented: false,
    defaultConnectionState: "not_connected",
    capabilities: {
      webhookIngestion: false,
      webhookChallenge: false,
      leadDetailFetch: false,
      metricSync: false,
      manualSync: false,
      cursorCheckpoint: false,
    },
    requirements: [
      "An AUTHENTICATED Sheets adapter through the existing Google Workspace connection",
      "Never a publicly shared sheet — tenant-authorised access only",
    ],
  },
] as const;

export function getAdsAdapter(provider: string): AdsAdapterDescriptor | null {
  return ADS_ADAPTER_CATALOGUE.find((a) => a.provider === provider) ?? null;
}

/** True only when a REAL, locally executable ingestion path exists. */
export function adsProviderSupportsIngestion(provider: string): boolean {
  return getAdsAdapter(provider)?.capabilities.webhookIngestion === true;
}

export function adsProviderSupportsManualSync(provider: string): boolean {
  return getAdsAdapter(provider)?.capabilities.manualSync === true;
}
