/**
 * ActionToolbar — the SAME toolbar every connector receives (Sync, Reconnect,
 * Health, Logs, Settings). Which actions appear comes from the connector's
 * descriptor; the handler is supplied by the caller. Future connectors inherit
 * this automatically — never build a bespoke action row.
 */

import {
  RefreshCw,
  PlugZap,
  HeartPulse,
  ScrollText,
  Settings,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ConnectorAction } from "@/lib/connectors/types";

const ACTION_META: Record<ConnectorAction, { label: string; icon: LucideIcon }> = {
  sync: { label: "Sync", icon: RefreshCw },
  reconnect: { label: "Reconnect", icon: PlugZap },
  health: { label: "Health", icon: HeartPulse },
  logs: { label: "Logs", icon: ScrollText },
  settings: { label: "Settings", icon: Settings },
};

const ORDER: ConnectorAction[] = ["sync", "reconnect", "health", "logs", "settings"];

export function ActionToolbar({
  actions,
  onAction,
  busy,
  disabled,
}: {
  actions: ConnectorAction[];
  onAction?: (action: ConnectorAction) => void;
  /** Action currently running (spins its icon, disables the row). */
  busy?: ConnectorAction | null;
  disabled?: boolean;
}) {
  const shown = ORDER.filter((a) => actions.includes(a));
  return (
    <div className="flex flex-wrap gap-2">
      {shown.map((a) => {
        const meta = ACTION_META[a];
        const isBusy = busy === a;
        return (
          <Button
            key={a}
            size="sm"
            variant="outline"
            disabled={disabled || Boolean(busy)}
            onClick={() => onAction?.(a)}
          >
            <meta.icon className={`h-3.5 w-3.5 ${isBusy ? "animate-spin" : ""}`} />
            {meta.label}
          </Button>
        );
      })}
    </div>
  );
}
