// ServiceOS — Telephony provider adapter CONTRACT.
//
// Every provider integration implements this one contract; shared ServiceOS logic and
// the onboarding flow consume only the canonical results. Unsupported operations return
// a STRUCTURED unsupported result — never a thrown generic error — so the UI can show
// "unavailable / manual" honestly per provider.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { providerCapabilities, type ProviderCapabilities } from "./capabilities.ts";

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

export interface AdapterContext {
  db: SupabaseClient;
  tenantId: string;
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
