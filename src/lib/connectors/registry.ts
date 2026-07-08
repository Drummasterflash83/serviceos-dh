/**
 * Connector registry — the connectors ServiceOS knows about, as pure metadata
 * (capabilities, licence, version, actions). The existing connectors are
 * registered here; the Connector Runtime turns each into a live provider. Adding
 * a future connector is one descriptor here + one runtime provider — no UI edits.
 */

import { Building2, Mail, Phone } from "lucide-react";

import type { ConnectorCapabilities, ConnectorCategory, ConnectorDescriptor } from "./types";

/** Everything on = a fully-featured connector; providers narrow as needed. */
const ALL_CAPS: ConnectorCapabilities = {
  supportsRealtime: false,
  supportsWebhook: false,
  supportsBackfill: false,
  supportsAI: false,
  supportsManualSync: true,
  supportsHealth: true,
  supportsLogs: true,
  supportsSettings: true,
  supportsDisconnect: false,
  supportsMultipleAccounts: false,
};

export const CONNECTORS: ConnectorDescriptor[] = [
  {
    id: "gmail",
    name: "Gmail",
    provider: "Google",
    category: "communications",
    icon: Mail,
    moduleId: "comms.gmail",
    licenseTier: "starter",
    version: "1.0.0",
    capabilities: { ...ALL_CAPS, supportsDisconnect: true, supportsMultipleAccounts: true },
    actions: ["sync", "reconnect", "health", "logs", "settings"],
    description: "Per-mailbox Gmail OAuth ingestion.",
  },
  {
    id: "google_workspace",
    name: "Google Workspace",
    provider: "Google",
    category: "communications",
    icon: Building2,
    moduleId: "comms.google_workspace",
    licenseTier: "professional",
    version: "1.0.0",
    capabilities: { ...ALL_CAPS, supportsBackfill: true, supportsMultipleAccounts: true },
    actions: ["sync", "reconnect", "health", "logs", "settings"],
    description: "Domain-wide delegation across many mailboxes.",
  },
  {
    id: "simwood",
    name: "Phone / VoIP",
    provider: "Simwood",
    category: "communications",
    icon: Phone,
    moduleId: "comms.voip",
    licenseTier: "starter",
    version: "1.0.0",
    capabilities: { ...ALL_CAPS },
    actions: ["sync", "reconnect", "health", "logs", "settings"],
    description: "Call history, recordings and transcription pipeline.",
  },
];

export function getConnector(id: string): ConnectorDescriptor | null {
  return CONNECTORS.find((c) => c.id === id) ?? null;
}

export function connectorsByCategory(category: ConnectorCategory): ConnectorDescriptor[] {
  return CONNECTORS.filter((c) => c.category === category);
}
