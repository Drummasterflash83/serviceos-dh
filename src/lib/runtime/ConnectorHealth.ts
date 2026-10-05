/**
 * ConnectorHealth — the one health model + mappings. Every connector maps into
 * `RuntimeHealth`; the UI never invents connector-specific badges. This also
 * bridges to the existing ConnectorCard badge shapes (ConnectorStatus/Health).
 */

import type { ConnectorHealth, ConnectorStatus } from "@/lib/connectors/types";
import type { RuntimeHealth } from "./types";

/** How the 7-state runtime health maps to the reusable card badges. */
const BADGE: Record<RuntimeHealth, { status: ConnectorStatus; health: ConnectorHealth }> = {
  healthy: { status: "connected", health: "healthy" },
  warning: { status: "warning", health: "warning" },
  critical: { status: "error", health: "critical" },
  disconnected: { status: "offline", health: "unknown" },
  syncing: { status: "syncing", health: "healthy" },
  backfilling: { status: "syncing", health: "healthy" },
  disabled: { status: "disabled", health: "unknown" },
};

export function toBadge(health: RuntimeHealth): {
  status: ConnectorStatus;
  health: ConnectorHealth;
} {
  return BADGE[health];
}

/** Roll a runtime health up to the coarse healthy/warning/critical bucket. */
export function toBucket(health: RuntimeHealth): "healthy" | "warning" | "critical" | "unknown" {
  if (health === "critical") return "critical";
  if (health === "warning") return "warning";
  if (health === "disconnected" || health === "disabled") return "unknown";
  return "healthy";
}

/** A connector is "present" (counts toward platform) unless disconnected/disabled. */
export function isPresent(health: RuntimeHealth): boolean {
  return health !== "disconnected" && health !== "disabled";
}

/** 0–100 score from a runtime health (used when a provider doesn't set one). */
export function scoreOf(health: RuntimeHealth): number {
  switch (health) {
    case "healthy":
    case "syncing":
    case "backfilling":
      return 100;
    case "warning":
      return 60;
    case "critical":
      return 20;
    default:
      return 0;
  }
}
