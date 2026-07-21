// ServiceOS — OAuth demo telephony adapter (DEV/TEST ONLY).
//
// Exists to exercise the reusable OAuth connection framework end to end without faking OAuth
// on a real provider that doesn't support it. Declares authMode "oauth" with PKCE; it has NO
// user-entered secret fields — credentials arrive via the OAuth callback and are stored in
// Vault as the `oauth_access_token` / `oauth_refresh_token` secret fields. Hidden by default
// (like mock). Capabilities differ again, to keep proving the UI reads them honestly.

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

const OAUTH_DEMO_CAPS: ProviderCapabilities = {
  provider: "oauth_demo",
  label: "OAuth Demo Provider",
  capabilities: {
    trunks_discovery: "unavailable",
    ddi_discovery: "supported", // ← differs again from mock + sipcentric
    endpoint_discovery: "supported",
    extension_discovery: "unavailable",
    device_discovery: "unavailable",
    call_direction: "supported",
    answering_endpoint: "supported",
    pickup_metadata: "unavailable",
    transfer_metadata: "unavailable",
    queue_metadata: "supported",
    recording_access: "manual",
    transcript_access: "unavailable",
    live_events: "supported",
    provisioning: "unavailable",
  },
};

const OAUTH_DEMO_SPEC: ConnectionSpec = {
  provider: "oauth_demo",
  label: "OAuth Demo Provider",
  description: "Synthetic OAuth provider for proving the delegated-authorization framework. Dev only.",
  iconKey: "oauth_demo",
  regions: ["global"],
  authMode: "oauth",
  fields: [
    {
      name: "workspace",
      label: "Workspace / tenant slug",
      type: "text",
      secret: false,
      required: true,
      placeholder: "acme",
      help: "The provider workspace to authorize. Non-secret.",
      validation: { pattern: "^[a-z0-9-]{2,40}$", message: "lowercase letters, digits, - only" },
    },
  ],
  oauth: {
    supported: true,
    pkce: true,
    scopes: ["telephony.read", "recordings.read"],
    authorizeRefKey: "oauth_demo_authorize",
    note: "You will be redirected to the provider to authorize access. No password is entered here.",
  },
  webhook: { required: false, inbound: true },
  accountRefField: "workspace",
  accountRefFormat: "workspace slug",
  helpText: "Connect by authorizing ServiceOS with the provider. Tokens are stored encrypted; never shown.",
  manual: false,
};

const FIXTURES: Partial<Record<CanonicalType, DiscoveredObject[]>> = {
  provider_account: [
    { providerObjectId: "oauth-acct-1", canonicalType: "provider_account", label: "OAuth Demo Account", confidence: 1, discoverySource: "api" },
  ],
  ddi: [
    { providerObjectId: "+441134960001", canonicalType: "ddi", label: "DDI …0001", confidence: 1, discoverySource: "api" },
  ],
  endpoint: [
    { providerObjectId: "oauth-ep-1", canonicalType: "endpoint", label: "Endpoint 1", confidence: 1, discoverySource: "api" },
  ],
  queue: [
    { providerObjectId: "oauth-q-1", canonicalType: "queue", label: "Support queue", confidence: 1, discoverySource: "api" },
  ],
};

export const oauthDemoAdapter: ProviderAdapter = {
  provider: "oauth_demo",
  label: "OAuth Demo Provider",
  authMode: "oauth",
  getConnectionSpec: () => OAUTH_DEMO_SPEC,
  getCapabilityStatus: () => OAUTH_DEMO_CAPS,
  async testConnection(ctx: AdapterContext): Promise<ConnectionTestResult> {
    const configured = ctx.connection?.configuredFields ?? [];
    const hasToken = configured.includes("oauth_access_token");
    let tokenResolves = false;
    if (hasToken && ctx.resolveSecret) {
      const t = await ctx.resolveSecret("oauth_access_token");
      tokenResolves = typeof t === "string" && t.length > 0;
    }
    const checks = [
      { name: "credentials_present", ok: hasToken, detail: hasToken ? "access token present" : "not authorized" },
      { name: "authentication_accepted", ok: tokenResolves, detail: tokenResolves ? "token resolved from secure store" : "no valid token" },
      { name: "provider_reachable", ok: tokenResolves, detail: tokenResolves ? "authorized session active" : "authorize required" },
    ];
    return { ok: checks.every((c) => c.ok), checks };
  },
  discover(type: CanonicalType, ctx: AdapterContext): Promise<DiscoverResult> {
    // Only serve inventory once authorized (token configured) — honest otherwise.
    const authorized = (ctx.connection?.configuredFields ?? []).includes("oauth_access_token");
    if (!authorized) return Promise.resolve(unsupported("OAuth authorization required before discovery."));
    const objects = FIXTURES[type];
    if (!objects) return Promise.resolve(unsupported(`oauth_demo does not expose ${type}`));
    return Promise.resolve({ supported: true, ok: true, objects });
  },
};
