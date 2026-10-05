// ServiceOS — Telephony provider adapter CONTRACT.
//
// Every provider integration implements this one contract; shared ServiceOS logic and
// the onboarding flow consume only the canonical results. Unsupported operations return
// a STRUCTURED unsupported result — never a thrown generic error — so the UI can show
// "unavailable / manual" honestly per provider.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { providerCapabilities, type ProviderCapabilities } from "./capabilities.ts";
import type { ConnectionSpec } from "./connection_spec.ts";

export type AuthMode =
  | "oauth"
  | "api_key"
  | "account_credentials"
  | "sip_credentials"
  | "service_account"
  | "webhook_secret"
  | "manual"
  | "none";

export type CanonicalType =
  | "provider_account"
  | "trunk"
  | "ddi"
  | "sip_identity"
  | "endpoint"
  | "extension"
  | "device"
  | "user"
  | "ring_group"
  | "hunt_group"
  | "queue"
  | "pickup_group"
  | "voicemail_route"
  | "transfer_route";

/** Non-secret snapshot of a tenant's connection, safe to hand an adapter. */
export interface ConnectionSnapshot {
  status: string; // not_configured | configured | manual | revoked | error
  accountRef: string | null; // masked/opaque, never a secret
  authMode: string | null;
  config: Record<string, unknown>; // non-secret config only
  configuredFields: string[]; // names of secret fields that ARE set
}

export interface AdapterContext {
  db: SupabaseClient;
  tenantId: string;
  /** Non-secret connection snapshot for this tenant+provider, if configured. */
  connection?: ConnectionSnapshot;
  /**
   * Resolve one stored secret field. SERVER-SIDE ONLY — wired by the Edge Function to the
   * Vault broker. Adapters may use it inside testConnection/discover but must NEVER return
   * a secret in any result. Absent when the caller did not provide credential access.
   */
  resolveSecret?: (field: string) => Promise<string | null>;
}

export interface DiscoveredObject {
  providerObjectId: string;
  canonicalType: CanonicalType;
  label: string | null;
  parentObjectId?: string | null;
  confidence: number;
  discoverySource: string;
  capabilities?: Record<string, unknown>;
  providerMetadata?: Record<string, unknown>; // safe reference only — never secrets
}

export type DiscoverResult =
  | { supported: false; reason: string }
  | {
      supported: true;
      ok: boolean;
      objects: DiscoveredObject[];
      error?: { code: string; message: string };
    };

export interface ConnectionCheck {
  name: string;
  ok: boolean;
  detail: string;
}
export interface ConnectionTestResult {
  ok: boolean;
  checks: ConnectionCheck[];
}

export interface ProviderAdapter {
  provider: string;
  label: string;
  authMode: AuthMode;
  /** Declares everything the generic onboarding UI needs to render a connection form. */
  getConnectionSpec(): ConnectionSpec;
  getCapabilityStatus(): ProviderCapabilities;
  testConnection(ctx: AdapterContext): Promise<ConnectionTestResult>;
  discover(type: CanonicalType, ctx: AdapterContext): Promise<DiscoverResult>;
}

/** Structured "this provider can't do that" — the ONLY correct way to signal it. */
export function unsupported(reason: string): DiscoverResult {
  return { supported: false, reason };
}

/** The canonical types an adapter attempts during onboarding discovery. */
export const DISCOVERY_ORDER: CanonicalType[] = [
  "provider_account",
  "trunk",
  "ddi",
  "endpoint",
  "extension",
  "device",
  "user",
  "ring_group",
  "queue",
  "pickup_group",
];

export { providerCapabilities, type ProviderCapabilities };
export type { ConnectionSpec };
