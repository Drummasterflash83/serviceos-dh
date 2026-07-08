/**
 * Connector registry — the connectors ServiceOS knows about, as pure metadata.
 * The existing, working connectors (Gmail OAuth, Google Workspace DWD, Simwood
 * VoIP) are registered here so the Operations Centre can render them through the
 * shared framework instead of bespoke per-connector screens. Future connectors
 * are added by appending a descriptor — no UI changes.
 */

import type { ConnectorCategory, ConnectorDescriptor } from "./types";

export const CONNECTORS: ConnectorDescriptor[] = [
  {
    id: "gmail",
    name: "Gmail",
    provider: "Google",
    category: "communications",
    moduleId: "comms.gmail",
    actions: ["sync", "reconnect", "health", "logs", "settings"],
    description: "Per-mailbox Gmail OAuth ingestion.",
  },
  {
    id: "google_workspace",
    name: "Google Workspace",
    provider: "Google",
    category: "communications",
    moduleId: "comms.google_workspace",
    actions: ["sync", "reconnect", "health", "logs", "settings"],
    description: "Domain-wide delegation across many mailboxes.",
  },
  {
    id: "simwood",
    name: "Phone / VoIP",
    provider: "Simwood",
    category: "communications",
    moduleId: "comms.voip",
    actions: ["sync", "health", "logs", "settings"],
    description: "Call history, recordings and transcription pipeline.",
  },
];

export function getConnector(id: string): ConnectorDescriptor | null {
  return CONNECTORS.find((c) => c.id === id) ?? null;
}

export function connectorsByCategory(category: ConnectorCategory): ConnectorDescriptor[] {
  return CONNECTORS.filter((c) => c.category === category);
}
