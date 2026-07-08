/**
 * Connector framework — the single interface every ServiceOS connector exposes,
 * whether Gmail, Google Workspace, Simwood, or any future provider (Slack,
 * QuickBooks, Commusoft, …). The UI never special-cases a vendor: it renders a
 * `ConnectorDescriptor` + `ConnectorState`, so adding a connector is registration,
 * not UI work.
 *
 * Nothing here talks to the backend. `ConnectorState` is supplied by a caller
 * (real data or stub) and passed to the reusable connector components.
 */

import type { LucideIcon } from "lucide-react";

/** Standardised lifecycle states. Never invent connector-specific ones. */
export type ConnectorStatus =
  | "connected"
  | "healthy"
  | "syncing"
  | "warning"
  | "offline"
  | "error"
  | "disabled"
  | "authorising";

/** Standardised health roll-up (drives the health badge + overview cards). */
export type ConnectorHealth = "healthy" | "warning" | "critical" | "unknown";

/** Which Operations Centre section a connector belongs to. */
export type ConnectorCategory =
  "communications" | "business" | "documents" | "calendar" | "ai" | "automations";

/** Shared toolbar actions. Future connectors inherit these automatically. */
export type ConnectorAction = "sync" | "reconnect" | "health" | "logs" | "settings";

/** A single generic metric shown on a connector card (Users, Records, Queues…). */
export interface ConnectorMetric {
  label: string;
  value: string | number;
  hint?: string;
}

/** Licence tier that unlocks a connector (OpenFolk decides what a customer gets). */
export type ConnectorLicenseTier = "starter" | "professional" | "enterprise";

/** Declarative capability flags — the UI adapts to these; it never checks vendor. */
export interface ConnectorCapabilities {
  supportsRealtime: boolean;
  supportsWebhook: boolean;
  supportsBackfill: boolean;
  supportsAI: boolean;
  supportsManualSync: boolean;
  supportsHealth: boolean;
  supportsLogs: boolean;
  supportsSettings: boolean;
  supportsDisconnect: boolean;
  supportsMultipleAccounts: boolean;
}

/** Static description of a connector — lives in the registry, not the backend. */
export interface ConnectorDescriptor {
  /** Stable id, e.g. "gmail" | "google_workspace" | "simwood". */
  id: string;
  /** Display name, e.g. "Google Workspace". */
  name: string;
  /** Provider/vendor, e.g. "Google" | "Simwood". */
  provider: string;
  category: ConnectorCategory;
  /** Optional icon for cards/tabs (lucide). */
  icon?: LucideIcon;
  /** The module this connector surfaces (see lib/modules). */
  moduleId: string;
  /** Licence tier that unlocks this connector. */
  licenseTier: ConnectorLicenseTier;
  /** Connector implementation version. */
  version: string;
  /** Capability flags — what this connector can do. */
  capabilities: ConnectorCapabilities;
  /** Shared toolbar actions this connector supports. */
  actions: ConnectorAction[];
  description?: string;
}

/** Live (or stubbed) runtime state for a connector, supplied by the caller. */
export interface ConnectorState {
  status: ConnectorStatus;
  health: ConnectorHealth;
  version?: string;
  /** e.g. Users, Records, Queues — rendered generically. */
  metrics?: ConnectorMetric[];
  /** ISO timestamp of the last successful sync, or null if never. */
  lastSyncAt?: string | null;
  /** Count of recent/open errors. */
  errors?: number;
}

/** A descriptor plus its current state — what a ConnectorCard renders. */
export interface ConnectorView {
  descriptor: ConnectorDescriptor;
  state: ConnectorState;
}
