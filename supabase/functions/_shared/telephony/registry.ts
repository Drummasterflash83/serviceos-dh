// ServiceOS — Telephony provider adapter registry. One place to resolve a provider
// key to its adapter, list connectable providers for the onboarding gallery, and fetch a
// provider's declared connection spec. Providers come from HERE, never hardcoded in the UI.

import type { ProviderAdapter } from "./adapter.ts";
import type { ConnectionSpec } from "./connection_spec.ts";
import { sipcentricAdapter } from "./sipcentric.ts";
import { mockAdapter } from "./mock.ts";
import { oauthDemoAdapter } from "./oauth_demo.ts";

const ADAPTERS: Record<string, ProviderAdapter> = {
  sipcentric: sipcentricAdapter,
  mock: mockAdapter,
  oauth_demo: oauthDemoAdapter,
};

// Dev/test adapters hidden from the production gallery unless explicitly included.
const DEV_ONLY = new Set(["mock", "oauth_demo"]);

export function getAdapter(provider: string): ProviderAdapter | null {
  return ADAPTERS[provider] ?? null;
}

export function getConnectionSpec(provider: string): ConnectionSpec | null {
  return ADAPTERS[provider]?.getConnectionSpec() ?? null;
}

export interface ProviderGalleryEntry {
  provider: string;
  label: string;
  authMode: string;
  description: string;
  iconKey: string;
  regions: string[];
  manual: boolean; // provider-assisted vs self-service
  oauthSupported: boolean;
  capabilities: ReturnType<ProviderAdapter["getCapabilityStatus"]>;
  devOnly: boolean;
}

/** Providers offered in the "not connected" gallery. Dev adapters hidden unless requested. */
export function availableProviders(includeDev = false): ProviderGalleryEntry[] {
  return Object.values(ADAPTERS)
    .filter((a) => includeDev || !DEV_ONLY.has(a.provider))
    .map((a) => {
      const spec = a.getConnectionSpec();
      return {
        provider: a.provider,
        label: a.label,
        authMode: a.authMode,
        description: spec.description,
        iconKey: spec.iconKey,
        regions: spec.regions,
        manual: spec.manual,
        oauthSupported: !!spec.oauth?.supported,
        capabilities: a.getCapabilityStatus(),
        devOnly: DEV_ONLY.has(a.provider),
      };
    });
}
