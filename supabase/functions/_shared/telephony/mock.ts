// ServiceOS — Mock telephony provider adapter (test/dev only).
//
// A deterministic, DB-free adapter used to prove onboarding + tenant isolation without
// touching real provider data or the Drummond tenant. Declares DIFFERENT capabilities
// than Sipcentric (it exposes extensions + trunks) to prove capabilities differ per
// provider. All fixtures are obviously synthetic.

import {
  unsupported,
  type AdapterContext,
  type CanonicalType,
  type ConnectionTestResult,
  type DiscoverResult,
  type DiscoveredObject,
  type ProviderAdapter,
  type ProviderCapabilities,
} from "./adapter.ts";

const MOCK_CAPS: ProviderCapabilities = {
  provider: "mock",
  label: "Mock Provider",
  capabilities: {
    trunks_discovery: "supported",
    ddi_discovery: "unavailable",
    endpoint_discovery: "supported",
    extension_discovery: "supported", // ← differs from Sipcentric (manual there)
    device_discovery: "supported",
    call_direction: "supported",
    answering_endpoint: "supported",
    pickup_metadata: "planned",
    transfer_metadata: "planned",
    queue_metadata: "unavailable",
    recording_access: "supported",
    transcript_access: "manual",
    live_events: "planned",
    provisioning: "unavailable",
  },
};

const FIXTURES: Partial<Record<CanonicalType, DiscoveredObject[]>> = {
  provider_account: [
    {
      providerObjectId: "mock-acct-1",
      canonicalType: "provider_account",
      label: "Mock Account",
      confidence: 1,
      discoverySource: "api",
    },
  ],
  trunk: [
    {
      providerObjectId: "mock-trunk-1",
      canonicalType: "trunk",
      label: "Primary SIP trunk",
      confidence: 1,
      discoverySource: "api",
    },
  ],
  endpoint: [
    {
      providerObjectId: "mock-ep-101",
      canonicalType: "endpoint",
      label: "Endpoint 101",
      confidence: 1,
      discoverySource: "api",
    },
    {
      providerObjectId: "mock-ep-102",
      canonicalType: "endpoint",
      label: "Endpoint 102",
      confidence: 1,
      discoverySource: "api",
    },
  ],
  extension: [
    {
      providerObjectId: "101",
      canonicalType: "extension",
      label: "Ext 101",
      parentObjectId: "mock-ep-101",
      confidence: 1,
      discoverySource: "api",
    },
  ],
};

export const mockAdapter: ProviderAdapter = {
  provider: "mock",
  label: "Mock Provider",
  authMode: "api_key",
  getCapabilityStatus: () => MOCK_CAPS,
  testConnection: (_ctx: AdapterContext): Promise<ConnectionTestResult> =>
    Promise.resolve({
      ok: true,
      checks: [
        { name: "provider_reachable", ok: true, detail: "mock ok" },
        { name: "call_history_permission", ok: true, detail: "mock ok" },
      ],
    }),
  discover: (type: CanonicalType, _ctx: AdapterContext): Promise<DiscoverResult> => {
    const objects = FIXTURES[type];
    if (!objects) return Promise.resolve(unsupported(`mock provider does not expose ${type}`));
    return Promise.resolve({ supported: true, ok: true, objects });
  },
};
