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
import type { ConnectionSpec } from "./connection_spec.ts";

// A DELIBERATELY DIFFERENT connection schema from Sipcentric — API key (secret) + region +
// optional webhook secret — to prove the connection form is generated from the adapter
// declaration, not hardcoded per provider. Self-service (manual: false).
const MOCK_SPEC: ConnectionSpec = {
  provider: "mock",
  label: "Mock Provider",
  description: "Synthetic development provider for onboarding/isolation proofs. Not a real integration.",
  iconKey: "mock",
  regions: ["eu", "us"],
  authMode: "api_key",
  fields: [
    {
      name: "account_id",
      label: "Account ID",
      type: "text",
      secret: false,
      required: true,
      placeholder: "acct_123",
      validation: { pattern: "^[A-Za-z0-9_-]{2,40}$", message: "2–40 chars: letters, digits, - _" },
    },
    {
      name: "api_key",
      label: "API key",
      type: "secret",
      secret: true,
      required: true,
      autocomplete: "off",
      help: "Stored encrypted in Vault; never displayed after saving.",
      validation: { minLength: 8, message: "API key looks too short" },
    },
    {
      name: "region",
      label: "Region",
      type: "region",
      secret: false,
      required: true,
      options: [
        { value: "eu", label: "Europe" },
        { value: "us", label: "United States" },
      ],
    },
    {
      name: "webhook_secret",
      label: "Webhook signing secret",
      type: "secret",
      secret: true,
      required: false,
      autocomplete: "off",
      group: "Webhook",
      help: "Optional. Used to verify inbound event signatures.",
    },
  ],
  oauth: { supported: false, pkce: false, scopes: [] },
  webhook: { required: false, inbound: true, secretField: "webhook_secret" },
  accountRefField: "account_id",
  accountRefFormat: "acct_<id>",
  helpText: "Enter your Mock Provider API key. This is a development-only adapter.",
  manual: false,
};

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
  getConnectionSpec: () => MOCK_SPEC,
  getCapabilityStatus: () => MOCK_CAPS,
  async testConnection(ctx: AdapterContext): Promise<ConnectionTestResult> {
    // Honest diagnostics driven by whether the credential actually resolves through the
    // broker. We check for presence only — the resolved value is never returned or logged.
    const configured = ctx.connection?.configuredFields ?? [];
    const hasKeyRef = configured.includes("api_key");
    let keyResolves = false;
    if (hasKeyRef && ctx.resolveSecret) {
      const v = await ctx.resolveSecret("api_key");
      keyResolves = typeof v === "string" && v.length > 0;
    }
    const accountId = ctx.connection?.config?.account_id ? String(ctx.connection.config.account_id) : null;
    const checks = [
      { name: "credentials_present", ok: hasKeyRef, detail: hasKeyRef ? "API key configured" : "no API key configured" },
      {
        name: "authentication_accepted",
        ok: keyResolves,
        detail: keyResolves ? "credential resolved from secure store" : "credential could not be resolved",
      },
      { name: "provider_reachable", ok: keyResolves, detail: keyResolves ? "mock endpoint reachable" : "not connected" },
      { name: "account_accessible", ok: !!accountId, detail: accountId ? `account ${accountId}` : "no account id" },
    ];
    return { ok: checks.every((c) => c.ok), checks };
  },
  discover: (type: CanonicalType, _ctx: AdapterContext): Promise<DiscoverResult> => {
    const objects = FIXTURES[type];
    if (!objects) return Promise.resolve(unsupported(`mock provider does not expose ${type}`));
    return Promise.resolve({ supported: true, ok: true, objects });
  },
};
