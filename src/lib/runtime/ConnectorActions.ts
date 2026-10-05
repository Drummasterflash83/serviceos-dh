/**
 * ConnectorActions — one action model. Actions are DERIVED from a connector's
 * capability flags, so the toolbar is identical everywhere and a new connector
 * inherits actions automatically (no bespoke action rows, deliverable 8).
 */

import type { ConnectorDescriptor } from "@/lib/connectors/types";
import type { ConnectorActionSpec, ConnectorActionKind } from "./types";

const SPEC: Record<ConnectorActionKind, Omit<ConnectorActionSpec, "id">> = {
  connect: { kind: "connect", label: "Connect" },
  disconnect: { kind: "disconnect", label: "Disconnect", destructive: true },
  sync: { kind: "sync", label: "Sync" },
  backfill: { kind: "backfill", label: "Backfill" },
  reconnect: { kind: "reconnect", label: "Reconnect" },
  retry: { kind: "retry", label: "Retry failed" },
  health: { kind: "health", label: "Health" },
  logs: { kind: "logs", label: "Logs" },
  settings: { kind: "settings", label: "Settings" },
  disable: { kind: "disable", label: "Disable", destructive: true },
};

function spec(kind: ConnectorActionKind, connectorId: string): ConnectorActionSpec {
  return { id: `${connectorId}:${kind}`, ...SPEC[kind] };
}

/** The standard actions a connector advertises, from its capabilities. */
export function actionsFor(d: ConnectorDescriptor): ConnectorActionSpec[] {
  const out: ConnectorActionSpec[] = [];
  if (d.capabilities.supportsManualSync) out.push(spec("sync", d.id));
  if (d.capabilities.supportsBackfill) out.push(spec("backfill", d.id));
  out.push(spec("reconnect", d.id));
  if (d.capabilities.supportsHealth) out.push(spec("health", d.id));
  if (d.capabilities.supportsLogs) out.push(spec("logs", d.id));
  if (d.capabilities.supportsSettings) out.push(spec("settings", d.id));
  if (d.capabilities.supportsDisconnect) out.push(spec("disconnect", d.id));
  return out;
}

export function actionOfKind(
  d: ConnectorDescriptor,
  kind: ConnectorActionKind,
): ConnectorActionSpec | null {
  const supported: Record<ConnectorActionKind, boolean> = {
    connect: true,
    disconnect: d.capabilities.supportsDisconnect,
    sync: d.capabilities.supportsManualSync,
    backfill: d.capabilities.supportsBackfill,
    reconnect: true,
    retry: true,
    health: d.capabilities.supportsHealth,
    logs: d.capabilities.supportsLogs,
    settings: d.capabilities.supportsSettings,
    disable: d.capabilities.supportsDisconnect,
  };
  return supported[kind] ? spec(kind, d.id) : null;
}
