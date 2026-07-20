/**
 * Canonical connector status — the single source of truth for "which inputs are
 * genuinely live vs catalogue/planned", derived from the existing module + connector
 * registries. Every surface (Learning Centre Sources, Settings) reads this, so the
 * same connector can never show two different states on two screens.
 *
 * Truth rule: a connector is Live ONLY when its module is `available` AND it is
 * backed by a real ingestion connector (a descriptor in connectors/registry). Today
 * that is exactly Simwood phone and Gmail / Google Workspace email. Everything else
 * is Planned. No second registry is introduced.
 */

import { CONNECTORS } from "./connectors/registry";
import { MODULES } from "./modules/registry";

export type ConnectorState = "Live" | "Planned";

export interface ConnectorStatus {
  id: string;
  name: string;
  category: string; // human label
  purpose: string;
  state: ConnectorState;
}

const CATEGORY_LABEL: Record<string, string> = {
  communications: "Communications",
  business: "Business systems",
  documents: "Documents",
  calendar: "Calendar",
  ai: "AI",
  automations: "Automations",
};

/** Canonical status for every catalogued connector, single-sourced. */
export function getConnectorStatuses(): ConnectorStatus[] {
  const liveIds = new Set(CONNECTORS.map((c) => c.id));
  return MODULES.map((m) => {
    const live = m.availability === "available" && !!m.connectorId && liveIds.has(m.connectorId);
    const descriptor = m.connectorId ? CONNECTORS.find((c) => c.id === m.connectorId) : undefined;
    const category = CATEGORY_LABEL[m.category] ?? m.category;
    return {
      id: m.id,
      name: m.name,
      category,
      purpose: descriptor?.description ?? category,
      state: live ? "Live" : "Planned",
    };
  });
}

export function liveConnectors(): ConnectorStatus[] {
  return getConnectorStatuses().filter((c) => c.state === "Live");
}

export function plannedConnectors(): ConnectorStatus[] {
  return getConnectorStatuses().filter((c) => c.state === "Planned");
}
