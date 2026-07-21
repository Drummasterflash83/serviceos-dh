// ServiceOS — Telephony provider capability model (PURE).
//
// Declares what each provider ADAPTER can actually surface, so the product never
// pretends every provider exposes the same telephony metadata. Provider-neutral: the
// UI reads these to show supported / manual-only / unavailable / planned honestly.

export type CapabilityState = "supported" | "manual" | "unavailable" | "planned";

export const CAPABILITY_KEYS = [
  "trunks_discovery",
  "ddi_discovery",
  "endpoint_discovery",
  "extension_discovery",
  "device_discovery",
  "call_direction",
  "answering_endpoint",
  "pickup_metadata",
  "transfer_metadata",
  "queue_metadata",
  "recording_access",
  "transcript_access",
  "live_events",
  "provisioning",
] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export interface ProviderCapabilities {
  provider: string;
  label: string;
  capabilities: Record<CapabilityKey, CapabilityState>;
}

function fill(
  overrides: Partial<Record<CapabilityKey, CapabilityState>>,
): Record<CapabilityKey, CapabilityState> {
  const base = Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, "unavailable"])) as Record<
    CapabilityKey,
    CapabilityState
  >;
  return { ...base, ...overrides };
}

// Grounded in the audited real feed: Sipcentric/Birchills gives us endpoint URIs,
// reliable direction, recordings and transcripts; extensions/devices are manual
// (not in the payload); pickup/transfer metadata is not exposed; trunks/DDI/queue
// discovery and live events are planned; no provisioning API is wired.
const REGISTRY: Record<string, ProviderCapabilities> = {
  sipcentric: {
    provider: "sipcentric",
    label: "Sipcentric / Birchills",
    capabilities: fill({
      endpoint_discovery: "supported",
      call_direction: "supported",
      recording_access: "supported",
      transcript_access: "supported",
      answering_endpoint: "manual",
      extension_discovery: "manual",
      device_discovery: "manual",
      pickup_metadata: "unavailable",
      transfer_metadata: "unavailable",
      trunks_discovery: "planned",
      ddi_discovery: "planned",
      queue_metadata: "planned",
      live_events: "planned",
      provisioning: "unavailable",
    }),
  },
  simwood: {
    provider: "simwood",
    label: "Simwood",
    capabilities: fill({
      call_direction: "supported",
      recording_access: "supported",
      ddi_discovery: "planned",
      trunks_discovery: "planned",
      endpoint_discovery: "manual",
    }),
  },
};

export function providerCapabilities(provider: string | null | undefined): ProviderCapabilities {
  const key = (provider ?? "").toLowerCase();
  return (
    REGISTRY[key] ?? {
      provider: key || "unknown",
      label: provider || "Unknown provider",
      capabilities: fill({ call_direction: "manual", endpoint_discovery: "manual" }),
    }
  );
}
