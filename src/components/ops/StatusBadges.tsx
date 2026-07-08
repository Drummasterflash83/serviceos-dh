/**
 * Standardised connector status/health badges. These are the ONLY place the
 * status→colour mapping lives, so every connector reads identically. Never
 * invent connector-specific badges — add a state to ConnectorStatus instead.
 */

import { cn } from "@/lib/utils";
import type { ConnectorHealth, ConnectorStatus } from "@/lib/connectors/types";

const STATUS_STYLE: Record<ConnectorStatus, { label: string; cls: string; dot: string }> = {
  connected: {
    label: "Connected",
    cls: "border-success/20 bg-success/10 text-success",
    dot: "bg-success",
  },
  healthy: {
    label: "Healthy",
    cls: "border-success/20 bg-success/10 text-success",
    dot: "bg-success",
  },
  syncing: { label: "Syncing", cls: "border-accent/20 bg-accent/10 text-accent", dot: "bg-accent" },
  authorising: {
    label: "Authorising",
    cls: "border-accent/20 bg-accent/10 text-accent",
    dot: "bg-accent",
  },
  warning: {
    label: "Warning",
    cls: "border-warning/20 bg-warning/10 text-warning",
    dot: "bg-warning",
  },
  offline: {
    label: "Offline",
    cls: "border-destructive/20 bg-destructive/10 text-destructive",
    dot: "bg-destructive",
  },
  error: {
    label: "Error",
    cls: "border-destructive/20 bg-destructive/10 text-destructive",
    dot: "bg-destructive",
  },
  disabled: {
    label: "Disabled",
    cls: "border-hairline bg-surface-alt text-muted-foreground",
    dot: "bg-muted-foreground/50",
  },
};

const HEALTH_STYLE: Record<ConnectorHealth, { label: string; cls: string }> = {
  healthy: { label: "Healthy", cls: "border-success/20 bg-success/10 text-success" },
  warning: { label: "Warning", cls: "border-warning/20 bg-warning/10 text-warning" },
  critical: { label: "Critical", cls: "border-destructive/20 bg-destructive/10 text-destructive" },
  unknown: { label: "Unknown", cls: "border-hairline bg-surface-alt text-muted-foreground" },
};

export function ConnectorStatusBadge({ status }: { status: ConnectorStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        s.cls,
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", s.dot, status === "syncing" && "animate-pulse")}
      />
      {s.label}
    </span>
  );
}

export function ConnectorHealthBadge({ health }: { health: ConnectorHealth }) {
  const h = HEALTH_STYLE[health];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
        h.cls,
      )}
    >
      {h.label}
    </span>
  );
}
