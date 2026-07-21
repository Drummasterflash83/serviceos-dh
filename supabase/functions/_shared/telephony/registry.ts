// ServiceOS — Telephony provider adapter registry. One place to resolve a provider
// key to its adapter, and to list connectable providers for the onboarding UI.

import type { ProviderAdapter } from "./adapter.ts";
import { sipcentricAdapter } from "./sipcentric.ts";
import { mockAdapter } from "./mock.ts";

const ADAPTERS: Record<string, ProviderAdapter> = {
  sipcentric: sipcentricAdapter,
  mock: mockAdapter,
};

export function getAdapter(provider: string): ProviderAdapter | null {
  return ADAPTERS[provider] ?? null;
}

/** Providers offered in the "not connected" onboarding view (mock hidden by default). */
export function availableProviders(includeMock = false): Array<{
  provider: string;
  label: string;
  authMode: string;
  capabilities: ReturnType<ProviderAdapter["getCapabilityStatus"]>;
}> {
  return Object.values(ADAPTERS)
    .filter((a) => includeMock || a.provider !== "mock")
    .map((a) => ({
      provider: a.provider,
      label: a.label,
      authMode: a.authMode,
      capabilities: a.getCapabilityStatus(),
    }));
}
